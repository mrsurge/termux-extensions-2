use super::common::write_json_atomic;
use crate::te2_paths;
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

static STATE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
pub(crate) struct StateReadRequest {
    pub(crate) keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct StateWriteRequest {
    pub(crate) key: String,
    #[serde(default)]
    pub(crate) value: Value,
    #[serde(default)]
    pub(crate) merge: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct StateDeleteRequest {
    pub(crate) keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct StateDeleteData {
    pub(crate) removed: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct StateStore {
    path: PathBuf,
}

#[derive(Debug)]
pub(crate) enum StateError {
    MissingKey,
    EmptyKey,
    Io(std::io::Error),
}

impl From<std::io::Error> for StateError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl StateStore {
    pub(crate) fn default() -> Self {
        Self {
            path: te2_paths::data_home()
                .join("framework")
                .join("state_store.json"),
        }
    }

    #[cfg(test)]
    fn from_path(path: PathBuf) -> Self {
        Self { path }
    }
}

pub(crate) fn get_state(
    store: &StateStore,
    request: StateReadRequest,
) -> Result<JsonMap<String, Value>, StateError> {
    if request.keys.is_empty() {
        return Err(StateError::MissingKey);
    }
    let store_data = load_value_map(&store.path);
    let mut data = JsonMap::new();
    for key in request.keys {
        let value = store_data.get(&key).cloned().unwrap_or(Value::Null);
        data.insert(key, value);
    }
    Ok(data)
}

pub(crate) fn set_state(
    store: &StateStore,
    request: StateWriteRequest,
) -> Result<Value, StateError> {
    if request.key.trim().is_empty() {
        return Err(StateError::EmptyKey);
    }
    with_state_write_lock(|| {
        let mut store_data = load_value_map(&store.path);
        let value = if request.merge {
            merge_state_value(store_data.get(&request.key), request.value)
        } else {
            request.value
        };
        store_data.insert(request.key.clone(), value);
        save_value_map(&store.path, &store_data)?;
        Ok(store_data.get(&request.key).cloned().unwrap_or(Value::Null))
    })
}

pub(crate) fn delete_state(
    store: &StateStore,
    request: StateDeleteRequest,
) -> Result<StateDeleteData, StateError> {
    if request.keys.is_empty() {
        return Err(StateError::MissingKey);
    }
    with_state_write_lock(|| {
        let mut store_data = load_value_map(&store.path);
        let mut removed = 0_u64;
        for key in request.keys {
            if store_data.remove(&key).is_some() {
                removed += 1;
            }
        }
        save_value_map(&store.path, &store_data)?;
        Ok(StateDeleteData { removed })
    })
}

pub(crate) fn move_state_key_if_present(
    store: &StateStore,
    source_key: &str,
    destination_key: &str,
) -> Result<Value, StateError> {
    if source_key.trim().is_empty() || destination_key.trim().is_empty() {
        return Err(StateError::EmptyKey);
    }
    with_state_write_lock(|| {
        let mut store_data = load_value_map(&store.path);
        if source_key == destination_key {
            return Ok(store_data
                .get(destination_key)
                .cloned()
                .unwrap_or(Value::Null));
        }
        let Some(source_value) = store_data.remove(source_key) else {
            return Ok(store_data
                .get(destination_key)
                .cloned()
                .unwrap_or(Value::Null));
        };
        store_data
            .entry(destination_key.to_owned())
            .or_insert(source_value);
        save_value_map(&store.path, &store_data)?;
        Ok(store_data
            .get(destination_key)
            .cloned()
            .unwrap_or(Value::Null))
    })
}

fn with_state_write_lock<T>(
    operation: impl FnOnce() -> Result<T, StateError>,
) -> Result<T, StateError> {
    let _guard = STATE_WRITE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| StateError::Io(std::io::Error::other("State store lock poisoned")))?;
    operation()
}

fn merge_state_value(existing: Option<&Value>, next: Value) -> Value {
    if let (Some(Value::Object(existing_map)), Value::Object(next_map)) = (existing, &next) {
        let mut merged = existing_map.clone();
        for (key, value) in next_map {
            merged.insert(key.clone(), value.clone());
        }
        Value::Object(merged)
    } else {
        next
    }
}

fn load_value_map(path: &PathBuf) -> JsonMap<String, Value> {
    let Ok(text) = fs::read_to_string(path) else {
        return JsonMap::new();
    };
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn save_value_map(path: &PathBuf, data: &JsonMap<String, Value>) -> Result<(), std::io::Error> {
    write_json_atomic(path, &Value::Object(data.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn state_round_trip_merge_and_delete_preserve_the_object_schema() {
        let root = tempfile::tempdir().expect("tempdir");
        let store = StateStore::from_path(root.path().join("framework/state_store.json"));

        set_state(
            &store,
            StateWriteRequest {
                key: "app_state:test".to_owned(),
                value: json!({"first": 1, "keep": true}),
                merge: false,
            },
        )
        .expect("initial write");
        let merged = set_state(
            &store,
            StateWriteRequest {
                key: "app_state:test".to_owned(),
                value: json!({"first": 2, "second": 3}),
                merge: true,
            },
        )
        .expect("merge");
        assert_eq!(merged, json!({"first": 2, "keep": true, "second": 3}));

        let read = get_state(
            &store,
            StateReadRequest {
                keys: vec!["app_state:test".to_owned(), "missing".to_owned()],
            },
        )
        .expect("read");
        assert_eq!(read.get("app_state:test"), Some(&merged));
        assert_eq!(read.get("missing"), Some(&Value::Null));

        let deleted = delete_state(
            &store,
            StateDeleteRequest {
                keys: vec!["app_state:test".to_owned()],
            },
        )
        .expect("delete");
        assert_eq!(deleted.removed, 1);
    }

    #[test]
    fn concurrent_state_updates_do_not_drop_independent_keys() {
        let root = tempfile::tempdir().expect("tempdir");
        let store = StateStore::from_path(root.path().join("framework/state_store.json"));
        let handles = (0..12)
            .map(|index| {
                let store = store.clone();
                std::thread::spawn(move || {
                    set_state(
                        &store,
                        StateWriteRequest {
                            key: format!("key-{index}"),
                            value: json!(index),
                            merge: false,
                        },
                    )
                    .expect("concurrent write");
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().expect("join writer");
        }

        let persisted = load_value_map(&store.path);
        assert_eq!(persisted.len(), 12);
        for index in 0..12 {
            assert_eq!(persisted.get(&format!("key-{index}")), Some(&json!(index)));
        }
    }

    #[test]
    fn state_key_move_is_destructive_and_never_overwrites_the_destination() {
        let root = tempfile::tempdir().expect("tempdir");
        let store = StateStore::from_path(root.path().join("framework/state_store.json"));
        set_state(
            &store,
            StateWriteRequest {
                key: "app_state:file_editor_cm6".to_owned(),
                value: json!({"legacy": true}),
                merge: false,
            },
        )
        .expect("legacy write");

        let moved =
            move_state_key_if_present(&store, "app_state:file_editor_cm6", "app_state:code_te2")
                .expect("move state key");
        assert_eq!(moved, json!({"legacy": true}));
        let persisted = load_value_map(&store.path);
        assert!(!persisted.contains_key("app_state:file_editor_cm6"));
        assert_eq!(persisted.get("app_state:code_te2"), Some(&moved));

        set_state(
            &store,
            StateWriteRequest {
                key: "app_state:file_editor_cm6".to_owned(),
                value: json!({"stale": true}),
                merge: false,
            },
        )
        .expect("second legacy write");
        let retained =
            move_state_key_if_present(&store, "app_state:file_editor_cm6", "app_state:code_te2")
                .expect("destination wins");
        assert_eq!(retained, moved);
        let persisted = load_value_map(&store.path);
        assert!(!persisted.contains_key("app_state:file_editor_cm6"));
        assert_eq!(persisted.get("app_state:code_te2"), Some(&moved));
    }
}
