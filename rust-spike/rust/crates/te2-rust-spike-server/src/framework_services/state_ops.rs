use super::common::{write_json_atomic, xdg_cache_home};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value};
use std::{fs, path::PathBuf};

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
            path: xdg_cache_home()
                .join("termux_extensions")
                .join("state_store.json"),
        }
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
    let mut store_data = load_value_map(&store.path);
    let value = if request.merge {
        merge_state_value(store_data.get(&request.key), request.value)
    } else {
        request.value
    };
    store_data.insert(request.key.clone(), value);
    save_value_map(&store.path, &store_data)?;
    Ok(store_data.get(&request.key).cloned().unwrap_or(Value::Null))
}

pub(crate) fn delete_state(
    store: &StateStore,
    request: StateDeleteRequest,
) -> Result<StateDeleteData, StateError> {
    if request.keys.is_empty() {
        return Err(StateError::MissingKey);
    }
    let mut store_data = load_value_map(&store.path);
    let mut removed = 0_u64;
    for key in request.keys {
        if store_data.remove(&key).is_some() {
            removed += 1;
        }
    }
    save_value_map(&store.path, &store_data)?;
    Ok(StateDeleteData { removed })
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
