use super::common::{expand_user_path, home_dir, normalize_lexical, path_to_string};
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub(crate) struct BrowseRequest {
    pub(crate) path: Option<String>,
    pub(crate) root: Option<String>,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) sudo: bool,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) hidden: bool,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) resolve_symlinks: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct BrowseData {
    pub(crate) path: String,
    pub(crate) resolved_path: String,
    pub(crate) entries: Vec<BrowseEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct BrowseEntry {
    pub(crate) name: String,
    #[serde(rename = "type")]
    pub(crate) entry_type: String,
    pub(crate) path: String,
    pub(crate) is_symlink: bool,
    pub(crate) symlink_target: Option<String>,
    pub(crate) symlink_target_exists: Option<bool>,
    pub(crate) symlink_target_type: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
pub(crate) struct FsListDirectoryRequest {
    pub(crate) root: Option<String>,
    pub(crate) path: Option<String>,
    pub(crate) project_generation: Option<u64>,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) hidden: bool,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) resolve_symlinks: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
pub(crate) struct FsDirectoryListing {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) path: String,
    pub(crate) resolved_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) project_generation: Option<u64>,
    pub(crate) entries: Vec<FsDirectoryEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
pub(crate) struct FsDirectoryEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) kind: String,
    #[serde(rename = "type")]
    pub(crate) entry_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) mtime: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) mtime_ms: Option<u64>,
    pub(crate) is_symlink: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) symlink_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) symlink_target_exists: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) symlink_target_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) mode: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) uid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) gid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) git_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) draft_state: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FsMutationRequest {
    pub(crate) root: Option<String>,
    pub(crate) path: Option<String>,
    pub(crate) parent_rel: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) new_name: Option<String>,
    pub(crate) source: Option<String>,
    pub(crate) source_path: Option<String>,
    pub(crate) destination: Option<String>,
    pub(crate) destination_path: Option<String>,
    pub(crate) dest_path: Option<String>,
    pub(crate) dest_rel: Option<String>,
    pub(crate) project_generation: Option<u64>,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) recursive: bool,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) allow_source_outside_root: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FsMutationResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) project_generation: Option<u64>,
    pub(crate) operation: &'static str,
    pub(crate) ok: bool,
    pub(crate) changed_paths: Vec<String>,
    pub(crate) absolute_paths: Vec<String>,
}

#[derive(Debug)]
pub(crate) enum BrowseError {
    AccessDenied,
    AlreadyExists(String),
    InvalidInput(String),
    UnsupportedSudo,
    Io(std::io::Error),
}

impl From<std::io::Error> for BrowseError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub(crate) fn browse(request: BrowseRequest) -> Result<BrowseData, BrowseError> {
    // This is the transport-neutral filesystem service contract. Axum and later
    // pipe adapters should only parse/encode around this boundary.
    if request.sudo {
        return Err(BrowseError::UnsupportedSudo);
    }

    let (logical_path, scan_path) =
        resolve_browse_path(request.path.as_deref(), request.root.as_deref())?;
    let entries = scan_browse_entries(
        &scan_path,
        request.hidden,
        request.resolve_symlinks,
        &logical_path,
    )?;
    let resolved_path = fs::canonicalize(&scan_path).unwrap_or(scan_path);
    Ok(BrowseData {
        path: path_to_string(&logical_path),
        resolved_path: path_to_string(&resolved_path),
        entries,
    })
}

#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
pub(crate) fn list_directory(
    request: FsListDirectoryRequest,
) -> Result<FsDirectoryListing, BrowseError> {
    // Pipe-service DTOs originate at the service logic boundary. Network and
    // pipe transports should only adapt this typed result into their envelopes.
    let (root, scan_path) =
        resolve_list_directory_path(request.root.as_deref(), request.path.as_deref())?;
    let entries = scan_directory_listing_entries(
        &root,
        &scan_path,
        request.hidden,
        request.resolve_symlinks,
    )?;
    let resolved_path = fs::canonicalize(&scan_path).unwrap_or_else(|_| scan_path.clone());
    Ok(FsDirectoryListing {
        dto: "FsDirectoryListing",
        version: 1,
        root: path_to_string(&root),
        path: path_to_string(&scan_path),
        resolved_path: path_to_string(&resolved_path),
        project_generation: request.project_generation,
        entries,
    })
}

