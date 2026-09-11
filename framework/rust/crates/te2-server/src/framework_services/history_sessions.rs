//! Bounded retained Git walks, isolated from interactive Git read permits.
use super::history_graph::{DEFAULT_PAGE_SIZE, GraphReader, MAX_PAGE_SIZE};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
use tokio::sync::{Semaphore, oneshot};

type Reply = Result<Value, String>;
type ReplySender = oneshot::Sender<Reply>;
const MAX_SESSIONS: usize = 4;
const IDLE_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Owner {
    pub(crate) nid: u32,
    pub(crate) name: String,
    pub(crate) root: String,
    pub(crate) generation: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub(crate) version: u16,
    pub(crate) session_id: String,
    pub(crate) limit: Option<usize>,
    pub(crate) offset: Option<usize>,
}

enum Command {
    Page {
        limit: usize,
        offset: usize,
        reply: ReplySender,
    },
    Stop,
}
struct Entry {
    owner: Owner,
    commands: mpsc::SyncSender<Command>,
    cancelled: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    busy: AtomicBool,
}
impl Entry {
    fn stop(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
        let _ = self.commands.try_send(Command::Stop);
    }
}

pub(crate) struct HistorySessions {
    entries: Mutex<HashMap<String, Arc<Entry>>>,
    permits: Arc<Semaphore>,
}
impl Default for HistorySessions {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            permits: Arc::new(Semaphore::new(MAX_SESSIONS)),
        }
    }
}
impl Drop for HistorySessions {
    fn drop(&mut self) {
        if let Ok(entries) = self.entries.get_mut() {
            for entry in entries.values() {
                entry.stop();
            }
        }
    }
}

// Dropping a request future invalidates its whole traversal: an unseen page
// cannot later be retried as if the iterator had never advanced.
struct Pending {
    entry: Arc<Entry>,
    accepted: bool,
}
impl Drop for Pending {
    fn drop(&mut self) {
        if !self.accepted {
            self.entry.stop();
        }
        self.entry.busy.store(false, Ordering::Release);
    }
}
struct Finished(Arc<AtomicBool>);
impl Drop for Finished {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

impl HistorySessions {
    pub(crate) async fn dispatch(&self, method: &str, owner: Owner, params: Request) -> Reply {
        if params.version != 1
            || params.session_id.is_empty()
            || params.session_id.len() > 128
            || !params
                .session_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err("Invalid history session contract".into());
        }
        match method {
            "git.historyGraph.open" => self.open(owner, params).await,
            "git.historyGraph.next" => self.next(owner, params).await,
            "git.historyGraph.close" => {
                let mut entries = self
                    .entries
                    .lock()
                    .map_err(|_| "History registry unavailable")?;
                if let Some(entry) = entries.get(&params.session_id) {
                    if entry.owner != owner {
                        return Err("History owner mismatch".into());
                    }
                    entry.stop();
                }
                entries.remove(&params.session_id);
                Ok(json!({"dto":"GitHistoryClosed", "version":1, "sessionId":params.session_id}))
            }
            _ => Err("Unknown history operation".into()),
        }
    }

