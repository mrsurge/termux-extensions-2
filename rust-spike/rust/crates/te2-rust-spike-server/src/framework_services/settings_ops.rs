use super::common::{write_json_atomic, xdg_cache_home};
use serde::Serialize;
use serde_json::{Map as JsonMap, Value};
use std::{fs, path::PathBuf};

pub(crate) type SettingsMap = JsonMap<String, Value>;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AndroidConfigData {
    pub(crate) persistent_network_notification: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub(crate) fn default() -> Self {
        Self {
            path: xdg_cache_home()
                .join("termux_extensions")
                .join("settings.json"),
        }
    }
}

pub(crate) fn load_settings(store: &SettingsStore) -> SettingsMap {
    load_value_map(&store.path)
}

pub(crate) fn save_settings(
    store: &SettingsStore,
    settings: SettingsMap,
) -> Result<SettingsMap, std::io::Error> {
    write_json_atomic(&store.path, &Value::Object(settings.clone()))?;
    Ok(settings)
}

pub(crate) fn android_config(store: &SettingsStore) -> AndroidConfigData {
    let settings = load_settings(store);
    let persistent_network_notification = settings
        .get("persistent_network_notification")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    AndroidConfigData {
        persistent_network_notification,
    }
}

fn load_value_map(path: &PathBuf) -> SettingsMap {
    let Ok(text) = fs::read_to_string(path) else {
        return SettingsMap::new();
    };
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}
