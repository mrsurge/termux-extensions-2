//! Administrative shortcut intent: registry-owned manifest, worker-owned prefs.
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ShortcutInput {
    pub app_id: String,
    #[serde(default)]
    label: String,
    #[serde(default = "lazy")]
    load: String,
    #[serde(default = "yes")]
    header: bool,
    #[serde(default = "yes")]
    activate: bool,
}
fn lazy() -> String {
    "lazy".into()
}
fn yes() -> bool {
    true
}

pub(crate) fn project(input: ShortcutInput, manifest_name: &str) -> Value {
    let app_id = input.app_id.trim();
    let label = if !input.label.trim().is_empty() {
        input.label.trim()
    } else if !manifest_name.trim().is_empty() {
        manifest_name.trim()
    } else {
        app_id
    };
    // The legacy tool accepts activate but does not launch/activate a view.
    // Preserve that contract; do not introduce an implicit app start here.
    let _ = input.activate;
    json!({"shortcut":{"id":format!("framework_app::{app_id}"),"kind":"framework_app","app_id":app_id,
        "label":label,"url":format!("/app/{app_id}?embed=1"),"icon":null,
        "load":if input.load.trim().eq_ignore_ascii_case("eager") {"eager"} else {"lazy"},
        "header":input.header,"last_used":0}})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_label_and_load_match_legacy_without_starting() {
        let input: ShortcutInput =
            serde_json::from_value(json!({"app_id":" sample-app "})).unwrap();
        let value = project(input, "Sample App");
        assert_eq!(value["shortcut"]["id"], "framework_app::sample-app");
        assert_eq!(value["shortcut"]["label"], "Sample App");
        assert_eq!(value["shortcut"]["load"], "lazy");
        assert_eq!(value["shortcut"]["header"], true);
        assert!(
            serde_json::from_value::<ShortcutInput>(json!({"app_id":"x","url":"forged"})).is_err()
        );
    }
}