    async fn open(&self, owner: Owner, params: Request) -> Reply {
        if params.limit.is_some() || params.offset.is_some() {
            return Err("Open takes no page fields".into());
        }
        if !std::path::Path::new(&owner.root).is_absolute() {
            return Err("History requires an absolute workspace root".into());
        }
        let permit = self
            .permits
            .clone()
            .try_acquire_owned()
            .map_err(|_| "History capacity reached")?;
        let (tx, rx) = mpsc::sync_channel(1);
        let (reply, result) = oneshot::channel();
        let entry = Arc::new(Entry {
            owner: owner.clone(),
            commands: tx,
            cancelled: Arc::new(AtomicBool::new(false)),
            finished: Arc::new(AtomicBool::new(false)),
            busy: AtomicBool::new(true),
        });
        {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "History registry unavailable")?;
            entries.retain(|_, entry| !entry.finished.load(Ordering::Acquire));
            if entries.contains_key(&params.session_id) {
                return Err("History session already exists".into());
            }
            entries.insert(params.session_id.clone(), entry.clone());
        }
        let mut pending = Pending {
            entry: entry.clone(),
            accepted: false,
        };
        let session = params.session_id.clone();
        let spawned = std::thread::Builder::new()
            .name("te2-history".into())
            .spawn(move || {
                let _permit = permit;
                let _finished = Finished(entry.finished.clone());
                run(owner, session, entry, rx, reply);
            });
        if let Err(error) = spawned {
            self.entries
                .lock()
                .map_err(|_| "History registry unavailable")?
                .remove(&params.session_id);
            return Err(error.to_string());
        }
        let response = result.await.map_err(|_| "History worker stopped")?;
        pending.accepted = response.is_ok();
        response
    }

    async fn next(&self, owner: Owner, params: Request) -> Reply {
        let limit = params.limit.unwrap_or(DEFAULT_PAGE_SIZE);
        if limit == 0 || limit > MAX_PAGE_SIZE {
            return Err("Invalid history page size".into());
        }
        let offset = params.offset.ok_or("History next requires offset")?;
        let entry = self
            .entries
            .lock()
            .map_err(|_| "History registry unavailable")?
            .get(&params.session_id)
            .cloned()
            .ok_or("History session missing or expired")?;
        if entry.owner != owner {
            return Err("History owner mismatch".into());
        }
        if entry.finished.load(Ordering::Acquire) || entry.cancelled.load(Ordering::Relaxed) {
            return Err("History session closed".into());
        }
        if entry.busy.swap(true, Ordering::AcqRel) {
            return Err("History request already pending".into());
        }
        let mut pending = Pending {
            entry: entry.clone(),
            accepted: false,
        };
        let (reply, result) = oneshot::channel();
        entry
            .commands
            .try_send(Command::Page {
                limit,
                offset,
                reply,
            })
            .map_err(|_| "History worker unavailable")?;
        let response = result.await.map_err(|_| "History worker stopped")?;
        pending.accepted = response.is_ok();
        response
    }
}