pub(crate) fn create_directory(
    request: FsMutationRequest,
) -> Result<FsMutationResult, BrowseError> {
    let root = mutation_root(request.root.as_deref())?;
    let parent = path_inside_root(
        &root,
        request.parent_rel.as_deref().or(request.path.as_deref()),
        ".",
    )?;
    require_directory(&parent, "parent is not a directory")?;
    let name = safe_child_name(request.name.as_deref())?;
    let target = parent.join(name);
    ensure_missing(&target)?;
    fs::create_dir(&target)?;
    Ok(mutation_result(
        &root,
        request.project_generation,
        "createDirectory",
        vec![target],
    ))
}

pub(crate) fn create_file(request: FsMutationRequest) -> Result<FsMutationResult, BrowseError> {
    let root = mutation_root(request.root.as_deref())?;
    let parent = path_inside_root(
        &root,
        request.parent_rel.as_deref().or(request.path.as_deref()),
        ".",
    )?;
    require_directory(&parent, "parent is not a directory")?;
    let name = safe_child_name(request.name.as_deref())?;
    let target = parent.join(name);
    ensure_missing(&target)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)?;
    Ok(mutation_result(
        &root,
        request.project_generation,
        "createFile",
        vec![target],
    ))
}

pub(crate) fn rename_entry(request: FsMutationRequest) -> Result<FsMutationResult, BrowseError> {
    let root = mutation_root(request.root.as_deref())?;
    let source = path_inside_root(&root, request.path.as_deref(), "")?;
    ensure_exists(&source)?;
    let name = safe_child_name(request.new_name.as_deref().or(request.name.as_deref()))?;
    let target = source
        .parent()
        .ok_or_else(|| BrowseError::InvalidInput("path has no parent".to_owned()))?
        .join(name);
    ensure_missing(&target)?;
    fs::rename(&source, &target)?;
    Ok(mutation_result(
        &root,
        request.project_generation,
        "rename",
        vec![source, target],
    ))
}

pub(crate) fn delete_entry(request: FsMutationRequest) -> Result<FsMutationResult, BrowseError> {
    let root = mutation_root(request.root.as_deref())?;
    let target = path_inside_root(&root, request.path.as_deref(), "")?;
    ensure_exists(&target)?;
    if target.is_dir() {
        fs::remove_dir_all(&target)?;
    } else {
        fs::remove_file(&target)?;
    }
    Ok(mutation_result(
        &root,
        request.project_generation,
        "delete",
        vec![target],
    ))
}

pub(crate) fn copy_entry(request: FsMutationRequest) -> Result<FsMutationResult, BrowseError> {
    let root = mutation_root(request.root.as_deref())?;
    let source = source_path(&root, &request)?;
    ensure_exists(&source)?;
    let destination_dir = destination_dir(&root, &request)?;
    let target = destination_dir.join(file_name(&source)?);
    ensure_missing(&target)?;
    copy_path(&source, &target)?;
    Ok(mutation_result(
        &root,
        request.project_generation,
        "copy",
        vec![target],
    ))
}

pub(crate) fn move_entry(request: FsMutationRequest) -> Result<FsMutationResult, BrowseError> {
    let root = mutation_root(request.root.as_deref())?;
    let source = source_path(&root, &request)?;
    ensure_exists(&source)?;
    let destination_dir = destination_dir(&root, &request)?;
    let target = destination_dir.join(file_name(&source)?);
    ensure_missing(&target)?;
    move_path(&source, &target)?;
    Ok(mutation_result(
        &root,
        request.project_generation,
        "move",
        vec![source, target],
    ))
}

fn resolve_browse_path(
    raw_path: Option<&str>,
    root: Option<&str>,
) -> Result<(PathBuf, PathBuf), BrowseError> {
    let home_dir = home_dir();
    let target_root = root.unwrap_or("home").to_ascii_lowercase();
    let allow_outside = matches!(target_root.as_str(), "system" | "absolute");
    let candidate = raw_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("~");

    let expanded = expand_user_path(candidate, &home_dir);
    let logical_path = normalize_lexical(expanded);
    let home_dir = normalize_lexical(home_dir);
    if !allow_outside && !logical_path.starts_with(&home_dir) {
        return Err(BrowseError::AccessDenied);
    }

    Ok((logical_path.clone(), logical_path))
}

#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
fn resolve_list_directory_path(
    raw_root: Option<&str>,
    raw_path: Option<&str>,
) -> Result<(PathBuf, PathBuf), BrowseError> {
    let home_dir = home_dir();
    let root = raw_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("~");
    let root = normalize_lexical(expand_user_path(root, &home_dir));

    let path = raw_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            let candidate = PathBuf::from(value);
            if candidate.is_absolute() || value == "~" || value.starts_with("~/") {
                expand_user_path(value, &home_dir)
            } else {
                root.join(candidate)
            }
        })
        .unwrap_or_else(|| root.clone());
    let path = normalize_lexical(path);
    if !path.starts_with(&root) {
        return Err(BrowseError::AccessDenied);
    }

    Ok((root, path))
}

