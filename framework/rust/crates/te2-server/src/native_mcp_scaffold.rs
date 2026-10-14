//! Typed invocation of the existing app scaffold library (not FastMCP handlers).
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub(crate) enum ScaffoldCall {
    Templates,
    Validate(String),
    Create(Value),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Validate {
    app_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Create {
    app_id: String,
    project_root: String,
    command: String,
    port: i64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default = "start_path")]
    start_path: String,
    #[serde(default = "health_path")]
    health_path: String,
    #[serde(default)]
    icon_src: String,
    #[serde(default)]
    icon_text: String,
    #[serde(default)]
    icon_emoji: String,
    #[serde(default = "readiness")]
    readiness_timeout: f64,
    #[serde(default)]
    socketio_enabled: bool,
    #[serde(default)]
    socketio_inject_path: bool,
    #[serde(default)]
    socketio_namespace_marker: String,
    env: Option<HashMap<String, String>>,
    #[serde(default)]
    overwrite: bool,
}
fn start_path() -> String {
    "/".into()
}
fn health_path() -> String {
    "/api/health".into()
}
fn readiness() -> f64 {
    20.0
}

pub(crate) fn parse(name: &str, args: Value) -> Result<ScaffoldCall, String> {
    match name {
        "te2_apps_templates" => {
            if !args.as_object().is_some_and(|a| a.is_empty()) {
                return Err("templates takes no arguments".into());
            }
            Ok(ScaffoldCall::Templates)
        }
        "te2_validate_proxy_wrapper" => serde_json::from_value::<Validate>(args)
            .map(|v| ScaffoldCall::Validate(v.app_id))
            .map_err(|e| e.to_string()),
        _ => {
            let input: Create = serde_json::from_value(args).map_err(|e| e.to_string())?;
            if !(1..=65535).contains(&input.port) || !input.readiness_timeout.is_finite() {
                return Err("Invalid port/readiness timeout".into());
            }
            Ok(ScaffoldCall::Create(
                serde_json::to_value(input).map_err(|e| e.to_string())?,
            ))
        }
    }
}

pub(crate) async fn dispatch(base: &str, key: &str, call: ScaffoldCall) -> Result<Value, String> {
    let (path, payload) = match call {
        ScaffoldCall::Templates => ("/internal/scaffold/templates", None),
        ScaffoldCall::Validate(app_id) => (
            "/internal/scaffold/validate",
            Some(serde_json::json!({"app_id":app_id})),
        ),
        ScaffoldCall::Create(payload) => ("/internal/scaffold/create", Some(payload)),
    };
    crate::native_mcp_live_console::request_owner(base, key, path, payload, 30.0).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn ingress_is_typed_and_overwrite_is_explicit() {
        let ScaffoldCall::Create(payload)=parse("te2_scaffold_proxy_wrapper",json!({"app_id":"fixture","project_root":"/fixture","command":"npm run dev","port":5000})).unwrap() else { panic!(); };
        assert_eq!(payload["overwrite"], false);
        assert_eq!(payload["start_path"], "/");
        assert_eq!(payload["readiness_timeout"], 20.0);
        for args in [
            json!({}),
            json!({"app_id":"x","project_root":"/fixture","command":"x","port":0}),
            json!({"app_id":"x","project_root":"/fixture","command":"x","port":5000,"env":{"PATH":false}}),
        ] {
            assert!(parse("te2_scaffold_proxy_wrapper", args).is_err());
        }
        assert!(parse("te2_apps_templates", json!({"extra":true})).is_err());
    }
}
