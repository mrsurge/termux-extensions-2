//! Bounded pages of progressive Git diffs, delivered by the search job lifecycle.
use super::{git_ops, search_ops::SearchProviderError};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangesRequest {
    pub(crate) dto: Option<String>,
    pub(crate) version: Option<u16>,
    pub(crate) root: Option<String>,
    pub(crate) project_generation: Option<u64>,
    pub(crate) correlation_id: Option<String>,
    pub(crate) base: Option<String>,
    #[serde(default)]
    pub(crate) head_view: bool,
    pub(crate) offset: Option<usize>,
    pub(crate) snapshot_token: Option<String>,
}

pub(crate) fn run(
    request: ChangesRequest,
    cancelled: Arc<AtomicBool>,
    emit: impl Fn(Value) -> bool,
) -> Result<Value, SearchProviderError> {
    super::search_ops::validate_contract_metadata(
        request.dto.as_deref(),
        request.version,
        "SearchChangesRequest",
    )?;
    let check = || {
        if cancelled.load(Ordering::Relaxed) {
            Err(SearchProviderError::Cancelled)
        } else {
            Ok(())
        }
    };
    check()?;
    let root = request.root.clone().unwrap_or_default();
    let requested_base = request.base.clone().unwrap_or_else(|| "HEAD".into());
    let provider = git_ops::GitProviderRequest {
        root: Some(root.clone()),
        project_generation: request.project_generation,
        ..Default::default()
    };
    let map_error =
        |error: git_ops::GitProviderError| SearchProviderError::Search(format!("{error:?}"));
    let commit = match git_ops::git_commit_info(git_ops::GitProviderRequest {
        rev: Some(requested_base.clone()),
        ..provider.clone()
    }) {
        Ok(result) => result.commit,
        Err(git_ops::GitProviderError::NotRepository) => {
            if !emit(
                json!({"metadata":{"mode":"changes","git":false,"total":0,"offset":0,"nextOffset":null}}),
            ) {
                return Err(SearchProviderError::Cancelled);
            }
            return Ok(json!({"filesScanned":0,"filesMatched":0}));
        }
        Err(error) => return Err(map_error(error)),
    };
    if commit.is_none() && requested_base != "HEAD" {
        return Err(SearchProviderError::Search(
            "Selected commit is unavailable".into(),
        ));
    }
    let pinned = commit
        .as_ref()
        .map(|c| c.hash.clone())
        .unwrap_or_else(|| "HEAD".into());
    let head_view = request.head_view || requested_base == "HEAD";
    if head_view && requested_base != "HEAD" {
        let current = git_ops::git_commit_info(provider.clone())
            .map_err(map_error)?
            .commit;
        if current.as_ref().map(|c| c.hash.as_str()) != Some(pinned.as_str()) {
            return Err(SearchProviderError::Search(
                "HEAD changed: refresh results before continuing".into(),
            ));
        }
    }
    check()?;
    let offset = request.offset.unwrap_or(0);
    let base = json!({"ref": requested_base, "mode": if pinned == "HEAD" {"none"} else if head_view {"head"} else {"detached"}, "commit": commit.as_ref().map(|c| json!({"hash": c.hash, "short": c.short_hash, "subject": c.summary}))});
    // Discovery has no exact total yet. Publish ownership before the first file,
    // then stream each confirmed diff without waiting for later candidate checks.
    if offset == 0
        && !emit(
            json!({"metadata":{"mode":"changes","git":true,"base":base,"baseHash":pinned,"offset":0,"nextOffset":null}}),
        )
    {
        return Err(SearchProviderError::Cancelled);
    }
    check()?;
    let mut delivered = 0;
    let mut delivery_error = None;
    let listing_result = git_ops::git_worktree_changes_visit(
        git_ops::GitProviderRequest {
            base: Some(if head_view {
                "HEAD".into()
            } else {
                pinned.clone()
            }),
            ..provider.clone()
        },
        || !cancelled.load(Ordering::Relaxed),
        |entry| {
            if cancelled.load(Ordering::Relaxed) {
                return false;
            }
            if offset != 0 || delivered >= 40 {
                return true;
            }
            match render_change(entry, &provider, &pinned, &root) {
                Ok(change) => {
                    if cancelled.load(Ordering::Relaxed) || !emit(json!({"change":change})) {
                        delivery_error = Some(SearchProviderError::Cancelled);
                        return false;
                    }
                    delivered += 1;
                    true
                }
                Err(error) => {
                    delivery_error = Some(error);
                    false
                }
            }
        },
    );
    if let Some(error) = delivery_error {
        return Err(error);
    }
    check()?;
    let listing = listing_result.map_err(map_error)?;
    // Keep discovery order identical for streamed files and subsequent pages.
    let entries = listing.changes;
    let mut hash = DefaultHasher::new();
    pinned.hash(&mut hash);
    for entry in &entries {
        check()?;
        entry.path.hash(&mut hash);
        entry.code.hash(&mut hash);
        if let Ok(meta) = std::fs::metadata(Path::new(&root).join(&entry.path)) {
            meta.len().hash(&mut hash);
            meta.modified().ok().hash(&mut hash);
        }
    }
    let token = format!("{:016x}", hash.finish());
    if request
        .snapshot_token
        .as_ref()
        .is_some_and(|expected| expected != &token)
    {
        return Err(SearchProviderError::Search(
            "comparison_changed: refresh the result before continuing".into(),
        ));
    }
    if offset > entries.len() || (offset > 0 && request.snapshot_token.is_none()) {
        return Err(SearchProviderError::Search(
            "Invalid changes continuation".into(),
        ));
    }
    let end = (offset + 40).min(entries.len());
    let meta = json!({"mode":"changes", "git":listing.is_repository, "base":base, "baseHash":pinned, "snapshotToken":token, "offset":offset, "nextOffset": if end < entries.len() {Some(end)} else {None}, "total":entries.len(), "truncated":listing.truncated});
    if !emit(json!({"metadata":meta})) {
        return Err(SearchProviderError::Cancelled);
    }
    // Continuations emit only after the complete snapshot token has been validated.
    if offset > 0 {
        for entry in &entries[offset..end] {
            check()?;
            if !emit(json!({"change":render_change(entry, &provider, &pinned, &root)?})) {
                return Err(SearchProviderError::Cancelled);
            }
        }
    }
    Ok(json!({"filesScanned":entries.len(),"fileCount":end-offset,"truncated":listing.truncated}))
}

