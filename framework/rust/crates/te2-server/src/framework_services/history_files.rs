//! Lazy first-parent summaries and bounded, immutable historical text pairs.
use git2::{Delta, Diff, DiffFindOptions, DiffOptions, Oid, Patch, Repository};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

const TEXT_LIMIT: usize = 375 * 1024;
// Counting is not preview admission. Allow bounded generated sources without
// sending large text to Python/Monaco; each native read still handles one file.
const COUNT_LIMIT: usize = 16 * 1024 * 1024;
const FILE_LIMIT: usize = 20_000;
pub(crate) const PAGE_LIMIT: usize = 100;

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub(crate) enum Counts {
    Ready { additions: usize, deletions: usize },
    Binary,
    TooLarge,
    Unavailable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileSummary {
    index: usize,
    status: &'static str,
    old_path: Option<String>,
    new_path: Option<String>,
    old_blob: Option<String>,
    new_blob: Option<String>,
    counts: Counts,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilesPage {
    dto: &'static str,
    version: u16,
    commit_id: String,
    parent_id: Option<String>,
    offset: usize,
    files: Vec<FileSummary>,
    pub(crate) next_offset: Option<usize>,
    total_files: usize,
}

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub(crate) enum BlobSide {
    Absent,
    Text {
        path: String,
        id: String,
        text: String,
    },
    Binary {
        path: String,
        id: String,
    },
    TooLarge {
        path: String,
        id: String,
    },
    InvalidUtf8 {
        path: String,
        id: String,
    },
    Unsupported {
        path: String,
        id: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlobPair {
    dto: &'static str,
    version: u16,
    commit_id: String,
    parent_id: Option<String>,
    index: usize,
    original: BlobSide,
    modified: BlobSide,
}

pub(crate) struct FileReader<'repo> {
    repo: &'repo Repository,
    diff: Diff<'repo>,
    pub(crate) commit_id: String,
    parent_id: Option<String>,
}

fn check(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::Relaxed) {
        Err("History read cancelled".into())
    } else {
        Ok(())
    }
}
fn path(file: &git2::DiffFile<'_>) -> Result<Option<String>, String> {
    if file.id().is_zero() {
        return Ok(None);
    }
    file.path_bytes()
        .map(|bytes| {
            std::str::from_utf8(bytes)
                .map(str::to_owned)
                .map_err(|_| "Historical path is not UTF-8".to_owned())
        })
        .transpose()
}
fn blob_id(file: git2::DiffFile<'_>) -> Option<String> {
    (!file.id().is_zero()).then(|| file.id().to_string())
}

impl<'repo> FileReader<'repo> {
    pub(crate) fn new(
        repo: &'repo Repository,
        commit_id: &str,
        cancelled: &AtomicBool,
    ) -> Result<Self, String> {
        check(cancelled)?;
        if commit_id.len() != 40 || !commit_id.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("History requires a full commit ID".into());
        }
        let oid = Oid::from_str(commit_id).map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let tree = commit.tree().map_err(|e| e.to_string())?;
        let parent = if commit.parent_count() == 0 {
            None
        } else {
            Some(commit.parent(0).map_err(|e| e.to_string())?)
        };
        let parent_tree = parent
            .as_ref()
            .map(|p| p.tree())
            .transpose()
            .map_err(|e| e.to_string())?;
        let mut options = DiffOptions::new();
        options.context_lines(0).max_size(COUNT_LIMIT as i64);
        let mut diff = repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))
            .map_err(|e| e.to_string())?;
        check(cancelled)?;
        if diff.deltas().len() > FILE_LIMIT {
            return Err("History commit exceeds 20000 changed files".into());
        }
        // Bounded rename matching is shared by summaries and blob lookup, so an
        // index always addresses the same old/new pair within this reader.
        let mut find = DiffFindOptions::new();
        find.renames(true).rename_limit(200);
        diff.find_similar(Some(&mut find))
            .map_err(|e| e.to_string())?;
        check(cancelled)?;
        Ok(Self {
            repo,
            diff,
            commit_id: oid.to_string(),
            parent_id: parent.map(|p| p.id().to_string()),
        })
    }

    fn side(&self, file: git2::DiffFile<'_>) -> Result<BlobSide, String> {
        let Some(path) = path(&file)? else {
            return Ok(BlobSide::Absent);
        };
        let id = file.id().to_string();
        if file.mode() == git2::FileMode::Commit {
            return Ok(BlobSide::Unsupported { path, id });
        }
        // Inspect the object header before allocating/decompressing its contents.
        let (size, kind) = self
            .repo
            .odb()
            .map_err(|e| e.to_string())?
            .read_header(file.id())
            .map_err(|e| e.to_string())?;
        if kind != git2::ObjectType::Blob {
            return Ok(BlobSide::Unsupported { path, id });
        }
        if size > TEXT_LIMIT {
            return Ok(BlobSide::TooLarge { path, id });
        }
        let blob = self.repo.find_blob(file.id()).map_err(|e| e.to_string())?;
        if blob.is_binary() {
            return Ok(BlobSide::Binary { path, id });
        }
        match std::str::from_utf8(blob.content()) {
            Ok(text) => Ok(BlobSide::Text {
                path,
                id,
                text: text.into(),
            }),
            Err(_) => Ok(BlobSide::InvalidUtf8 { path, id }),
        }
    }

    pub(crate) fn pair(&self, index: usize, cancelled: &AtomicBool) -> Result<BlobPair, String> {
        check(cancelled)?;
        let delta = self
            .diff
            .get_delta(index)
            .ok_or("History file index out of range")?;
        let original = self.side(delta.old_file())?;
        check(cancelled)?;
        let modified = self.side(delta.new_file())?;
        check(cancelled)?;
        Ok(BlobPair {
            dto: "GitHistoryBlobPair",
            version: 1,
            commit_id: self.commit_id.clone(),
            parent_id: self.parent_id.clone(),
            index,
            original,
            modified,
        })
    }

    fn counts(&self, index: usize, cancelled: &AtomicBool) -> Result<Counts, String> {
        let delta = self
            .diff
            .get_delta(index)
            .ok_or("History file index out of range")?;
        let odb = self.repo.odb().map_err(|e| e.to_string())?;
        // Inspect both headers before libgit2 allocates a patch. Do not use
        // side()/pair(): their UTF-8 strings and 375 KiB cap belong to previews.
        for file in [delta.old_file(), delta.new_file()] {
            check(cancelled)?;
            if file.id().is_zero() {
                continue;
            }
            if file.mode() == git2::FileMode::Commit {
                return Ok(Counts::Unavailable);
            }
            let (size, kind) = odb.read_header(file.id()).map_err(|e| e.to_string())?;
            if kind != git2::ObjectType::Blob {
                return Ok(Counts::Unavailable);
            }
            if size > COUNT_LIMIT {
                return Ok(Counts::TooLarge);
            }
        }
        let patch = Patch::from_diff(&self.diff, index).map_err(|e| e.to_string())?;
        check(cancelled)?;
        let delta = self
            .diff
            .get_delta(index)
            .ok_or("History file index out of range")?;
        if delta.old_file().is_binary() || delta.new_file().is_binary() {
            return Ok(Counts::Binary);
        }
        let (additions, deletions) = match patch {
            Some(patch) => {
                let (_, additions, deletions) = patch.line_stats().map_err(|e| e.to_string())?;
                (additions, deletions)
            }
            None => (0, 0), // Pure rename/mode-only changes contain no text edits.
        };
        Ok(Counts::Ready {
            additions,
            deletions,
        })
    }

    pub(crate) fn page(
        &self,
        offset: usize,
        limit: usize,
        cancelled: &AtomicBool,
    ) -> Result<FilesPage, String> {
        if limit == 0 || limit > PAGE_LIMIT || offset > self.diff.deltas().len() {
            return Err("Invalid history file page".into());
        }
        let end = (offset + limit).min(self.diff.deltas().len());
        let mut files = Vec::new();
        for index in offset..end {
            check(cancelled)?;
            let delta = self
                .diff
                .get_delta(index)
                .ok_or("History file index out of range")?;
            let old_path = path(&delta.old_file())?;
            let new_path = path(&delta.new_file())?;
            let old_blob = blob_id(delta.old_file());
            let new_blob = blob_id(delta.new_file());
            let counts = self.counts(index, cancelled)?;
            let status = match delta.status() {
                Delta::Added => "added",
                Delta::Deleted => "deleted",
                Delta::Modified => "modified",
                Delta::Renamed => "renamed",
                Delta::Copied => "copied",
                Delta::Typechange => "typeChanged",
                _ => "unsupported",
            };
            files.push(FileSummary {
                index,
                status,
                old_path,
                new_path,
                old_blob,
                new_blob,
                counts,
            });
        }
        check(cancelled)?;
        Ok(FilesPage {
            dto: "GitHistoryFilesPage",
            version: 1,
            commit_id: self.commit_id.clone(),
            parent_id: self.parent_id.clone(),
            offset,
            files,
            next_offset: (end < self.diff.deltas().len()).then_some(end),
            total_files: self.diff.deltas().len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn repo() -> (tempfile::TempDir, Repository) {
        let scratch = std::env::var_os("TMPDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap());
        let dir = tempfile::Builder::new()
            .prefix("history-files-")
            .tempdir_in(scratch)
            .unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        (dir, repo)
    }
    fn commit(repo: &Repository, files: &[(&str, &[u8])], parents: &[Oid]) -> Oid {
        let mut builder = repo.treebuilder(None).unwrap();
        for (name, content) in files {
            builder
                .insert(*name, repo.blob(content).unwrap(), 0o100644)
                .unwrap();
        }
        let tree = repo.find_tree(builder.write().unwrap()).unwrap();
        let sig = git2::Signature::now("Test", "test@example.invalid").unwrap();
        let parents: Vec<_> = parents
            .iter()
            .map(|id| repo.find_commit(*id).unwrap())
            .collect();
        repo.commit(
            None,
            &sig,
            &sig,
            "test",
            &tree,
            &parents.iter().collect::<Vec<_>>(),
        )
        .unwrap()
    }
    #[test]
    fn roots_page_counts_and_blob_absence() {
        let (_dir, repo) = repo();
        let id = commit(&repo, &[("a.py", b"one\ntwo\n"), ("b.py", b"three\n")], &[]);
        let cancel = AtomicBool::new(false);
        let reader = FileReader::new(&repo, &id.to_string(), &cancel).unwrap();
        let page = reader.page(0, 1, &cancel).unwrap();
        assert_eq!(page.parent_id, None);
        assert_eq!(page.next_offset, Some(1));
        assert_eq!(page.total_files, 2);
        assert!(matches!(
            page.files[0].counts,
            Counts::Ready {
                additions: 2,
                deletions: 0
            }
        ));
        let pair = reader.pair(0, &cancel).unwrap();
        assert!(matches!(pair.original, BlobSide::Absent));
        assert!(matches!(pair.modified, BlobSide::Text { ref text, .. } if text == "one\ntwo\n"));
        assert_eq!(reader.page(1, 1, &cancel).unwrap().next_offset, None);
    }
    #[test]
    fn rename_uses_old_and_new_blob_paths_and_never_disk() {
        let (dir, repo) = repo();
        let before = commit(&repo, &[("old.py", b"one\ntwo\n")], &[]);
        let after = commit(&repo, &[("new.py", b"one\ntwo\n")], &[before]);
        std::fs::write(dir.path().join("new.py"), "wrong working content").unwrap();
        let cancel = AtomicBool::new(false);
        let reader = FileReader::new(&repo, &after.to_string(), &cancel).unwrap();
        let page = reader.page(0, 40, &cancel).unwrap();
        assert_eq!(page.files.len(), 1);
        assert_eq!(page.files[0].status, "renamed");
        let pair = reader.pair(0, &cancel).unwrap();
        assert!(matches!(pair.original, BlobSide::Text { ref path, .. } if path == "old.py"));
        assert!(
            matches!(pair.modified, BlobSide::Text { ref path, ref text, .. } if path == "new.py" && text == "one\ntwo\n")
        );
    }
    #[test]
    fn merge_is_first_parent_and_deletion_has_absent_modified_side() {
        let (_dir, repo) = repo();
        let left = commit(&repo, &[("a", b"left\n")], &[]);
        let right = commit(&repo, &[("b", b"right\n")], &[]);
        let merged = commit(&repo, &[], &[left, right]);
        let cancel = AtomicBool::new(false);
        let reader = FileReader::new(&repo, &merged.to_string(), &cancel).unwrap();
        let page = reader.page(0, 40, &cancel).unwrap();
        assert_eq!(page.parent_id, Some(left.to_string()));
        assert_eq!(page.files.len(), 1);
        assert_eq!(page.files[0].status, "deleted");
        assert!(matches!(
            reader.pair(0, &cancel).unwrap().modified,
            BlobSide::Absent
        ));
    }
    #[test]
    fn binary_oversized_invalid_encoding_and_cancellation_are_explicit() {
        let (_dir, repo) = repo();
        let large = vec![b'x'; TEXT_LIMIT + 1];
        let id = commit(
            &repo,
            &[
                ("a", b"x\0y"),
                ("b", &large),
                (
                    "c",
                    b"ordinary text line\ninvalid byte: \xff\nmore ordinary text\n",
                ),
            ],
            &[],
        );
        let cancel = AtomicBool::new(false);
        let reader = FileReader::new(&repo, &id.to_string(), &cancel).unwrap();
        let page = reader.page(0, 40, &cancel).unwrap();
        assert!(matches!(page.files[0].counts, Counts::Binary));
        assert!(matches!(
            page.files[1].counts,
            Counts::Ready {
                additions: 1,
                deletions: 0
            }
        ));
        assert!(matches!(
            reader.pair(1, &cancel).unwrap().modified,
            BlobSide::TooLarge { .. }
        ));
        assert!(matches!(
            reader.pair(2, &cancel).unwrap().modified,
            BlobSide::InvalidUtf8 { .. }
        ));
        assert!(reader.page(0, PAGE_LIMIT + 1, &cancel).is_err());
        assert!(reader.pair(99, &cancel).is_err());
        cancel.store(true, Ordering::Relaxed);
        assert!(reader.page(0, 40, &cancel).is_err());
        assert!(reader.pair(0, &cancel).is_err());
    }

    #[test]
    fn large_generated_text_counts_independently_of_preview_admission() {
        let (_dir, repo) = repo();
        let before = format!("{}\n", "x".repeat(1024 * 1024));
        let after = format!("{}\nextra line\n", "y".repeat(1024 * 1024));
        let parent = commit(&repo, &[("bundle.js", before.as_bytes())], &[]);
        let id = commit(&repo, &[("bundle.js", after.as_bytes())], &[parent]);
        let cancel = AtomicBool::new(false);
        let reader = FileReader::new(&repo, &id.to_string(), &cancel).unwrap();
        let page = reader.page(0, 1, &cancel).unwrap();
        assert!(matches!(
            page.files[0].counts,
            Counts::Ready {
                additions: 2,
                deletions: 1
            }
        ));
        let pair = reader.pair(0, &cancel).unwrap();
        assert!(matches!(pair.original, BlobSide::TooLarge { .. }));
        assert!(matches!(pair.modified, BlobSide::TooLarge { .. }));
    }

    #[test]
    fn count_budget_still_rejects_oversized_blobs() {
        let (_dir, repo) = repo();
        let bytes = vec![b'x'; COUNT_LIMIT + 1];
        let id = commit(&repo, &[("huge.js", &bytes)], &[]);
        let cancel = AtomicBool::new(false);
        let reader = FileReader::new(&repo, &id.to_string(), &cancel).unwrap();
        assert!(matches!(
            reader.page(0, 1, &cancel).unwrap().files[0].counts,
            Counts::TooLarge
        ));
    }
}
