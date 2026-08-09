use super::common::write_json_atomic;
use crate::te2_paths;
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
            bookmarks_file: te2_paths::data_home()
                .join("framework")
                .join("bookmarks.json"),
            template_file: PathBuf::from(project_root)
                .join("app")
                .join("static")
                .join("bookmarks.json"),
            prefix: env::var("PREFIX").unwrap_or_default(),
        }
    }

    #[cfg(test)]
    fn from_parts(bookmarks_file: PathBuf, template_file: PathBuf, prefix: String) -> Self {
        Self {
            bookmarks_file,
            template_file,
            prefix,
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_bookmark_store_seeds_the_template_and_expands_prefix() {
        let root = tempfile::tempdir().expect("tempdir");
        let template = root.path().join("bookmarks-template.json");
        fs::write(
            &template,
            r#"[{"name":"Home","path":"$PREFIX/home","icon":"house"}]"#,
        )
        .expect("write template");
        let store = BookmarkStore::from_parts(
            root.path().join("framework/bookmarks.json"),
            template,
            "/termux/usr".to_owned(),
        );

        let bookmarks = list_bookmarks(&store).expect("list");
        assert_eq!(bookmarks.len(), 1);
        assert_eq!(bookmarks[0].path, "/termux/usr/home");
        assert_eq!(bookmarks[0].extra.get("icon"), Some(&json!("house")));
    }

    #[test]
    fn bookmark_add_and_replace_preserve_extra_fields() {
        let root = tempfile::tempdir().expect("tempdir");
        let template = root.path().join("bookmarks-template.json");
        fs::write(&template, "[]").expect("write template");
        let store = BookmarkStore::from_parts(
            root.path().join("framework/bookmarks.json"),
            template,
            String::new(),
        );

        let added = add_bookmark(
            &store,
            AddBookmarkRequest {
                name: Some("Project".to_owned()),
                path: Some("/project".to_owned()),
            },
        )
        .expect("add");
        assert_eq!(added.len(), 1);

        let replacement = Bookmark {
            name: "Downloads".to_owned(),
            path: "/downloads".to_owned(),
            extra: serde_json::from_value(json!({"pinned": true})).expect("extra map"),
        };
        replace_bookmarks(&store, vec![replacement]).expect("replace");
        let persisted = list_bookmarks(&store).expect("reload");
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].extra.get("pinned"), Some(&json!(true)));
    }
}
