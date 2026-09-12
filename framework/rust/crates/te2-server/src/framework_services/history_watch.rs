//! One-shot metadata invalidation. A replacement session installs watches before
//! reading its snapshot, so a change during initialization cannot be lost.
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::BTreeSet,
    path::Path,
    sync::{Arc, mpsc},
};

pub(crate) type Changed = Arc<dyn Fn(Result<(), String>) + Send + Sync>;
const MAX_DIRECTORIES: usize = 4096;

pub(crate) struct HistoryWatch {
    _watcher: RecommendedWatcher,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn watch(repo: &git2::Repository) -> (HistoryWatch, mpsc::Receiver<Result<(), String>>) {
        let (tx, rx) = mpsc::channel();
        let watcher = HistoryWatch::new(
            repo,
            Arc::new(move |result| {
                let _ = tx.send(result);
            }),
        )
        .unwrap();
        (watcher, rx)
    }

    fn commit(repo: &git2::Repository) -> git2::Oid {
        let tree = repo.treebuilder(None).unwrap().write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "root",
            &repo.find_tree(tree).unwrap(),
            &[],
        )
        .unwrap()
    }

    #[test]
    fn history_watch_filters_metadata_not_worktree_or_objects() {
        let git = Path::new("/repo/.git/worktrees/linked");
        let common = Path::new("/repo/.git");
        for path in [
            git.join("HEAD"),
            common.join("packed-refs"),
            common.join("shallow"),
            common.join("config"),
            git.join("config.worktree"),
            common.join("refs/heads/nested/branch"),
            common.join("refs/remotes/origin/main"),
            common.join("refs/tags/v1"),
        ] {
            assert!(relevant(&path, git, common), "{}", path.display());
        }
        for path in [
            common.join("index"),
            common.join("objects/ab/cd"),
            common.join("logs/refs/heads/main"),
            common.join("refs/heads/main.lock"),
            Path::new("/repo/file.rs").to_owned(),
        ] {
            assert!(!relevant(&path, git, common), "{}", path.display());
        }
    }

    #[test]
    fn history_watch_overflow_and_error_are_explicit() {
        let root = Path::new("/repo/.git");
        let overflow = Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan);
        assert!(classify(Ok(overflow), root, root).unwrap().is_err());
        assert!(
            classify(Err(notify::Error::generic("test")), root, root)
                .unwrap()
                .is_err()
        );
        let access = Event::new(EventKind::Access(notify::event::AccessKind::Any))
            .add_path(root.join("HEAD"));
        assert!(classify(Ok(access), root, root).is_none());
    }

    #[test]
    fn history_watch_detects_shared_refs_from_linked_worktree() {
        let temp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(temp.path().join("main")).unwrap();
        let oid = commit(&repo);
        let linked = temp.path().join("linked");
        repo.worktree("linked", &linked, None).unwrap();
        let linked_repo = git2::Repository::open(linked).unwrap();
        assert_ne!(linked_repo.path(), linked_repo.commondir());
        let (_watch, rx) = watch(&linked_repo);
        repo.reference("refs/tags/new-tag", oid, true, "test")
            .unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), Ok(()));
    }

    #[test]
    fn history_watch_detects_role_config_and_current_branch_reflog_changes() {
        let root = std::env::var_os("TMPDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap());
        let temp = tempfile::Builder::new()
            .prefix("history-role-watch-")
            .tempdir_in(root)
            .unwrap();
        let repo = git2::Repository::init(temp.path()).unwrap();
        let oid = commit(&repo);
        {
            let (_watch, rx) = watch(&repo);
            repo.config()
                .unwrap()
                .set_str("branch.main.vscode-merge-base", "origin/other")
                .unwrap();
            assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), Ok(()));
        }
        let name = repo.head().unwrap().name().unwrap().to_owned();
        repo.reference_ensure_log(&name).unwrap();
        {
            let (_watch, rx) = watch(&repo);
            let mut log = repo.reflog(&name).unwrap();
            let sig = git2::Signature::now("Test", "test@example.invalid").unwrap();
            log.append(oid, &sig, Some("branch: Created from origin/other"))
                .unwrap();
            log.write().unwrap();
            assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), Ok(()));
        }
    }

    #[test]
    fn history_watch_atomic_packed_refs_and_teardown() {
        let temp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(temp.path()).unwrap();
        let (_watch, rx) = watch(&repo);
        let staged = repo.path().join("packed-refs.lock");
        std::fs::write(&staged, "# pack-refs with: peeled\n").unwrap();
        std::fs::rename(staged, repo.path().join("packed-refs")).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), Ok(()));
        let (watch, rx) = watch(&repo);
        drop(watch);
        assert!(matches!(
            rx.recv_timeout(Duration::from_secs(3)),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ));
    }

    #[test]
    fn history_watch_captures_change_before_snapshot_and_new_ref_directory() {
        let temp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(temp.path()).unwrap();
        let oid = commit(&repo);
        let (_watch, rx) = watch(&repo);
        repo.reference("refs/heads/nested/new", oid, true, "test")
            .unwrap();
        let _reader = super::super::history_graph::GraphReader::new(
            &repo,
            &std::sync::atomic::AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), Ok(()));
    }
}

