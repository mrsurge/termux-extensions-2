//! Reverse one libgit2 hunk from exact buffers, never from display-only rows.
use super::text_edit_ops::{self, EditError, MAX_TEXT_BYTES, TextEdit};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PrepareHunkRequest {
    pub(crate) dto: String,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) path: String,
    pub(crate) commit: String,
    pub(crate) expected_sha256: String,
    pub(crate) hunk_index: usize,
}

// Resolve only full immutable commit IDs, never HEAD or another moving ref.
fn buffers(root: &Path, path: &str, commit: &str) -> Result<(String, String), EditError> {
    if commit.len() != 40 || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(EditError::Contract);
    }
    let root = std::fs::canonicalize(root).map_err(|_| EditError::InvalidPath)?;
    let content = super::text_edit_disk::snapshot(&root, path)?;
    let repo = git2::Repository::discover(&root).map_err(|_| EditError::InvalidPath)?;
    let workdir = repo.workdir().ok_or(EditError::InvalidPath)?;
    let workdir = std::fs::canonicalize(workdir).map_err(|_| EditError::InvalidPath)?;
    let relative = root
        .join(path)
        .strip_prefix(&workdir)
        .map_err(|_| EditError::InvalidPath)?
        .to_owned();
    let id = git2::Oid::from_str(commit).map_err(|_| EditError::Contract)?;
    let tree = repo
        .find_commit(id)
        .and_then(|c| c.tree())
        .map_err(|_| EditError::Contract)?;
    let baseline = match tree.get_path(&relative) {
        Ok(entry) => {
            if !matches!(entry.filemode(), 0o100644 | 0o100755) {
                return Err(EditError::InvalidPath);
            }
            let blob = repo
                .find_blob(entry.id())
                .map_err(|_| EditError::InvalidPath)?;
            if blob.size() > MAX_TEXT_BYTES {
                return Err(EditError::Limit);
            }
            std::str::from_utf8(blob.content())
                .map_err(|_| EditError::UnsupportedEncoding)?
                .to_owned()
        }
        Err(error) if error.code() == git2::ErrorCode::NotFound => String::new(),
        Err(_) => return Err(EditError::InvalidPath),
    };
    if baseline.contains('\0') || content.contains('\0') {
        return Err(EditError::UnsupportedEncoding);
    }
    Ok((baseline, content))
}

pub(crate) fn prepare(request: PrepareHunkRequest) -> Result<ReverseHunkResult, EditError> {
    if request.dto != "PrepareHunkRequest" || request.version != 1 {
        return Err(EditError::Contract);
    }
    let (baseline, content) = buffers(Path::new(&request.root), &request.path, &request.commit)?;
    reverse(ReverseHunkRequest {
        dto: "ReverseHunkRequest".into(),
        version: 1,
        baseline,
        content,
        expected_sha256: request.expected_sha256,
        hunk_index: request.hunk_index,
    })
}

