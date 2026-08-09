use super::common::write_json_atomic;
use crate::te2_paths;
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
            path: te2_paths::config_home()
                .join("framework")
                .join("settings.json"),
        }
    }

    #[cfg(test)]
    fn from_path(path: PathBuf) -> Self {
        Self { path }
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_round_trip_preserves_the_object_schema() {
        let root = tempfile::tempdir().expect("tempdir");
        let store = SettingsStore::from_path(root.path().join("framework/settings.json"));
        let expected = serde_json::from_value::<SettingsMap>(json!({
            "persistent_network_notification": true,
            "theme": "dark",
            "nested": {"enabled": true}
        }))
        .expect("settings map");

        assert_eq!(
            save_settings(&store, expected.clone()).expect("save"),
            expected
        );
        assert_eq!(load_settings(&store), expected);
        assert!(android_config(&store).persistent_network_notification);
    }

    #[test]
    fn missing_or_malformed_settings_remain_an_empty_object() {
        let root = tempfile::tempdir().expect("tempdir");
        let path = root.path().join("framework/settings.json");
        let store = SettingsStore::from_path(path.clone());
        assert!(load_settings(&store).is_empty());

        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(path, "not-json").expect("write malformed settings");
        assert!(load_settings(&store).is_empty());
    }
}
