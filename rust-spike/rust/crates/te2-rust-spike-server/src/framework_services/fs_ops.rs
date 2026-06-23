use super::common::{expand_user_path, home_dir, normalize_lexical, path_to_string};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

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

#[derive(Debug)]
pub(crate) enum BrowseError {
    AccessDenied,
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
