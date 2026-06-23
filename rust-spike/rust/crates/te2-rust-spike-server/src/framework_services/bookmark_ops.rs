use super::common::{write_json_atomic, xdg_cache_home};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

static BOOKMARK_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct Bookmark {
    pub(crate) name: String,
    pub(crate) path: String,
    #[serde(flatten)]
    pub(crate) extra: JsonMap<String, Value>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub(crate) struct AddBookmarkRequest {
    pub(crate) name: Option<String>,
    pub(crate) path: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct BookmarkStore {
    bookmarks_file: PathBuf,
    template_file: PathBuf,
    prefix: String,
}

#[derive(Debug)]
pub(crate) struct BookmarkError {
    message: String,
}

impl BookmarkError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }
}

impl From<std::io::Error> for BookmarkError {
    fn from(error: std::io::Error) -> Self {
        Self::new(error.to_string())
    }
}

impl From<serde_json::Error> for BookmarkError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(error.to_string())
    }
}

impl BookmarkStore {
    pub(crate) fn from_project_root(project_root: &str) -> Self {
        Self {
            bookmarks_file: xdg_cache_home()
                .join("termux_extensions")
                .join("file_explorer")
                .join("bookmarks")
                .join("bookmarks.json"),
            template_file: PathBuf::from(project_root)
                .join("app")
                .join("static")
                .join("bookmarks.json"),
            prefix: env::var("PREFIX").unwrap_or_default(),
        }
    }
}

pub(crate) fn list_bookmarks(store: &BookmarkStore) -> Result<Vec<Bookmark>, BookmarkError> {
    with_bookmark_lock(|| read_bookmarks(store))
}

pub(crate) fn add_bookmark(
    store: &BookmarkStore,
    request: AddBookmarkRequest,
) -> Result<Vec<Bookmark>, BookmarkError> {
    with_bookmark_lock(|| {
        let name = request
            .name
            .filter(|value| !value.is_empty())
            .ok_or_else(|| BookmarkError::new("Name and path are required"))?;
        let path = request
            .path
            .filter(|value| !value.is_empty())
            .ok_or_else(|| BookmarkError::new("Name and path are required"))?;
        let mut bookmarks = read_bookmarks(store)?;
        bookmarks.push(Bookmark {
            name,
            path,
            extra: JsonMap::new(),
        });
        write_bookmarks(store, &bookmarks)?;
        Ok(bookmarks)
    })
}

pub(crate) fn replace_bookmarks(
    store: &BookmarkStore,
    bookmarks: Vec<Bookmark>,
) -> Result<Vec<Bookmark>, BookmarkError> {
    with_bookmark_lock(|| {
        ensure_bookmarks_file(store)?;
        write_bookmarks(store, &bookmarks)?;
        Ok(bookmarks)
    })
}

fn with_bookmark_lock<T>(
    operation: impl FnOnce() -> Result<T, BookmarkError>,
) -> Result<T, BookmarkError> {
    let _guard = BOOKMARK_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| BookmarkError::new("Bookmark lock poisoned"))?;
    operation()
}

fn read_bookmarks(store: &BookmarkStore) -> Result<Vec<Bookmark>, BookmarkError> {
    ensure_bookmarks_file(store)?;
    let text = fs::read_to_string(&store.bookmarks_file)?;
    Ok(serde_json::from_str::<Vec<Bookmark>>(&text).unwrap_or_default())
}

fn write_bookmarks(store: &BookmarkStore, bookmarks: &[Bookmark]) -> Result<(), BookmarkError> {
    write_json_atomic(&store.bookmarks_file, &bookmarks)?;
    Ok(())
}

fn ensure_bookmarks_file(store: &BookmarkStore) -> Result<(), BookmarkError> {
    if store.bookmarks_file.exists() {
        return Ok(());
    }
    if let Some(parent) = store.bookmarks_file.parent() {
        fs::create_dir_all(parent)?;
    }
    let bookmarks =
        load_template_bookmarks(&store.template_file, &store.prefix).unwrap_or_default();
    write_bookmarks(store, &bookmarks)
}

fn load_template_bookmarks(
    template_file: &Path,
    prefix: &str,
) -> Result<Vec<Bookmark>, BookmarkError> {
    let mut text = fs::read_to_string(template_file)?;
    if !prefix.is_empty() {
        text = text.replace("$PREFIX", prefix);
    }
    Ok(serde_json::from_str::<Vec<Bookmark>>(&text)?)
}