// Each body is materialized only when its confirmed path reaches the output page.
fn render_change(
    entry: &git_ops::GitWorktreeChange,
    provider: &git_ops::GitProviderRequest,
    pinned: &str,
    root: &str,
) -> Result<Value, SearchProviderError> {
    let hunks = git_ops::git_diff_hunks(git_ops::GitProviderRequest {
        base: Some(pinned.to_owned()),
        relative_path: Some(entry.path.clone()),
        ..provider.clone()
    });
    let status = entry.code.trim().chars().next().unwrap_or('?');
    let status_text = match status {
        'M' => "Modified",
        'A' => "Added",
        'D' => "Deleted",
        'R' => "Renamed",
        'C' => "Copied",
        'U' => "Conflict",
        'T' => "Type changed",
        _ => "Untracked",
    };
    let mut change = json!({"rel":entry.path,"path":Path::new(&root).join(&entry.path).to_string_lossy(),"label":Path::new(&entry.path).file_name().unwrap_or_default().to_string_lossy(),"status":status.to_string(),"statusCode":entry.code,"statusText":status_text,"renamedFrom":entry.original_path,"hunks":[]});
    match hunks {
        Ok(result) => {
            change["summary"] = json!(result.summary);
            change["hunks"] = json!(result.hunks);
            if !result.hunks.is_empty()
                && let Ok(actions) = super::hunk_edits::restore_metadata(&root, &entry.path, pinned, &result.hunks) {
                for (index, action) in actions.into_iter().enumerate() {
                    if let Some(action) = action {
                        change["hunks"][index]["restore"] = action;
                    }
                }
            }
        }
        Err(error) => {
            change["error"] = json!(format!("Diff unavailable: {error:?}"));
        }
    }
    if serde_json::to_vec(&change)
        .map_err(|e| SearchProviderError::Search(e.to_string()))?
        .len()
        > 256 * 1024
    {
        change["hunks"] = json!([]);
        change["error"] =
            json!("Diff body exceeds the 256 KiB preview limit; open the file to inspect it.");
    }

    Ok(change)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, fs, path::PathBuf};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new(label: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("te2-changes-{label}-{}", std::process::id()));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
        fn request(&self) -> ChangesRequest {
            ChangesRequest {
                root: Some(self.0.to_string_lossy().into_owned()),
                ..Default::default()
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn streamed_modified_hunk_has_exact_restore_identity() {
        let fixture = Fixture::new("hunk-action");
        let repo = git2::Repository::init(&fixture.0).unwrap();
        fs::write(fixture.0.join("file.txt"), "old\nkeep\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("file.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("Test", "test@example.invalid").unwrap();
        let commit = repo.commit(Some("HEAD"), &sig, &sig, "base", &tree, &[]).unwrap();
        fs::write(fixture.0.join("file.txt"), "new\nkeep\n").unwrap();
        let events = RefCell::new(Vec::new());
        run(fixture.request(), Arc::new(AtomicBool::new(false)), |event| {
            events.borrow_mut().push(event); true
        }).unwrap();
        let events = events.into_inner();
        let action = &events[1]["change"]["hunks"][0]["restore"];
        assert_eq!(action["commit"], commit.to_string(), "{}", events[1]);
        assert_eq!(action["sourceSha256"], super::super::text_edit_ops::sha256("new\nkeep\n"));
        assert_eq!(action["hunkIndex"], 0);
    }

    #[test]
    fn progressive_changes_pages_cancel_and_reject_changed_continuation() {
        let fixture = Fixture::new("pages");
        let repo = git2::Repository::init(&fixture.0).unwrap();
        fs::write(fixture.0.join("seed.txt"), "base\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("seed.txt")).unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("Test", "test@example.invalid").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "base", &tree, &[])
            .unwrap();
        index.write().unwrap();
        for i in 0..45 {
            fs::write(fixture.0.join(format!("file-{i:02}.txt")), "added\n").unwrap();
        }
        let events = RefCell::new(Vec::new());
        let cancelled = Arc::new(AtomicBool::new(false));
        run(fixture.request(), cancelled.clone(), |event| {
            events.borrow_mut().push(event);
            true
        })
        .unwrap();
        let events = events.into_inner();
        assert_eq!(events.len(), 42);
        assert!(events[0]["metadata"].get("total").is_none());
        let meta = &events.last().unwrap()["metadata"];
        assert_eq!(meta["total"], 45);
        assert_eq!(meta["nextOffset"], 40);
        assert!(events[1]["change"]["hunks"].is_array());
        let next = ChangesRequest {
            head_view: true,
            base: meta["baseHash"].as_str().map(str::to_owned),
            offset: Some(40),
            snapshot_token: meta["snapshotToken"].as_str().map(str::to_owned),
            ..fixture.request()
        };
        let page = RefCell::new(Vec::new());
        run(next.clone(), cancelled.clone(), |event| {
            page.borrow_mut().push(event);
            true
        })
        .unwrap();
        assert_eq!(page.borrow().len(), 6);
        assert!(page.borrow()[0]["metadata"]["nextOffset"].is_null());
        fs::write(fixture.0.join("file-44.txt"), "changed since enumeration\n").unwrap();
        assert!(run(next, cancelled.clone(), |_| panic!("stale page emitted")).is_err());
        let calls = RefCell::new(0);
        let result = run(fixture.request(), cancelled.clone(), |_| {
            *calls.borrow_mut() += 1;
            cancelled.store(true, Ordering::Relaxed);
            true
        });
        assert!(matches!(result, Err(SearchProviderError::Cancelled)));
        assert_eq!(*calls.borrow(), 1);
    }

    #[test]
    fn progressive_changes_uses_historical_text_and_caps_large_bodies() {
        let fixture = Fixture::new("historical");
        let repo = git2::Repository::init(&fixture.0).unwrap();
        let sig = git2::Signature::now("Test", "test@example.invalid").unwrap();
        fs::write(fixture.0.join("code.txt"), "old text\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("code.txt")).unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let base = repo
            .commit(Some("HEAD"), &sig, &sig, "base", &tree, &[])
            .unwrap();
        fs::write(fixture.0.join("code.txt"), "new text\n").unwrap();
        index.add_path(Path::new("code.txt")).unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "new",
            &tree,
            &[&repo.find_commit(base).unwrap()],
        )
        .unwrap();
        index.write().unwrap();
        let events = RefCell::new(Vec::new());
        run(
            ChangesRequest {
                base: Some(base.to_string()),
                ..fixture.request()
            },
            Arc::new(AtomicBool::new(false)),
            |v| {
                events.borrow_mut().push(v);
                true
            },
        )
        .unwrap();
        assert_eq!(events.borrow().last().unwrap()["metadata"]["total"], 1);
        assert_eq!(events.borrow()[0]["metadata"]["base"]["mode"], "detached");
        let text = events.borrow()[1]["change"]["hunks"].to_string();
        assert!(text.contains("old text") && text.contains("new text"));
        fs::write(
            fixture.0.join("code.txt"),
            (0..6000)
                .map(|i| format!("line {i:05} {}\n", "x".repeat(55)))
                .collect::<String>(),
        )
        .unwrap();
        let events = RefCell::new(Vec::new());
        run(fixture.request(), Arc::new(AtomicBool::new(false)), |v| {
            events.borrow_mut().push(v);
            true
        })
        .unwrap();
        let rows = events.borrow();
        let large = &rows
            .iter()
            .find(|v| v["change"]["rel"] == "code.txt")
            .unwrap()["change"];
        assert_eq!(large["hunks"], json!([]));
        assert!(large["error"].as_str().unwrap().contains("256 KiB"));
        assert!(serde_json::to_vec(large).unwrap().len() < 256 * 1024);
    }

    #[test]
    fn historical_first_result_precedes_later_candidate_validation() {
        let fixture = Fixture::new("discovery-order");
        let repo = git2::Repository::init(&fixture.0).unwrap();
        let sig = git2::Signature::now("Test", "test@example.invalid").unwrap();
        let mut index = repo.index().unwrap();
        for name in ["a.txt", "z.txt"] {
            fs::write(fixture.0.join(name), "base\n").unwrap();
            index.add_path(Path::new(name)).unwrap();
        }
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let base = repo
            .commit(Some("HEAD"), &sig, &sig, "base", &tree, &[])
            .unwrap();
        for name in ["a.txt", "z.txt"] {
            fs::write(fixture.0.join(name), "changed\n").unwrap();
            index.add_path(Path::new(name)).unwrap();
        }
        index.write().unwrap();
        let events = RefCell::new(Vec::new());
        run(
            ChangesRequest {
                base: Some(base.to_string()),
                ..fixture.request()
            },
            Arc::new(AtomicBool::new(false)),
            |event| {
                // If discovery were batched, z.txt would already be confirmed.
                // Changing it here proves the first file arrives before that check.
                if event["change"]["rel"] == "a.txt" {
                    fs::write(fixture.0.join("z.txt"), "base\n").unwrap();
                }
                events.borrow_mut().push(event);
                true
            },
        )
        .unwrap();
        let events = events.borrow();
        assert!(events.iter().any(|e| e["change"]["rel"] == "a.txt"));
        assert!(!events.iter().any(|e| e["change"]["rel"] == "z.txt"));
        assert_eq!(events.last().unwrap()["metadata"]["total"], 1);
    }

    #[test]
    fn progressive_changes_non_repo_is_empty_and_cancellation_precedes_io() {
        let fixture = Fixture::new("empty");
        let events = RefCell::new(Vec::new());
        run(fixture.request(), Arc::new(AtomicBool::new(false)), |v| {
            events.borrow_mut().push(v);
            true
        })
        .unwrap();
        assert_eq!(events.borrow()[0]["metadata"]["git"], false);
        assert!(matches!(
            run(
                ChangesRequest::default(),
                Arc::new(AtomicBool::new(true)),
                |_| true
            ),
            Err(SearchProviderError::Cancelled)
        ));
    }
}
