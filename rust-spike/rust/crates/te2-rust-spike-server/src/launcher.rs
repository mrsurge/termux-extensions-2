use crate::registry::AppDefinition;
#[cfg(feature = "ferrous-framework-native")]
use crate::registry::AppShell;
#[cfg(feature = "ferrous-framework-native")]
use anyhow::Context;
use anyhow::{Result, bail};
#[cfg(feature = "ferrous-framework-native")]
use ferrous_framework::{
    FerrousNativeManager, FerrousShellLaunchOverrides, shellspec::ShellspecRenderInput,
};
use serde::Serialize;
#[cfg(feature = "ferrous-framework-native")]
use serde_json::{Map, Value};
use std::path::Path;
#[cfg(feature = "ferrous-framework-native")]
use std::{collections::HashMap, fs, path::PathBuf};

#[derive(Debug, Serialize)]
pub struct LaunchResult {
    pub app_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub shell_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub source: &'static str,
}

#[derive(Default)]
pub struct LaunchStore {
    #[cfg(feature = "ferrous-framework-native")]
    manager: Option<FerrousNativeManager>,
}

impl LaunchStore {
    #[cfg(feature = "ferrous-framework-native")]
    pub fn new(manager: Option<FerrousNativeManager>) -> Self {
        Self { manager }
    }
}

pub fn launch_supported() -> bool {
    cfg!(feature = "ferrous-framework-native")
}

pub fn launch_app(
    store: &LaunchStore,
    app: &AppDefinition,
    project_root: &Path,
    framework_url: &str,
    framework_shells_env: &std::collections::HashMap<String, String>,
) -> Result<LaunchResult> {
    #[cfg(not(feature = "ferrous-framework-native"))]
    {
        let _ = (
            store,
            app,
            project_root,
            framework_url,
            framework_shells_env,
        );
        bail!("Rust spike was built without the ferrous-framework-native feature")
    }

    #[cfg(feature = "ferrous-framework-native")]
    {
        // App launch is owned by the same Ferrous native manager that backs the
        // dashboard/peer host, so FWS metadata and shutdown controls stay aligned.
        let manager = store
            .manager
            .clone()
            .context("Ferrous native manager is unavailable")?;
        let shell = app
            .shells
            .first()
            .context("app has no app worker shellspec")?;
        let (shellspec_path, shellspec_entry) = shellspec_launch_target(app, shell)?;
        let ctx = build_launch_context(app, project_root);
        let mut launch_env_overrides = HashMap::new();
        merge_shell_env_overrides(&mut launch_env_overrides, shell);
        launch_env_overrides.insert("TE_APP_ID".to_owned(), app.app_id.clone());
        launch_env_overrides.insert("TE_FRAMEWORK_URL".to_owned(), framework_url.to_owned());
        let mut render_env = framework_shells_env.clone();
        render_env.extend(launch_env_overrides.clone());

        let entry_name = shellspec_entry
            .clone()
            .unwrap_or_else(|| "app-worker".to_owned());
        let document = load_shellspec_document(&shellspec_path)?;
        let input = ShellspecRenderInput {
            ctx,
            env: render_env,
        };
        let label = shell
            .label
            .clone()
            .unwrap_or_else(|| format!("app-worker:{}", app.app_id));
        let record = manager
            .spawn_shellspec_entry_with_overrides_blocking(
                &document,
                &entry_name,
                &input,
                FerrousShellLaunchOverrides {
                    env: launch_env_overrides,
                    label: Some(label),
                    spec_id: Some(format!("app:{}:{entry_name}", app.app_id)),
                    subgroups: Some(vec![app.app_id.clone(), shell.subgroup.clone()]),
                    ui: build_shell_ui(app, shell),
                    debug: None,
                    parent_shell_id: None,
                },
            )
            .context("failed to spawn app worker through ferrous_framework native manager")?;
        let shell_id = record.id.clone();
        Ok(LaunchResult {
            app_id: app.app_id.clone(),
            port: None,
            shell_id,
            label: Some(record.label),
            source: "ferrous_framework_native",
        })
    }
}

#[cfg(feature = "ferrous-framework-native")]
fn build_shell_ui(app: &AppDefinition, shell: &AppShell) -> Option<Map<String, Value>> {
    let mut ui = Map::new();
    if let Some(framework_shell_ui) = &app.framework_shell_ui {
        ui.extend(framework_shell_ui.clone());
    }
    ui.extend(shell.ui.clone());
    if ui.is_empty() { None } else { Some(ui) }
}

#[cfg(feature = "ferrous-framework-native")]
fn build_launch_context(app: &AppDefinition, project_root: &Path) -> HashMap<String, String> {
    let mut ctx = HashMap::new();
    ctx.insert("APP_ID".to_owned(), app.app_id.clone());
    ctx.insert(
        "PROJECT_ROOT".to_owned(),
        project_root.display().to_string(),
    );
    if let Some(backend_module) = app.backend_module() {
        let backend_path = app.root_dir.join(backend_module);
        let backend_path = backend_path
            .canonicalize()
            .unwrap_or(backend_path)
            .display()
            .to_string();
        ctx.insert("BACKEND_MODULE_PATH".to_owned(), backend_path);
    }
    ctx
}

#[cfg(feature = "ferrous-framework-native")]
fn merge_shell_env_overrides(target: &mut HashMap<String, String>, shell: &AppShell) {
    for (key, value) in &shell.env {
        if let Some(value) = json_scalar_string(value) {
            target.insert(key.clone(), value);
        }
    }
}

#[cfg(feature = "ferrous-framework-native")]
fn shellspec_launch_target(
    app: &AppDefinition,
    shell: &AppShell,
) -> Result<(PathBuf, Option<String>)> {
    if let Some(reference) = shell.ref_path.as_deref() {
        let (relative_path, entry_id) = split_shellspec_ref(reference)?;
        return Ok((app.root_dir.join(relative_path), entry_id));
    }
    bail!(
        "app '{}' declares an inline app-worker shellspec; rust-spike launch currently requires a shellspec ref",
        app.app_id
    )
}

#[cfg(feature = "ferrous-framework-native")]
fn split_shellspec_ref(reference: &str) -> Result<(String, Option<String>)> {
    let mut parts = reference.splitn(2, '#');
    let path = parts.next().unwrap_or_default().trim();
    if path.is_empty() {
        bail!("shellspec ref is missing a path")
    }
    let entry = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    Ok((path.to_owned(), entry))
}

#[cfg(feature = "ferrous-framework-native")]
fn load_shellspec_document(shellspec_path: &Path) -> Result<Value> {
    let raw = fs::read_to_string(shellspec_path)
        .with_context(|| format!("failed to read shellspec {}", shellspec_path.display()))?;
    serde_yaml::from_str(&raw)
        .with_context(|| format!("failed to parse shellspec {}", shellspec_path.display()))
}

#[cfg(feature = "ferrous-framework-native")]
fn json_scalar_string(value: &Value) -> Option<String> {
    match value {
        Value::Null => Some(String::new()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::String(value) => Some(value.clone()),
        _ => None,
    }
}
