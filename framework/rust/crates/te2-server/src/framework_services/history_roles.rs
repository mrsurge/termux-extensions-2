//! Read-only VS Code Git history roles. These are reference roles, not a merge
//! base OID or a reason to rewrite ancestry. Every returned ref comes from the
//! captured graph snapshot; unresolved candidates fall through without mutation.
use super::history_graph::GraphRef;
use git2::{BranchType, Repository};

fn captured(refs: &[GraphRef], name: &str) -> Option<GraphRef> {
    refs.iter().find(|r| r.name == name).cloned()
}
fn named(refs: &[GraphRef], name: &str) -> Option<GraphRef> {
    if name.starts_with("refs/") {
        return captured(refs, name);
    }
    let local = captured(refs, &format!("refs/heads/{name}"));
    let remote = captured(refs, &format!("refs/remotes/{name}"));
    match (local, remote) {
        (Some(_), Some(_)) => None, // Ambiguous shorthand is not ancestry evidence.
        (local, remote) => local.or(remote),
    }
}
fn upstream(repo: &Repository, refs: &[GraphRef], name: &str) -> Option<GraphRef> {
    let branch = repo
        .find_branch(name.strip_prefix("refs/heads/")?, BranchType::Local)
        .ok()?;
    let tracking = branch.upstream().ok()?;
    captured(refs, tracking.get().name()?)
}
fn remote_candidate(repo: &Repository, refs: &[GraphRef], candidate: GraphRef) -> Option<GraphRef> {
    if candidate.name.starts_with("refs/remotes/") {
        return Some(candidate);
    }
    upstream(repo, refs, &candidate.name).filter(|r| r.name.starts_with("refs/remotes/"))
}

// Bound reflog materialization before libgit2 reads it. Missing/expired/oversized
// evidence is not an error for browsing: the remote-HEAD fallback remains usable.
fn messages(repo: &Repository, name: &str) -> Option<Vec<String>> {
    let root = if name == "HEAD" {
        repo.path()
    } else {
        repo.commondir()
    };
    let path = root.join("logs").join(name);
    if std::fs::metadata(path).ok()?.len() > 1024 * 1024 {
        return None;
    }
    let log = repo.reflog(name).ok()?;
    if log.len() > 4096 {
        return None;
    }
    Some(
        log.iter()
            .filter_map(|entry| entry.message().map(str::to_owned))
            .collect(),
    )
}

pub(crate) fn resolve(
    repo: &Repository,
    refs: &[GraphRef],
    head: Option<&str>,
) -> (Option<GraphRef>, Option<GraphRef>) {
    let Some(head) = head.filter(|name| name.starts_with("refs/heads/")) else {
        return (None, None);
    };
    let tracking = upstream(repo, refs, head);
    let branch_name = head.trim_start_matches("refs/heads/");
    let configured = repo
        .config()
        .and_then(|mut config| config.snapshot())
        .ok()
        .and_then(|config| {
            config
                .get_string(&format!("branch.{branch_name}.vscode-merge-base"))
                .ok()
        })
        .and_then(|name| named(refs, &name))
        .filter(|r| r.name.starts_with("refs/remotes/"));
    let base = configured
        .or_else(|| {
            let log = messages(repo, head)?;
            let created: Vec<_> = log
                .iter()
                .filter_map(|message| message.strip_prefix("branch: Created from "))
                .collect();
            if created.len() != 1 {
                return None;
            }
            let source = if created[0] == "HEAD" {
                let suffix = format!(" to {branch_name}");
                // Reflogs are newest-first; VS Code uses the oldest matching checkout.
                messages(repo, "HEAD")?.iter().rev().find_map(|message| {
                    message
                        .strip_prefix("checkout: moving from ")?
                        .strip_suffix(&suffix)
                        .map(str::to_owned)
                })?
            } else {
                created[0].to_owned()
            };
            remote_candidate(repo, refs, named(refs, &source)?)
        })
        .or_else(|| {
            // Match VS Code's default remote selection; never assume main/master.
            let remotes = repo.remotes().ok()?;
            let remote = remotes
                .iter()
                .flatten()
                .find(|name| *name == "origin")
                .or_else(|| remotes.iter().flatten().next())?;
            let reference = repo
                .find_reference(&format!("refs/remotes/{remote}/HEAD"))
                .ok()?;
            let target = reference.resolve().ok()?;
            captured(refs, target.name()?).filter(|r| r.name.starts_with("refs/remotes/"))
        });
    let base = base.filter(|base| {
        tracking
            .as_ref()
            .is_none_or(|remote| remote.name != base.name)
    });
    (tracking, base)
}

