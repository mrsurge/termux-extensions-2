//! Metadata-only, pinned history traversal. The caller owns the blocking worker
//! and keeps this reader alive between page requests; no offset rescans or stats.
use git2::{ErrorCode, Oid, Repository, Revwalk, Sort};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    sync::atomic::{AtomicBool, Ordering},
};

const MAX_REFS: usize = 4096;
const MAX_TEXT_BYTES: usize = 16 * 1024;
pub(crate) const DEFAULT_PAGE_SIZE: usize = 100;
pub(crate) const MAX_PAGE_SIZE: usize = 500;

#[derive(Debug)]
pub(crate) enum GraphError {
    Git(git2::Error),
    Cancelled,
    InvalidPageSize,
    Limit(&'static str),
    Unavailable,
}

impl From<git2::Error> for GraphError {
    fn from(value: git2::Error) -> Self {
        Self::Git(value)
    }
}

impl std::fmt::Display for GraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Git(error) => write!(f, "History read failed: {error}"),
            Self::Cancelled => f.write_str("History read cancelled"),
            Self::InvalidPageSize => f.write_str("History page size must be between 1 and 500"),
            Self::Limit(field) => write!(f, "History metadata limit exceeded: {field}"),
            Self::Unavailable => f.write_str("History reader must be recreated after failure"),
        }
    }
}

impl std::error::Error for GraphError {}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphRef {
    pub(crate) name: String,
    pub(crate) commit_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphSnapshot {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) snapshot_id: String,
    pub(crate) head_id: Option<String>,
    pub(crate) head_ref: Option<String>,
    pub(crate) refs: Vec<GraphRef>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphCommit {
    pub(crate) id: String,
    pub(crate) parent_ids: Vec<String>,
    pub(crate) subject: String,
    pub(crate) author: String,
    pub(crate) timestamp: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphPage {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) snapshot_id: String,
    pub(crate) offset: usize,
    pub(crate) commits: Vec<GraphCommit>,
    pub(crate) complete: bool,
}

pub(crate) struct GraphReader<'repo> {
    repo: &'repo Repository,
    walk: Revwalk<'repo>,
    snapshot: GraphSnapshot,
    offset: usize,
    complete: bool,
    failed: bool,
}

fn check(cancelled: &AtomicBool) -> Result<(), GraphError> {
    if cancelled.load(Ordering::Relaxed) {
        Err(GraphError::Cancelled)
    } else {
        Ok(())
    }
}

fn text(value: &[u8]) -> Result<String, GraphError> {
    if value.len() > MAX_TEXT_BYTES {
        return Err(GraphError::Limit("metadata text"));
    }
    Ok(String::from_utf8_lossy(value).into_owned())
}

impl<'repo> GraphReader<'repo> {
    pub(crate) fn new(repo: &'repo Repository, cancelled: &AtomicBool) -> Result<Self, GraphError> {
        check(cancelled)?;
        let mut refs = Vec::new();
        let mut tips = BTreeSet::new();
        for reference in repo.references()? {
            check(cancelled)?;
            let reference = reference?;
            if !(reference.is_branch() || reference.is_remote() || reference.is_tag()) {
                continue;
            }
            // Tags pointing to trees/blobs are valid refs, but not history roots.
            let object = reference.peel(git2::ObjectType::Any)?;
            if object.kind() != Some(git2::ObjectType::Commit) {
                continue;
            }
            if refs.len() == MAX_REFS {
                return Err(GraphError::Limit("references"));
            }
            let name = text(reference.name_bytes())?;
            let oid = object.id();
            tips.insert(oid);
            refs.push(GraphRef {
                name,
                commit_id: oid.to_string(),
            });
        }
        refs.sort_by(|a, b| a.name.cmp(&b.name));
        let (head_id, head_ref) = match repo.head() {
            Ok(head) => {
                let oid = head.peel_to_commit()?.id();
                tips.insert(oid);
                (Some(oid.to_string()), Some(text(head.name_bytes())?))
            }
            Err(error) if matches!(error.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) => {
                (None, None)
            }
            Err(error) => return Err(error.into()),
        };
        // Length-prefixed fields avoid collisions between arbitrary ref names.
        let mut hash = Sha256::new();
        for field in std::iter::once("te2-history-v1")
            .chain(head_id.as_deref())
            .chain(head_ref.as_deref())
            .chain(
                refs.iter()
                    .flat_map(|r| [r.name.as_str(), r.commit_id.as_str()]),
            )
        {
            hash.update((field.len() as u64).to_be_bytes());
            hash.update(field.as_bytes());
        }
        let snapshot = GraphSnapshot {
            dto: "GitHistorySnapshot",
            version: 1,
            snapshot_id: format!("{:x}", hash.finalize()),
            head_id,
            head_ref,
            refs,
        };
        let mut walk = repo.revwalk()?;
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
        for tip in &tips {
            check(cancelled)?;
            walk.push(*tip)?;
        }
        Ok(Self {
            repo,
            walk,
            snapshot,
            offset: 0,
            complete: tips.is_empty(),
            failed: false,
        })
    }

