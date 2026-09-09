//! Disk-only persistence for exact edits. Draft consent/revision checks belong
//! to the caller. This module neither reads drafts nor touches the Git index.
use super::text_edit_ops::{
    self, EditError, MAX_TEXT_BYTES, TextEdit, TextEditsRequest, TextEditsResult,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DiskEditsRequest {
    pub(crate) dto: String,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) path: String,
    pub(crate) expected_sha256: String,
    pub(crate) edits: Vec<TextEdit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiskEditsResult {
    dto: &'static str,
    version: u16,
    path: String,
    pub(crate) edit: TextEditsResult,
    // A failed directory fsync is post-commit, not a reason to retry the edit.
    pub(crate) directory_synced: bool,
}

fn target(root: &Path, relative: &str) -> Result<PathBuf, EditError> {
    if relative.is_empty() {
        return Err(EditError::InvalidPath);
    }
    let mut path = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(part) = component else {
            return Err(EditError::InvalidPath);
        };
        if part == ".git" {
            return Err(EditError::InvalidPath);
        }
        path.push(part);
        let meta = fs::symlink_metadata(&path).map_err(|_| EditError::InvalidPath)?;
        if meta.file_type().is_symlink() {
            return Err(EditError::InvalidPath);
        }
    }
    if !path.is_file() {
        return Err(EditError::InvalidPath);
    }
    Ok(path)
}

fn read(path: &Path) -> Result<(String, Metadata), EditError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|_| EditError::Io)?;
    let meta = file.metadata().map_err(|_| EditError::Io)?;
    if !meta.is_file() {
        return Err(EditError::InvalidPath);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // Atomic replacement would silently split a hard link's identity.
        if meta.nlink() != 1 {
            return Err(EditError::InvalidPath);
        }
    }
    if meta.len() > MAX_TEXT_BYTES as u64 {
        return Err(EditError::Limit);
    }
    let mut bytes = Vec::new();
    file.take((MAX_TEXT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| EditError::Io)?;
    if bytes.len() > MAX_TEXT_BYTES {
        return Err(EditError::Limit);
    }
    if bytes.contains(&0) {
        return Err(EditError::UnsupportedEncoding);
    }
    let text = String::from_utf8(bytes).map_err(|_| EditError::UnsupportedEncoding)?;
    Ok((text, meta))
}

fn same_file(a: &Metadata, b: &Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if (a.dev(), a.ino(), a.mode(), a.ctime(), a.ctime_nsec())
            != (b.dev(), b.ino(), b.mode(), b.ctime(), b.ctime_nsec())
        {
            return false;
        }
    }
    a.len() == b.len()
        && a.modified().ok() == b.modified().ok()
        && a.permissions().readonly() == b.permissions().readonly()
}

pub(crate) fn apply(request: DiskEditsRequest) -> Result<DiskEditsResult, EditError> {
    apply_before_commit(request, || {})
}