pub(crate) fn restore_metadata(
    root: &str,
    path: &str,
    commit: &str,
    hunks: &[super::git_ops::GitDiffHunk],
) -> Result<Vec<Option<serde_json::Value>>, EditError> {
    let (baseline, content) = buffers(Path::new(root), path, commit)?;
    let mut options = git2::DiffOptions::new();
    options.context_lines(3).interhunk_lines(0);
    let patch = git2::Patch::from_buffers(
        baseline.as_bytes(),
        None,
        content.as_bytes(),
        None,
        Some(&mut options),
    )
    .map_err(|_| EditError::Unavailable)?;
    let sha = text_edit_ops::sha256(&content);
    // Never attach an action to a display hunk generated with different grouping.
    Ok(hunks
        .iter()
        .enumerate()
        .map(|(index, display)| {
            let (hunk, _) = patch.hunk(index).ok()?;
            if (
                display.old_start,
                display.old_lines,
                display.new_start,
                display.new_lines,
            ) != (
                hunk.old_start(),
                hunk.old_lines(),
                hunk.new_start(),
                hunk.new_lines(),
            ) {
                return None;
            }
            // The display diff may have raced the disk read; compare every real line.
            let mut lines = Vec::new();
            for line_index in 0..patch.num_lines_in_hunk(index).ok()? {
                let line = patch.line_in_hunk(index, line_index).ok()?;
                let kind = match line.origin() {
                    '+' => "add",
                    '-' => "del",
                    ' ' => "context",
                    _ => continue,
                };
                lines.push((
                    kind,
                    std::str::from_utf8(line.content())
                        .ok()?
                        .trim_end_matches(['\r', '\n']),
                ));
            }
            if display.lines.len() != lines.len()
                || display
                    .lines
                    .iter()
                    .zip(lines)
                    .any(|(d, (kind, text))| d.line_type != kind || d.text != text)
            {
                return None;
            }
            Some(serde_json::json!({"commit":commit,"sourceSha256":sha,"hunkIndex":index}))
        })
        .collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReverseHunkRequest {
    pub(crate) dto: String,
    pub(crate) version: u16,
    pub(crate) baseline: String,
    pub(crate) content: String,
    pub(crate) expected_sha256: String,
    pub(crate) hunk_index: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReverseHunkResult {
    dto: &'static str,
    version: u16,
    source_sha256: String,
    baseline_sha256: String,
    edits: Vec<TextEdit>,
}

fn line_range(text: &str, start: u32, count: u32) -> Result<std::ops::Range<usize>, EditError> {
    let mut offsets = vec![0];
    offsets.extend(text.match_indices('\n').map(|(offset, _)| offset + 1));
    if offsets.last() != Some(&text.len()) {
        offsets.push(text.len());
    }
    // Zero-line hunks locate a gap AFTER `start`; nonempty ranges are 1-based.
    let first = if count == 0 {
        start
    } else {
        start.checked_sub(1).ok_or(EditError::InvalidRange)?
    } as usize;
    let end = first
        .checked_add(count as usize)
        .ok_or(EditError::InvalidRange)?;
    Ok(*offsets.get(first).ok_or(EditError::InvalidRange)?
        ..*offsets.get(end).ok_or(EditError::InvalidRange)?)
}

pub(crate) fn reverse(request: ReverseHunkRequest) -> Result<ReverseHunkResult, EditError> {
    if request.dto != "ReverseHunkRequest" || request.version != 1 {
        return Err(EditError::Contract);
    }
    if request.baseline.len() > MAX_TEXT_BYTES || request.content.len() > MAX_TEXT_BYTES {
        return Err(EditError::Limit);
    }
    if request.baseline.contains('\0') || request.content.contains('\0') {
        return Err(EditError::UnsupportedEncoding);
    }
    let source_sha256 = text_edit_ops::sha256(&request.content);
    if !source_sha256.eq_ignore_ascii_case(&request.expected_sha256) {
        return Err(EditError::StaleContent);
    }
    // Explicit context keeps grouping independent of repository diff settings.
    // Producers must use this same grouping when assigning actionable hunk ids.
    let mut options = git2::DiffOptions::new();
    options.context_lines(3).interhunk_lines(0);
    let patch = git2::Patch::from_buffers(
        request.baseline.as_bytes(),
        None,
        request.content.as_bytes(),
        None,
        Some(&mut options),
    )
    .map_err(|_| EditError::Unavailable)?;
    let (hunk, _) = patch
        .hunk(request.hunk_index)
        .map_err(|_| EditError::InvalidRange)?;
    let old = line_range(&request.baseline, hunk.old_start(), hunk.old_lines())?;
    let new = line_range(&request.content, hunk.new_start(), hunk.new_lines())?;
    let edit = TextEdit {
        start_byte: new.start,
        end_byte: new.end,
        expected_text: request.content[new].to_owned(),
        replacement: request.baseline[old].to_owned(),
    };
    Ok(ReverseHunkResult {
        dto: "ReverseHunkResult",
        version: 1,
        source_sha256,
        baseline_sha256: text_edit_ops::sha256(&request.baseline),
        edits: vec![edit],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prepare_hunk_pins_commit_and_rejects_disk_changes() {
        let root = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(root.path()).unwrap();
        std::fs::write(root.path().join("file.txt"), "old\r\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("file.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let signature = git2::Signature::now("Test", "test@example.invalid").unwrap();
        let commit = repo
            .commit(Some("HEAD"), &signature, &signature, "base", &tree, &[])
            .unwrap()
            .to_string();
        std::fs::write(root.path().join("file.txt"), "new\r\n").unwrap();
        let make = || PrepareHunkRequest {
            dto: "PrepareHunkRequest".into(),
            version: 1,
            root: root.path().to_string_lossy().into(),
            path: "file.txt".into(),
            commit: commit.clone(),
            expected_sha256: text_edit_ops::sha256("new\r\n"),
            hunk_index: 0,
        };
        let result = prepare(make()).unwrap();
        assert_eq!(result.edits[0].replacement, "old\r\n");
        let mut moving = make();
        moving.commit = "HEAD".into();
        assert!(prepare(moving).is_err());
        let mut escape = make();
        escape.path = "../file.txt".into();
        assert!(prepare(escape).is_err());
        std::fs::write(root.path().join("file.txt"), "newer\r\n").unwrap();
        assert!(matches!(prepare(make()), Err(EditError::StaleContent)));
        assert_eq!(
            std::fs::read_to_string(root.path().join("file.txt")).unwrap(),
            "newer\r\n"
        );
    }
    fn restore(base: &str, current: &str, index: usize) -> Result<String, EditError> {
        let result = reverse(ReverseHunkRequest {
            dto: "ReverseHunkRequest".into(),
            version: 1,
            baseline: base.into(),
            content: current.into(),
            expected_sha256: text_edit_ops::sha256(current),
            hunk_index: index,
        })?;
        Ok(text_edit_ops::compute(text_edit_ops::TextEditsRequest {
            dto: "TextEditsRequest".into(),
            version: 1,
            content: current.into(),
            expected_sha256: result.source_sha256,
            edits: result.edits,
        })?
        .content)
    }
    #[test]
    fn reverse_hunk_preserves_exact_endings_and_unicode() {
        for (base, current) in [
            ("a\r\nb\r\n", "a\r\nc\r\n"),
            ("a\nb", "a\nc\n"),
            ("\u{feff}猫\n", "\u{feff}犬\n"),
            ("", "new\n"),
            ("old", ""),
            ("a\n", "a"),
            ("a", "a\n"),
        ] {
            assert_eq!(restore(base, current, 0).unwrap(), base);
        }
    }
    #[test]
    fn reverse_hunk_preserves_other_hunks() {
        let middle = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
        let base = format!("old\n{middle}tail\n");
        let current = format!("new\n{middle}changed\n");
        assert_eq!(
            restore(&base, &current, 0).unwrap(),
            format!("old\n{middle}changed\n")
        );
        assert_eq!(
            restore(&base, &current, 1).unwrap(),
            format!("new\n{middle}tail\n")
        );
    }
    #[test]
    fn reverse_hunk_rejects_missing_or_stale() {
        assert!(restore("same", "same", 0).is_err());
        assert!(restore("old", "new", 1).is_err());
        assert!(matches!(
            reverse(ReverseHunkRequest {
                dto: "ReverseHunkRequest".into(),
                version: 1,
                baseline: "old".into(),
                content: "new".into(),
                expected_sha256: "0".repeat(64),
                hunk_index: 0
            }),
            Err(EditError::StaleContent)
        ));
    }
}