fn run(
    owner: Owner,
    session: String,
    entry: Arc<Entry>,
    commands: mpsc::Receiver<Command>,
    reply: ReplySender,
) {
    let repo = match git2::Repository::open(&owner.root) {
        Ok(repo) => repo,
        Err(error) => {
            let _ = reply.send(Err(error.to_string()));
            return;
        }
    };
    let mut reader = match GraphReader::new(&repo, &entry.cancelled) {
        Ok(reader) => reader,
        Err(error) => {
            let _ = reply.send(Err(error.to_string()));
            return;
        }
    };
    if reply.send(Ok(json!({"dto":"GitHistoryOpened", "version":1, "sessionId":session, "snapshot":reader.snapshot()}))).is_err() { return; }
    let mut expected_offset = 0;
    // This is one idle lease, not periodic polling. Close wakes the channel;
    // the timer bounds orphaned workers after a lost Python process/transport.
    while !entry.cancelled.load(Ordering::Relaxed) {
        let Ok(Command::Page {
            limit,
            offset,
            reply,
        }) = commands.recv_timeout(IDLE_TIMEOUT)
        else {
            break;
        };
        if offset != expected_offset {
            let _ = reply.send(Err("History page offset mismatch".into()));
            break;
        }
        let page = reader.next_page(limit, &entry.cancelled);
        match page {
            Ok(page) => {
                expected_offset += page.commits.len();
                if reply.send(Ok(json!({"dto":"GitHistoryPageResult", "version":1, "sessionId":session, "page":page}))).is_err() { break; }
            }
            Err(error) => {
                let _ = reply.send(Err(error.to_string()));
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Owner) {
        let scratch = std::env::var_os("TMPDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap());
        let dir = tempfile::Builder::new()
            .prefix("history-session-")
            .tempdir_in(scratch)
            .unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let tree = repo.treebuilder(None).unwrap().write().unwrap();
        let tree = repo.find_tree(tree).unwrap();
        let sig = git2::Signature::now("Test", "test@example.invalid").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "root", &tree, &[])
            .unwrap();
        let owner = Owner {
            nid: 1100,
            name: "test.history".into(),
            root: dir.path().to_str().unwrap().into(),
            generation: Some(3),
        };
        (dir, owner)
    }
    fn request(id: &str, offset: Option<usize>) -> Request {
        Request {
            version: 1,
            session_id: id.into(),
            limit: None,
            offset,
        }
    }
    #[tokio::test]
    async fn open_page_close_and_generation_ownership() {
        let (_dir, owner) = fixture();
        let registry = HistorySessions::default();
        let opened = registry
            .dispatch("git.historyGraph.open", owner.clone(), request("one", None))
            .await
            .unwrap();
        assert_eq!(opened["snapshot"]["dto"], "GitHistorySnapshot");
        assert!(opened.get("commits").is_none());
        let mut other = owner.clone();
        other.generation = Some(4);
        assert!(
            registry
                .dispatch("git.historyGraph.next", other, request("one", Some(0)))
                .await
                .is_err()
        );
        let page = registry
            .dispatch(
                "git.historyGraph.next",
                owner.clone(),
                request("one", Some(0)),
            )
            .await
            .unwrap();
        assert_eq!(page["page"]["commits"].as_array().unwrap().len(), 1);
        assert_eq!(page["page"]["complete"], true);
        registry
            .dispatch(
                "git.historyGraph.close",
                owner.clone(),
                request("one", None),
            )
            .await
            .unwrap();
        assert!(
            registry
                .dispatch(
                    "git.historyGraph.next",
                    owner.clone(),
                    request("one", Some(1))
                )
                .await
                .is_err()
        );
        registry
            .dispatch("git.historyGraph.close", owner, request("one", None))
            .await
            .unwrap();
    }
    #[tokio::test]
    async fn capacity_is_bounded_without_queuing_new_workers() {
        let (_dir, owner) = fixture();
        let registry = HistorySessions::default();
        for id in 0..MAX_SESSIONS {
            registry
                .dispatch(
                    "git.historyGraph.open",
                    owner.clone(),
                    request(&id.to_string(), None),
                )
                .await
                .unwrap();
        }
        let error = registry
            .dispatch(
                "git.historyGraph.open",
                owner.clone(),
                request("overflow", None),
            )
            .await
            .unwrap_err();
        assert_eq!(error, "History capacity reached");
        for id in 0..MAX_SESSIONS {
            registry
                .dispatch(
                    "git.historyGraph.close",
                    owner.clone(),
                    request(&id.to_string(), None),
                )
                .await
                .unwrap();
        }
    }
    #[tokio::test]
    async fn repeated_offset_cannot_skip_or_replay_rows() {
        let (_dir, owner) = fixture();
        let registry = HistorySessions::default();
        registry
            .dispatch("git.historyGraph.open", owner.clone(), request("one", None))
            .await
            .unwrap();
        registry
            .dispatch(
                "git.historyGraph.next",
                owner.clone(),
                request("one", Some(0)),
            )
            .await
            .unwrap();
        assert!(
            registry
                .dispatch(
                    "git.historyGraph.next",
                    owner.clone(),
                    request("one", Some(0))
                )
                .await
                .is_err()
        );
        assert!(
            registry
                .dispatch("git.historyGraph.next", owner, request("one", Some(1)))
                .await
                .is_err()
        );
    }
    #[test]
    fn dropped_wait_cancels_and_wakes_worker() {
        let (tx, rx) = mpsc::sync_channel(1);
        let entry = Arc::new(Entry {
            owner: Owner {
                nid: 1,
                name: "test".into(),
                root: "/project".into(),
                generation: None,
            },
            commands: tx,
            cancelled: Arc::new(AtomicBool::new(false)),
            finished: Arc::new(AtomicBool::new(false)),
            busy: AtomicBool::new(true),
        });
        drop(Pending {
            entry: entry.clone(),
            accepted: false,
        });
        assert!(entry.cancelled.load(Ordering::Relaxed));
        assert!(!entry.busy.load(Ordering::Relaxed));
        assert!(matches!(rx.try_recv(), Ok(Command::Stop)));
    }
}