fn apply_before_commit(
    request: DiskEditsRequest,
    before_commit: impl FnOnce(),
) -> Result<DiskEditsResult, EditError> {
    if request.dto != "DiskEditsRequest" || request.version != 1 {
        return Err(EditError::Contract);
    }
    let root = fs::canonicalize(&request.root).map_err(|_| EditError::InvalidPath)?;
    if !root.is_dir() {
        return Err(EditError::InvalidPath);
    }
    let path = target(&root, &request.path)?;
    let (source, metadata) = read(&path)?;
    if metadata.permissions().readonly() {
        return Err(EditError::Io);
    }
    let edit = text_edit_ops::compute(TextEditsRequest {
        dto: "TextEditsRequest".into(),
        version: 1,
        content: source.clone(),
        expected_sha256: request.expected_sha256,
        edits: request.edits,
    })?;
    if !edit.changed {
        return Ok(DiskEditsResult {
            dto: "DiskEditsResult",
            version: 1,
            path: request.path,
            edit,
            directory_synced: true,
        });
    }
    let parent = path.parent().ok_or(EditError::InvalidPath)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| EditError::Io)?;
    temporary
        .write_all(edit.content.as_bytes())
        .map_err(|_| EditError::Io)?;
    temporary
        .as_file()
        .set_permissions(metadata.permissions())
        .map_err(|_| EditError::Io)?;
    temporary.as_file().sync_all().map_err(|_| EditError::Io)?;
    before_commit();
    // Recheck after preparing output. The scheduler serializes same-root TE2
    // edits; arbitrary external writers still have a check-to-rename race.
    // This is guarded atomic replacement, not a filesystem compare-and-swap.
    if target(&root, &request.path)? != path {
        return Err(EditError::StaleContent);
    }
    let (current, current_meta) = read(&path)?;
    if current != source || !same_file(&metadata, &current_meta) {
        return Err(EditError::StaleContent);
    }
    temporary.persist(&path).map_err(|_| EditError::Io)?;
    let directory_synced = File::open(parent).and_then(|f| f.sync_all()).is_ok();
    Ok(DiskEditsResult {
        dto: "DiskEditsResult",
        version: 1,
        path: request.path,
        edit,
        directory_synced,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(root: &Path, source: &str) -> DiskEditsRequest {
        DiskEditsRequest {
            dto: "DiskEditsRequest".into(),
            version: 1,
            root: root.to_string_lossy().into(),
            path: "file.txt".into(),
            expected_sha256: text_edit_ops::sha256(source),
            edits: vec![TextEdit {
                start_byte: 0,
                end_byte: 1,
                expected_text: "a".into(),
                replacement: "Z".into(),
            }],
        }
    }
    #[test]
    fn writes_only_requested_bytes_and_preserves_permissions() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file.txt");
        fs::write(&path, "a\r\nrest\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o751)).unwrap();
        }
        let result = apply(request(root.path(), "a\r\nrest\n")).unwrap();
        assert!(result.edit.changed);
        assert_eq!(fs::read(&path).unwrap(), b"Z\r\nrest\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o751
            );
        }
    }
    #[test]
    fn stale_or_concurrent_writes_are_preserved() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file.txt");
        fs::write(&path, "abc").unwrap();
        assert!(matches!(
            apply(request(root.path(), "old")),
            Err(EditError::StaleContent)
        ));
        assert!(matches!(
            apply_before_commit(request(root.path(), "abc"), || fs::write(&path, "newer")
                .unwrap()),
            Err(EditError::StaleContent)
        ));
        assert_eq!(fs::read_to_string(&path).unwrap(), "newer");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }
    #[test]
    fn git_index_and_unrelated_edits_are_untouched() {
        let root = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(root.path()).unwrap();
        let path = root.path().join("file.txt");
        fs::write(&path, "abc").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("file.txt")).unwrap();
        index.write().unwrap();
        let staged = fs::read(root.path().join(".git/index")).unwrap();
        apply(request(root.path(), "abc")).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"Zbc");
        assert_eq!(fs::read(root.path().join(".git/index")).unwrap(), staged);
    }

    #[tokio::test]
    async fn concurrent_same_snapshot_writes_have_one_winner() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("file.txt"), "abc").unwrap();
        let scheduler = crate::framework_services::scheduler::FrameworkServiceScheduler::default();
        let (first, second) = tokio::join!(
            scheduler.apply_text_edits(request(root.path(), "abc")),
            scheduler.apply_text_edits(request(root.path(), "abc"))
        );
        assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
        assert!(
            matches!(first, Err(EditError::StaleContent))
                || matches!(second, Err(EditError::StaleContent))
        );
        assert_eq!(fs::read(root.path().join("file.txt")).unwrap(), b"Zbc");
    }

    #[test]
    fn noop_does_not_replace_disk_file() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file.txt");
        fs::write(&path, "abc").unwrap();
        let before = fs::metadata(&path).unwrap();
        let mut r = request(root.path(), "abc");
        r.edits.clear();
        assert!(!apply(r).unwrap().edit.changed);
        assert!(same_file(&before, &fs::metadata(&path).unwrap()));
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn invalid_paths_and_encoding_never_write() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file.txt");
        fs::write(&path, [0xff, 0x00]).unwrap();
        assert!(matches!(
            apply(request(root.path(), "a")),
            Err(EditError::UnsupportedEncoding)
        ));
        for name in ["../file.txt", "/file.txt", ".git/config", ""] {
            let mut r = request(root.path(), "a");
            r.path = name.into();
            assert!(matches!(apply(r), Err(EditError::InvalidPath)));
        }
        assert_eq!(fs::read(&path).unwrap(), [0xff, 0x00]);
    }
    #[test]
    #[cfg(unix)]
    fn symlinks_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("real"), "abc").unwrap();
        std::os::unix::fs::symlink("real", root.path().join("file.txt")).unwrap();
        assert!(matches!(
            apply(request(root.path(), "abc")),
            Err(EditError::InvalidPath)
        ));
        assert_eq!(fs::read_to_string(root.path().join("real")).unwrap(), "abc");
    }

    #[test]
    #[cfg(unix)]
    #[cfg_attr(
        target_os = "android",
        ignore = "Android app sandbox denies hard-link creation"
    )]
    fn hardlinks_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("real"), "abc").unwrap();
        fs::hard_link(root.path().join("real"), root.path().join("file.txt")).unwrap();
        assert!(matches!(
            apply(request(root.path(), "abc")),
            Err(EditError::InvalidPath)
        ));
        assert_eq!(fs::read_to_string(root.path().join("real")).unwrap(), "abc");
    }
}