#[cfg(test)]
mod tests {
    use super::super::history_graph::GraphReader;
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn fixture() -> (tempfile::TempDir, Repository, Vec<GraphRef>) {
        let root = std::env::var_os("TMPDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap());
        let dir = tempfile::Builder::new()
            .prefix("history-roles-")
            .tempdir_in(root)
            .unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let oid = {
            let tree = repo
                .find_tree(repo.treebuilder(None).unwrap().write().unwrap())
                .unwrap();
            let sig = git2::Signature::now("Test", "test@example.invalid").unwrap();
            repo.commit(None, &sig, &sig, "root", &tree, &[]).unwrap()
        };
        repo.remote("origin", "https://example.invalid/repo")
            .unwrap();
        for name in [
            "refs/heads/topic",
            "refs/heads/trunk",
            "refs/remotes/origin/topic",
            "refs/remotes/origin/trunk",
            "refs/remotes/origin/other",
        ] {
            repo.reference(name, oid, true, "fixture").unwrap();
        }
        repo.reference_symbolic(
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/trunk",
            true,
            "fixture",
        )
        .unwrap();
        repo.set_head("refs/heads/topic").unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("branch.topic.remote", "origin").unwrap();
        config
            .set_str("branch.topic.merge", "refs/heads/topic")
            .unwrap();
        config.set_str("branch.trunk.remote", "origin").unwrap();
        config
            .set_str("branch.trunk.merge", "refs/heads/trunk")
            .unwrap();
        let refs = repo
            .references()
            .unwrap()
            .map(|r| {
                let r = r.unwrap();
                GraphRef {
                    name: r.name().unwrap().into(),
                    commit_id: r.peel_to_commit().unwrap().id().to_string(),
                }
            })
            .collect();
        drop(config);
        (dir, repo, refs)
    }
    fn reflog(repo: &Repository, name: &str, message: &str) {
        repo.reference_ensure_log(name).unwrap();
        let mut log = repo.reflog(name).unwrap();
        let sig = git2::Signature::now("Test", "test@example.invalid").unwrap();
        let oid = repo.head().unwrap().peel_to_commit().unwrap().id();
        log.append(oid, &sig, Some(message)).unwrap();
        log.write().unwrap();
    }
    #[test]
    fn remote_head_fallback_and_upstream_are_distinct_without_writing_config() {
        let (_dir, repo, refs) = fixture();
        let before = std::fs::read(repo.path().join("config")).unwrap();
        let (remote, base) = resolve(&repo, &refs, Some("refs/heads/topic"));
        assert_eq!(remote.unwrap().name, "refs/remotes/origin/topic");
        assert_eq!(base.unwrap().name, "refs/remotes/origin/trunk");
        assert_eq!(before, std::fs::read(repo.path().join("config")).unwrap());
    }
    #[test]
    fn configured_remote_base_wins_and_changes_snapshot_identity_without_tip_changes() {
        let (_dir, repo, _refs) = fixture();
        let cancel = AtomicBool::new(false);
        let first = GraphReader::new(&repo, &cancel)
            .unwrap()
            .snapshot()
            .snapshot_id
            .clone();
        repo.config()
            .unwrap()
            .set_str("branch.topic.vscode-merge-base", "origin/other")
            .unwrap();
        let reader = GraphReader::new(&repo, &cancel).unwrap();
        assert_eq!(
            reader.snapshot().base_ref.as_ref().unwrap().name,
            "refs/remotes/origin/other"
        );
        assert_ne!(first, reader.snapshot().snapshot_id);
    }
    #[test]
    fn explicit_creation_reflog_beats_default_and_local_creation_uses_its_upstream() {
        let (_dir, repo, refs) = fixture();
        reflog(
            &repo,
            "refs/heads/topic",
            "branch: Created from origin/other",
        );
        assert_eq!(
            resolve(&repo, &refs, Some("refs/heads/topic"))
                .1
                .unwrap()
                .name,
            "refs/remotes/origin/other"
        );
        let (_dir2, repo2, refs2) = fixture();
        reflog(&repo2, "refs/heads/topic", "branch: Created from trunk");
        assert_eq!(
            resolve(&repo2, &refs2, Some("refs/heads/topic"))
                .1
                .unwrap()
                .name,
            "refs/remotes/origin/trunk"
        );
    }
    #[test]
    fn creation_from_head_uses_oldest_matching_checkout() {
        let (_dir, repo, refs) = fixture();
        reflog(&repo, "refs/heads/topic", "branch: Created from HEAD");
        // Exclude the fixture's initial set_head checkout; model the two
        // historical checkouts under test, not setup-time reflog evidence.
        repo.reflog_delete("HEAD").unwrap();
        reflog(&repo, "HEAD", "checkout: moving from origin/other to topic");
        reflog(&repo, "HEAD", "checkout: moving from trunk to topic");
        assert_eq!(
            resolve(&repo, &refs, Some("refs/heads/topic"))
                .1
                .unwrap()
                .name,
            "refs/remotes/origin/other"
        );
    }
    #[test]
    fn local_upstream_is_allowed_but_duplicate_base_role_is_suppressed() {
        let (_dir, repo, refs) = fixture();
        repo.config()
            .unwrap()
            .set_str("branch.topic.remote", ".")
            .unwrap();
        repo.config()
            .unwrap()
            .set_str("branch.topic.merge", "refs/heads/trunk")
            .unwrap();
        assert_eq!(
            resolve(&repo, &refs, Some("refs/heads/topic"))
                .0
                .unwrap()
                .name,
            "refs/heads/trunk"
        );
        repo.config()
            .unwrap()
            .set_str("branch.topic.remote", "origin")
            .unwrap();
        assert!(resolve(&repo, &refs, Some("refs/heads/topic")).1.is_none());
    }
    #[test]
    fn missing_roles_and_detached_head_do_not_guess_or_escape_snapshot() {
        let (_dir, repo, refs) = fixture();
        assert_eq!(resolve(&repo, &refs, Some("HEAD")), (None, None));
        assert_eq!(resolve(&repo, &[], Some("refs/heads/topic")), (None, None));
        repo.config()
            .unwrap()
            .set_str("branch.topic.vscode-merge-base", "origin/missing")
            .unwrap();
        repo.find_reference("refs/remotes/origin/HEAD")
            .unwrap()
            .delete()
            .unwrap();
        assert!(resolve(&repo, &refs, Some("refs/heads/topic")).1.is_none());
    }
}