    pub(crate) fn snapshot(&self) -> &GraphSnapshot {
        &self.snapshot
    }

    pub(crate) fn next_page(
        &mut self,
        limit: usize,
        cancelled: &AtomicBool,
    ) -> Result<GraphPage, GraphError> {
        if limit == 0 || limit > MAX_PAGE_SIZE {
            return Err(GraphError::InvalidPageSize);
        }
        if self.failed {
            return Err(GraphError::Unavailable);
        }
        let result = self.read_page(limit, cancelled);
        // A failed partially consumed page cannot be resumed without losing rows.
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    fn read_page(&mut self, limit: usize, cancelled: &AtomicBool) -> Result<GraphPage, GraphError> {
        check(cancelled)?;
        let mut commits = Vec::new();
        while !self.complete && commits.len() < limit {
            check(cancelled)?;
            // libgit2 may prepare topology within next(); cancellation is checked
            // before/after it, not claimed to interrupt the native call itself.
            let next = self.walk.next();
            check(cancelled)?;
            let Some(oid) = next else {
                self.complete = true;
                break;
            };
            let commit = self.repo.find_commit(oid?)?;
            if commit.parent_count() > 128 {
                return Err(GraphError::Limit("commit parents"));
            }
            commits.push(GraphCommit {
                id: commit.id().to_string(),
                parent_ids: commit.parent_ids().map(|id| id.to_string()).collect(),
                subject: text(commit.summary_bytes().unwrap_or_default())?,
                author: text(commit.author().name_bytes())?,
                timestamp: commit.time().seconds(),
            });
        }
        let page = GraphPage {
            dto: "GitHistoryPage",
            version: 1,
            snapshot_id: self.snapshot.snapshot_id.clone(),
            offset: self.offset,
            commits,
            complete: self.complete,
        };
        self.offset += page.commits.len();
        Ok(page)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn repository() -> (tempfile::TempDir, Repository) {
        let root = std::env::var_os("TMPDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap());
        let dir = tempfile::Builder::new()
            .prefix("te2-history-test-")
            .tempdir_in(root)
            .unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        (dir, repo)
    }
    fn commit(repo: &Repository, name: &str, parents: &[Oid]) -> Oid {
        let tree_id = repo.treebuilder(None).unwrap().write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig =
            git2::Signature::new("Test", "test@example.invalid", &git2::Time::new(100, 0)).unwrap();
        let parents: Vec<_> = parents
            .iter()
            .map(|id| repo.find_commit(*id).unwrap())
            .collect();
        repo.commit(
            None,
            &sig,
            &sig,
            name,
            &tree,
            &parents.iter().collect::<Vec<_>>(),
        )
        .unwrap()
    }
    fn drain(reader: &mut GraphReader<'_>, size: usize) -> Vec<GraphCommit> {
        let mut rows = Vec::new();
        loop {
            let page = reader.next_page(size, &AtomicBool::new(false)).unwrap();
            assert_eq!(page.offset, rows.len());
            rows.extend(page.commits);
            if page.complete {
                return rows;
            }
        }
    }
    #[test]
    fn pages_preserve_merge_topology_parent_order_and_ref_snapshot() {
        let (_dir, repo) = repository();
        let root = commit(&repo, "root", &[]);
        let left = commit(&repo, "left", &[root]);
        let right = commit(&repo, "right", &[root]);
        let merge = commit(&repo, "merge", &[left, right]);
        repo.reference("refs/heads/main", merge, true, "test")
            .unwrap();
        repo.set_head("refs/heads/main").unwrap();
        let cancel = AtomicBool::new(false);
        let mut small = GraphReader::new(&repo, &cancel).unwrap();
        let mut full = GraphReader::new(&repo, &cancel).unwrap();
        let rows = drain(&mut small, 1);
        assert_eq!(
            rows.iter().map(|r| &r.id).collect::<Vec<_>>(),
            drain(&mut full, DEFAULT_PAGE_SIZE)
                .iter()
                .map(|r| &r.id)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            rows[0].parent_ids,
            vec![left.to_string(), right.to_string()]
        );
        assert_eq!(rows.last().unwrap().id, root.to_string());
        assert!(rows.last().unwrap().parent_ids.is_empty());
        let mut pinned = GraphReader::new(&repo, &cancel).unwrap();
        let identity = pinned.snapshot().snapshot_id.clone();
        let newer = commit(&repo, "newer", &[merge]);
        repo.reference("refs/heads/main", newer, true, "test")
            .unwrap();
        assert_eq!(drain(&mut pinned, 2).len(), 4);
        assert_eq!(pinned.snapshot().head_id, Some(merge.to_string()));
        assert_ne!(
            GraphReader::new(&repo, &cancel)
                .unwrap()
                .snapshot()
                .snapshot_id,
            identity
        );
    }
    #[test]
    fn cancellation_invalidates_reader_and_page_limits_do_not_consume() {
        let (_dir, repo) = repository();
        let id = commit(&repo, "root", &[]);
        repo.reference("refs/heads/main", id, true, "test").unwrap();
        let cancel = AtomicBool::new(false);
        let mut reader = GraphReader::new(&repo, &cancel).unwrap();
        assert!(matches!(
            reader.next_page(0, &cancel),
            Err(GraphError::InvalidPageSize)
        ));
        assert!(matches!(
            reader.next_page(MAX_PAGE_SIZE + 1, &cancel),
            Err(GraphError::InvalidPageSize)
        ));
        cancel.store(true, Ordering::Relaxed);
        assert!(matches!(
            reader.next_page(1, &cancel),
            Err(GraphError::Cancelled)
        ));
        cancel.store(false, Ordering::Relaxed);
        assert!(matches!(
            reader.next_page(1, &cancel),
            Err(GraphError::Unavailable)
        ));
    }
    #[test]
    fn empty_repository_and_detached_head_are_explicit() {
        let (_dir, repo) = repository();
        let cancel = AtomicBool::new(false);
        let mut empty = GraphReader::new(&repo, &cancel).unwrap();
        assert!(empty.snapshot().head_id.is_none());
        assert!(empty.next_page(100, &cancel).unwrap().complete);
        let id = commit(&repo, "detached", &[]);
        repo.set_head_detached(id).unwrap();
        let mut reader = GraphReader::new(&repo, &cancel).unwrap();
        assert_eq!(reader.snapshot().head_ref.as_deref(), Some("HEAD"));
        assert_eq!(drain(&mut reader, 100)[0].id, id.to_string());
    }

    #[test]
    fn tags_remote_refs_and_disconnected_roots_are_retained_without_duplicates() {
        let (_dir, repo) = repository();
        let first = commit(&repo, "first", &[]);
        let second = commit(&repo, "second", &[]);
        repo.reference("refs/heads/main", first, true, "test")
            .unwrap();
        repo.reference("refs/remotes/origin/other", second, true, "test")
            .unwrap();
        let sig = git2::Signature::now("Test", "test@example.invalid").unwrap();
        let object = repo.find_object(first, None).unwrap();
        repo.tag("release", &object, &sig, "annotated", false)
            .unwrap();
        // A tree-only tag must not be fed into revwalk as a commit.
        let tree = repo.find_commit(first).unwrap().tree().unwrap();
        repo.tag_lightweight("tree-only", tree.as_object(), false)
            .unwrap();
        let mut reader = GraphReader::new(&repo, &AtomicBool::new(false)).unwrap();
        assert_eq!(reader.snapshot().refs.len(), 3);
        assert!(
            reader
                .snapshot()
                .refs
                .iter()
                .any(|r| r.name == "refs/tags/release" && r.commit_id == first.to_string())
        );
        let rows = drain(&mut reader, 1);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows.iter().map(|r| &r.id).collect::<BTreeSet<_>>().len(), 2);
    }

    #[test]
    fn failed_partial_page_cannot_silently_skip_a_commit() {
        let (_dir, repo) = repository();
        let root = commit(&repo, &"x".repeat(MAX_TEXT_BYTES + 1), &[]);
        let child = commit(&repo, "child", &[root]);
        repo.reference("refs/heads/main", child, true, "test")
            .unwrap();
        let cancel = AtomicBool::new(false);
        let mut reader = GraphReader::new(&repo, &cancel).unwrap();
        assert!(matches!(
            reader.next_page(100, &cancel),
            Err(GraphError::Limit("metadata text"))
        ));
        assert!(matches!(
            reader.next_page(100, &cancel),
            Err(GraphError::Unavailable)
        ));
    }
}