fn mutation_root(raw_root: Option<&str>) -> Result<PathBuf, BrowseError> {
    let home_dir = home_dir();
    let root = raw_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("~");
    Ok(normalize_lexical(expand_user_path(root, &home_dir)))
}

fn path_inside_root(
    root: &Path,
    raw_path: Option<&str>,
    default_path: &str,
) -> Result<PathBuf, BrowseError> {
    let home_dir = home_dir();
    let raw = raw_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_path);
    if raw.is_empty() {
        return Err(BrowseError::InvalidInput("path is required".to_owned()));
    }
    let candidate = PathBuf::from(raw);
    let path = if candidate.is_absolute() || raw == "~" || raw.starts_with("~/") {
        expand_user_path(raw, &home_dir)
    } else {
        root.join(candidate)
    };
    let normalized = normalize_lexical(path);
    if !normalized.starts_with(root) {
        return Err(BrowseError::AccessDenied);
    }
    Ok(normalized)
}

fn source_path(root: &Path, request: &FsMutationRequest) -> Result<PathBuf, BrowseError> {
    let raw = request
        .source
        .as_deref()
        .or(request.source_path.as_deref())
        .or(request.path.as_deref());
    if request.allow_source_outside_root {
        let raw = raw
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| BrowseError::InvalidInput("source is required".to_owned()))?;
        Ok(normalize_lexical(expand_user_path(raw, &home_dir())))
    } else {
        path_inside_root(root, raw, "")
    }
}

fn destination_dir(root: &Path, request: &FsMutationRequest) -> Result<PathBuf, BrowseError> {
    let destination = request
        .destination
        .as_deref()
        .or(request.destination_path.as_deref())
        .or(request.dest_path.as_deref())
        .or(request.dest_rel.as_deref());
    let destination = path_inside_root(root, destination, ".")?;
    require_directory(&destination, "destination is not a directory")?;
    Ok(destination)
}

fn safe_child_name(raw_name: Option<&str>) -> Result<&str, BrowseError> {
    let name = raw_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| BrowseError::InvalidInput("name is required".to_owned()))?;
    let path = Path::new(name);
    if path.is_absolute()
        || name.contains('/')
        || name.contains('\\')
        || matches!(name, "." | "..")
        || path.components().count() != 1
    {
        return Err(BrowseError::InvalidInput(
            "name must be a single path segment".to_owned(),
        ));
    }
    Ok(name)
}

fn file_name(path: &Path) -> Result<&std::ffi::OsStr, BrowseError> {
    path.file_name()
        .ok_or_else(|| BrowseError::InvalidInput("source has no file name".to_owned()))
}

fn ensure_exists(path: &Path) -> Result<(), BrowseError> {
    if path.exists() {
        Ok(())
    } else {
        Err(BrowseError::Io(io::Error::new(
            io::ErrorKind::NotFound,
            "path does not exist",
        )))
    }
}

fn ensure_missing(path: &Path) -> Result<(), BrowseError> {
    if path.exists() {
        Err(BrowseError::AlreadyExists(format!(
            "path already exists: {}",
            path_to_string(path)
        )))
    } else {
        Ok(())
    }
}

fn require_directory(path: &Path, message: &str) -> Result<(), BrowseError> {
    if path.is_dir() {
        Ok(())
    } else {
        Err(BrowseError::InvalidInput(message.to_owned()))
    }
}

fn copy_path(source: &Path, target: &Path) -> Result<(), BrowseError> {
    if source.is_dir() {
        copy_dir_recursive(source, target)?;
    } else {
        let _bytes = fs::copy(source, target)?;
    }
    Ok(())
}

fn move_path(source: &Path, target: &Path) -> Result<(), BrowseError> {
    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_path(source, target)?;
            if source.is_dir() {
                fs::remove_dir_all(source)?;
            } else {
                fs::remove_file(source)?;
            }
            Ok(())
        }
    }
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), BrowseError> {
    fs::create_dir(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_child = entry.path();
        let target_child = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&source_child, &target_child)?;
        } else {
            let _bytes = fs::copy(&source_child, &target_child)?;
        }
    }
    Ok(())
}