fn relevant(path: &Path, git: &Path, common: &Path) -> bool {
    if path
        .file_name()
        .is_some_and(|name| name.to_string_lossy().ends_with(".lock"))
    {
        return false;
    }
    [git, common].iter().any(|root| {
        let Ok(relative) = path.strip_prefix(root) else {
            return false;
        };
        let parts: Vec<_> = relative.iter().filter_map(|p| p.to_str()).collect();
        matches!(
            parts.as_slice(),
            [] | ["HEAD"]
                | ["packed-refs"]
                | ["shallow"]
                | ["refs"]
                | ["config"]
                | ["config.worktree"]
        ) || parts.len() >= 2
            && parts[0] == "refs"
            && matches!(parts[1], "heads" | "tags" | "remotes")
    })
}

impl HistoryWatch {
    pub(crate) fn new(repo: &git2::Repository, changed: Changed) -> Result<Self, String> {
        let git = repo.path().canonicalize().map_err(|e| e.to_string())?;
        let common = repo.commondir().canonicalize().map_err(|e| e.to_string())?;
        // Role evidence is scoped to HEAD and its branch, not every reflog.
        // Repository config lives under the already watched metadata roots.
        // Changes to external/global included config require explicit Refresh.
        let mut role_paths = vec![git.join("logs/HEAD")];
        if let Ok(head) = repo.head() {
            if let Some(name) = head.name().filter(|name| name.starts_with("refs/heads/")) {
                role_paths.push(common.join("logs").join(name));
            }
        }
        let role_directories: Vec<_> = role_paths
            .iter()
            .flat_map(|path| {
                path.ancestors()
                    .skip(1)
                    .take_while(|ancestor| *ancestor != git && *ancestor != common)
                    .filter(|ancestor| ancestor.is_dir())
                    .map(Path::to_path_buf)
                    .collect::<Vec<_>>()
            })
            .collect();
        let (tx, rx) = mpsc::sync_channel(1);
        let event_git = git.clone();
        let event_common = common.clone();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            let role_change = result.as_ref().is_ok_and(|event| {
                !matches!(event.kind, EventKind::Access(_))
                    && event
                        .paths
                        .iter()
                        .any(|path| role_paths.iter().any(|role| role.starts_with(path)))
            });
            let signal = classify(result, &event_git, &event_common)
                .or_else(|| role_change.then_some(Ok(())));
            // Never block the OS callback or retain an unbounded event history.
            if let Some(signal) = signal {
                let _ = tx.try_send(signal);
            }
        })
        .map_err(|e| e.to_string())?;
        let mut seen = BTreeSet::new();
        let mut pending = vec![git.clone(), common.clone()];
        pending.extend(role_directories);
        // Nonrecursive metadata-root watches catch atomic replacement and creation
        // of refs directories. Enumerate ref directories plus exact role-evidence
        // ancestors above, never the object store or the full reflog tree.
        while let Some(path) = pending.pop() {
            if !seen.insert(path.clone()) {
                continue;
            }
            if seen.len() > MAX_DIRECTORIES {
                return Err("History watcher directory limit".into());
            }
            watcher
                .watch(&path, RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())?;
            if path == git || path == common {
                let refs = path.join("refs");
                if refs.is_dir() {
                    pending.push(refs);
                }
            } else {
                for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    if entry.file_type().map_err(|e| e.to_string())?.is_dir()
                        && relevant(&entry.path(), &git, &common)
                    {
                        if seen.len() + pending.len() >= MAX_DIRECTORIES {
                            return Err("History watcher directory limit".into());
                        }
                        pending.push(entry.path());
                    }
                }
            }
        }
        // Pipe writes run off the watcher thread. At most one notification is
        // sent per immutable session; dropping the watcher disconnects the wait.
        std::thread::Builder::new()
            .name("history-ref-event".into())
            .spawn(move || {
                if let Ok(signal) = rx.recv() {
                    changed(signal);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { _watcher: watcher })
    }
}

fn classify(
    result: notify::Result<Event>,
    git: &Path,
    common: &Path,
) -> Option<Result<(), String>> {
    match result {
        Err(error) => Some(Err(format!("History watcher failed: {error}"))),
        Ok(event) if event.need_rescan() => {
            Some(Err("History watcher overflow; refresh required".into()))
        }
        Ok(event)
            if !matches!(event.kind, EventKind::Access(_))
                && event.paths.iter().any(|p| relevant(p, git, common)) =>
        {
            Some(Ok(()))
        }
        _ => None,
    }
}
