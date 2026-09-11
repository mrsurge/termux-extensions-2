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
    pub(crate) commit_id: Option<String>,
    pub(crate) index: Option<usize>,
}

enum Command {
    Files {
        commit: String,
        offset: usize,
        limit: usize,
        reply: ReplySender,
    },
    Blob {
        commit: String,
        index: usize,
        reply: ReplySender,
    },
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
    #[cfg(test)]
    pub(crate) async fn dispatch(&self, method: &str, owner: Owner, params: Request) -> Reply {
        self.dispatch_watched(method, owner, params, None).await
    }

    pub(crate) async fn dispatch_watched(
        &self,
        method: &str,
        owner: Owner,
        params: Request,
        changed: Option<super::history_watch::Changed>,
    ) -> Reply {
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
            "git.historyGraph.open" => self.open(owner, params, changed).await,
            "git.historyGraph.next" => self.next(owner, params).await,
            "git.historyGraph.files" | "git.historyGraph.blob" => {
                self.detail(method, owner, params).await
            }
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

    async fn open(
        &self,
        owner: Owner,
        params: Request,
        changed: Option<super::history_watch::Changed>,
    ) -> Reply {
        if params.limit.is_some()
            || params.offset.is_some()
            || params.commit_id.is_some()
            || params.index.is_some()
        {
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
                run(owner, session, entry, rx, reply, changed);
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
        if params.commit_id.is_some() || params.index.is_some() {
            return Err("Graph next takes no file fields".into());
        }
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

    async fn detail(&self, method: &str, owner: Owner, params: Request) -> Reply {
        let commit = params.commit_id.ok_or("History detail requires commitId")?;
        let (reply, result) = oneshot::channel();
        let command = if method == "git.historyGraph.files" {
            let limit = params.limit.unwrap_or(40);
            if limit == 0 || limit > super::history_files::PAGE_LIMIT || params.index.is_some() {
                return Err("Invalid history files request".into());
            }
            Command::Files {
                commit,
                offset: params.offset.unwrap_or(0),
                limit,
                reply,
            }
        } else {
            if params.offset.is_some() || params.limit.is_some() {
                return Err("Blob request takes no page fields".into());
            }
            Command::Blob {
                commit,
                index: params.index.ok_or("Blob request requires index")?,
                reply,
            }
        };
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
        entry
            .commands
            .try_send(command)
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
    changed: Option<super::history_watch::Changed>,
) {
    let repo = match git2::Repository::open(&owner.root) {
        Ok(repo) => repo,
        Err(error) => {
            let _ = reply.send(Err(error.to_string()));
            return;
        }
    };
    let _watcher = match changed
        .map(|callback| super::history_watch::HistoryWatch::new(&repo, callback))
        .transpose()
    {
        Ok(watcher) => watcher,
        Err(error) => {
            let _ = reply.send(Err(format!("History watcher unavailable: {error}")));
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
    let mut file_reader: Option<super::history_files::FileReader<'_>> = None;
    // This is one idle lease, not periodic polling. Close wakes the channel;
    // the timer bounds orphaned workers after a lost Python process/transport.
    while !entry.cancelled.load(Ordering::Relaxed) {
        let command = match commands.recv_timeout(IDLE_TIMEOUT) {
            Ok(command) => command,
            Err(_) => break,
        };
        let command = match command {
            Command::Files {
                commit,
                offset,
                limit,
                reply,
            } => {
                let result = details(&repo, &mut file_reader, &commit, &entry.cancelled)
                    .and_then(|reader| reader.page(offset, limit, &entry.cancelled))
                    .map(|page| json!({"dto":"GitHistoryFilesResult", "version":1, "sessionId":session, "page":page}));
                if reply.send(result).is_err() {
                    break;
                }
                continue;
            }
            Command::Blob {
                commit,
                index,
                reply,
            } => {
                let result = details(&repo, &mut file_reader, &commit, &entry.cancelled)
                    .and_then(|reader| reader.pair(index, &entry.cancelled))
                    .map(|pair| json!({"dto":"GitHistoryBlobResult", "version":1, "sessionId":session, "pair":pair}));
                if reply.send(result).is_err() {
                    break;
                }
                continue;
            }
            command => command,
        };
        let Command::Page {
            limit,
            offset,
            reply,
        } = command
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

fn details<'a, 'repo>(
    repo: &'repo git2::Repository,
    cache: &'a mut Option<super::history_files::FileReader<'repo>>,
    commit: &str,
    cancelled: &AtomicBool,
) -> Result<&'a super::history_files::FileReader<'repo>, String> {
    if cache
        .as_ref()
        .is_none_or(|reader| reader.commit_id != commit)
    {
        *cache = Some(super::history_files::FileReader::new(
            repo, commit, cancelled,
        )?);
    }
    cache
        .as_ref()
        .ok_or_else(|| "History files unavailable".into())
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
        let mut builder = repo.treebuilder(None).unwrap();
        builder
            .insert("test.py", repo.blob(b"hello\n").unwrap(), 0o100644)
            .unwrap();
        let tree = builder.write().unwrap();
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
            commit_id: None,
            index: None,
        }
    }
    #[tokio::test]
    async fn history_watched_session_releases_watch_on_close() {
        let (_dir, owner) = fixture();
        let registry = HistorySessions::default();
        let (tx, rx) = mpsc::channel();
        let callback = Arc::new(move |result| {
            let _ = tx.send(result);
        });
        let _ = registry
            .dispatch_watched(
                "git.historyGraph.open",
                owner.clone(),
                request("watched", None),
                Some(callback),
            )
            .await
            .unwrap();
        let repo = git2::Repository::open(&owner.root).unwrap();
        let head = repo.head().unwrap().target().unwrap();
        repo.reference("refs/tags/watched", head, true, "test")
            .unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), Ok(()));
        let _ = registry
            .dispatch("git.historyGraph.close", owner, request("watched", None))
            .await
            .unwrap();
        assert!(matches!(
            rx.recv_timeout(Duration::from_secs(3)),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ));
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
        let mut files_request = request("one", None);
        files_request.commit_id = Some(opened["snapshot"]["headId"].as_str().unwrap().into());
        let files = registry
            .dispatch("git.historyGraph.files", owner.clone(), files_request)
            .await
            .unwrap();
        assert_eq!(files["page"]["files"][0]["counts"]["additions"], 1);
        let mut blob_request = request("one", None);
        blob_request.commit_id = Some(opened["snapshot"]["headId"].as_str().unwrap().into());
        blob_request.index = Some(0);
        let blob = registry
            .dispatch("git.historyGraph.blob", owner.clone(), blob_request)
            .await
            .unwrap();
        assert_eq!(blob["pair"]["modified"]["text"], "hello\n");
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
        let scheduler = super::super::scheduler::FrameworkServiceScheduler::default();
        let registry = &scheduler.history_sessions;
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
        // Filling History's admission budget must not consume the independent
        // baseline-read permits used by primary editor opens.
        let baseline = tokio::time::timeout(
            Duration::from_secs(3),
            scheduler.git_head_blob(super::super::git_ops::GitProviderRequest {
                root: Some(owner.root.clone()),
                relative_path: Some("test.py".into()),
                ..Default::default()
            }),
        )
        .await
        .expect("History admission blocked a baseline read")
        .unwrap();
        assert!(baseline.found);
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