fn mutation_result(
    root: &Path,
    project_generation: Option<u64>,
    operation: &'static str,
    paths: Vec<PathBuf>,
) -> FsMutationResult {
    let mut changed_paths = Vec::new();
    let mut absolute_paths = Vec::new();
    for path in paths {
        let normalized = normalize_lexical(path);
        absolute_paths.push(path_to_string(&normalized));
        if let Ok(rel) = normalized.strip_prefix(root) {
            changed_paths.push(path_to_string(rel));
        }
    }
    FsMutationResult {
        dto: "FsMutationResult",
        version: 1,
        root: path_to_string(root),
        project_generation,
        operation,
        ok: true,
        changed_paths,
        absolute_paths,
    }
}

fn scan_browse_entries(
    scan_path: &Path,
    include_hidden: bool,
    resolve_symlinks: bool,
    display_path: &Path,
) -> std::io::Result<Vec<BrowseEntry>> {
    let mut entries = Vec::new();
    for item in fs::read_dir(scan_path)? {
        let entry = item?;
        let name_os = entry.file_name();
        let name = name_os.to_string_lossy().into_owned();
        if !include_hidden && name.starts_with('.') {
            continue;
        }

        let full_scan_path = normalize_lexical(scan_path.join(&name_os));
        let full_display_path = normalize_lexical(display_path.join(&name_os));
        let mut entry_type = "unknown".to_owned();
        let mut is_symlink = false;
        let mut symlink_target = None;
        let mut symlink_target_exists = None;
        let mut symlink_target_type = None;

        match entry.file_type() {
            Ok(file_type) if file_type.is_symlink() => {
                is_symlink = true;
                entry_type = "symlink".to_owned();
                let target = resolve_symlink_target(&full_scan_path);
                symlink_target = target.0;
                symlink_target_exists = target.1;
                symlink_target_type = target.2;
                if resolve_symlinks
                    && matches!(symlink_target_type.as_deref(), Some("directory" | "file"))
                {
                    entry_type = symlink_target_type.clone().unwrap_or(entry_type);
                }
            }
            Ok(file_type) if file_type.is_dir() => entry_type = "directory".to_owned(),
            Ok(_) => entry_type = "file".to_owned(),
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {}
            Err(error) => return Err(error),
        }

        entries.push(BrowseEntry {
            name,
            entry_type,
            path: path_to_string(&full_display_path),
            is_symlink,
            symlink_target,
            symlink_target_exists,
            symlink_target_type,
        });
    }

    entries.sort_by(|left, right| {
        (left.entry_type != "directory")
            .cmp(&(right.entry_type != "directory"))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
fn scan_directory_listing_entries(
    root: &Path,
    scan_path: &Path,
    include_hidden: bool,
    resolve_symlinks: bool,
) -> std::io::Result<Vec<FsDirectoryEntry>> {
    let mut entries = Vec::new();
    for item in fs::read_dir(scan_path)? {
        let entry = item?;
        let name_os = entry.file_name();
        let name = name_os.to_string_lossy().into_owned();
        if !include_hidden && name.starts_with('.') {
            continue;
        }

        let full_path = normalize_lexical(scan_path.join(&name_os));
        let file_type = entry.file_type()?;
        let metadata = fs::symlink_metadata(&full_path).ok();
        let mut kind = if file_type.is_symlink() {
            "symlink".to_owned()
        } else if file_type.is_dir() {
            "directory".to_owned()
        } else if file_type.is_file() {
            "file".to_owned()
        } else {
            "unknown".to_owned()
        };
        let mut symlink_target = None;
        let mut symlink_target_exists = None;
        let mut symlink_target_type = None;
        if resolve_symlinks && file_type.is_symlink() {
            let target = resolve_symlink_target(&full_path);
            symlink_target = target.0;
            symlink_target_exists = target.1;
            symlink_target_type = target.2;
            if matches!(symlink_target_type.as_deref(), Some("directory" | "file")) {
                kind = symlink_target_type.clone().unwrap_or(kind);
            }
        } else if file_type.is_symlink() {
            let target = resolve_symlink_target(&full_path);
            symlink_target = target.0;
            symlink_target_exists = target.1;
            symlink_target_type = target.2;
        }
        let owner_group = metadata
            .as_ref()
            .and_then(metadata_owner_group)
            .unwrap_or_default();

        let relative_path = full_path
            .strip_prefix(root)
            .ok()
            .map(path_to_string)
            .unwrap_or_else(|| path_to_string(&full_path));
        entries.push(FsDirectoryEntry {
            name,
            path: path_to_string(&full_path),
            relative_path,
            entry_type: kind.clone(),
            kind,
            size: metadata.as_ref().map(fs::Metadata::len),
            mtime: metadata.as_ref().and_then(metadata_mtime_secs),
            mtime_ms: metadata.as_ref().and_then(metadata_mtime_ms),
            is_symlink: file_type.is_symlink(),
            symlink_target,
            symlink_target_exists,
            symlink_target_type,
            mode: metadata.as_ref().and_then(metadata_mode),
            uid: owner_group.uid,
            gid: owner_group.gid,
            owner: owner_group.owner,
            group: owner_group.group,
            git_status: None,
            draft_state: None,
        });
    }

    entries.sort_by(|left, right| {
        (left.kind != "directory")
            .cmp(&(right.kind != "directory"))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

fn resolve_symlink_target(full_path: &Path) -> (Option<String>, Option<bool>, Option<String>) {
    let Ok(raw_target) = fs::read_link(full_path) else {
        return (None, None, None);
    };
    let target_path = if raw_target.is_absolute() {
        raw_target
    } else {
        full_path
            .parent()
            .unwrap_or_else(|| Path::new("/"))
            .join(raw_target)
    };
    let target_path = normalize_lexical(target_path);
    let target_exists = target_path.exists();
    let target_type = if target_exists {
        path_type(&target_path)
    } else {
        "missing".to_owned()
    };
    (
        Some(path_to_string(&target_path)),
        Some(target_exists),
        Some(target_type),
    )
}

#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
fn metadata_mtime_ms(metadata: &fs::Metadata) -> Option<u64> {
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(duration.as_millis()).ok()
}

#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
fn metadata_mtime_secs(metadata: &fs::Metadata) -> Option<i64> {
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_secs()).ok()
}

#[cfg(unix)]
#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
fn metadata_mode(metadata: &fs::Metadata) -> Option<u32> {
    Some(metadata.mode())
}

#[cfg(not(unix))]
fn metadata_mode(_metadata: &fs::Metadata) -> Option<u32> {
    None
}

#[derive(Default)]
#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
struct OwnerGroup {
    uid: Option<u32>,
    gid: Option<u32>,
    owner: Option<String>,
    group: Option<String>,
}

#[cfg(unix)]
#[allow(dead_code)] // Staged for the pipe service before runtime wiring exists.
fn metadata_owner_group(metadata: &fs::Metadata) -> Option<OwnerGroup> {
    let uid = metadata.uid();
    let gid = metadata.gid();
    Some(OwnerGroup {
        uid: Some(uid),
        gid: Some(gid),
        // Name resolution can be added behind a platform adapter later. Numeric
        // strings preserve File Explorer's current fallback semantics for now.
        owner: Some(uid.to_string()),
        group: Some(gid.to_string()),
    })
}

#[cfg(not(unix))]
fn metadata_owner_group(_metadata: &fs::Metadata) -> Option<OwnerGroup> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!("te2-rust-spike-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    #[test]
    fn list_directory_returns_contract_dto() {
        let root = test_root("fs-list");
        let src = root.join("src");
        fs::create_dir_all(&src).expect("create src");
        fs::write(src.join("main.py"), "print('hello')\n").expect("write file");

        let listing = list_directory(FsListDirectoryRequest {
            root: Some(path_to_string(&root)),
            path: Some("src".to_owned()),
            project_generation: Some(42),
            hidden: false,
            resolve_symlinks: false,
        })
        .expect("list directory");

        assert_eq!(listing.dto, "FsDirectoryListing");
        assert_eq!(listing.version, 1);
        assert_eq!(listing.project_generation, Some(42));
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].name, "main.py");
        assert_eq!(listing.entries[0].relative_path, "src/main.py");
        assert_eq!(listing.entries[0].kind, "file");
        assert_eq!(listing.entries[0].entry_type, "file");
        assert_eq!(listing.entries[0].size, Some(15));
        assert!(listing.entries[0].mtime.is_some());
        assert!(listing.entries[0].mtime_ms.is_some());
        assert!(listing.entries[0].mode.is_some());
        assert!(listing.entries[0].owner.is_some());
        assert!(listing.entries[0].group.is_some());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_directory_rejects_paths_outside_root() {
        let root = test_root("fs-outside");
        let outside = root
            .parent()
            .unwrap_or_else(|| Path::new("/"))
            .join("outside");

        let result = list_directory(FsListDirectoryRequest {
            root: Some(path_to_string(&root)),
            path: Some(path_to_string(&outside)),
            ..FsListDirectoryRequest::default()
        });

        assert!(matches!(result, Err(BrowseError::AccessDenied)));
        let _ = fs::remove_dir_all(root);
    }
}

fn path_type(path: &Path) -> String {
    if let Ok(metadata) = fs::metadata(path) {
        if metadata.is_dir() {
            return "directory".to_owned();
        }
        if metadata.is_file() {
            return "file".to_owned();
        }
    }
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return "symlink".to_owned();
    }
    "unknown".to_owned()
}
