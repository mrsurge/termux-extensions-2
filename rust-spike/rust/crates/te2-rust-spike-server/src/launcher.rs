use crate::registry::AppDefinition;
#[cfg(feature = "ferrous-framework-pyo3")]
use crate::registry::AppShell;
#[cfg(feature = "ferrous-framework-pyo3")]
use anyhow::{Context, anyhow};
use anyhow::{Result, bail};
#[cfg(feature = "ferrous-framework-pyo3")]
use ferrous_framework::{FerrousBackend, FerrousFrameworkShell, FerrousShellConfig};
use serde::Serialize;
#[cfg(feature = "ferrous-framework-pyo3")]
use serde_json::Value;
use std::path::Path;
#[cfg(feature = "ferrous-framework-pyo3")]
use std::{collections::HashMap, path::PathBuf, sync::Mutex};

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
    #[cfg(feature = "ferrous-framework-pyo3")]
    handles: Mutex<HashMap<String, FerrousFrameworkShell>>,
}

impl LaunchStore {
    #[cfg(feature = "ferrous-framework-pyo3")]
    fn remember(&self, shell_id: String, handle: FerrousFrameworkShell) -> Result<()> {
        let mut handles = self
            .handles
            .lock()
            .map_err(|_| anyhow!("launch store lock poisoned"))?;
        handles.insert(shell_id, handle);
        Ok(())
    }
}

pub fn launch_supported() -> bool {
    cfg!(feature = "ferrous-framework-pyo3")
}

pub fn launch_app(
    store: &LaunchStore,
    app: &AppDefinition,
    project_root: &Path,
    framework_url: &str,
    framework_shells_env: &std::collections::HashMap<String, String>,
) -> Result<LaunchResult> {
    #[cfg(not(feature = "ferrous-framework-pyo3"))]
    {
        let _ = (
            store,
            app,
            project_root,
            framework_url,
            framework_shells_env,
        );
        bail!("Rust spike was built without the ferrous-framework-pyo3 feature")
    }

    #[cfg(feature = "ferrous-framework-pyo3")]
    {
        let shell = app
            .shells
            .first()
            .context("app has no app worker shellspec")?;
        let (shellspec_path, shellspec_entry) = shellspec_launch_target(app, shell)?;
        let ctx = build_launch_context(app, project_root);
        let mut launch_env = framework_shells_env.clone();
        merge_shell_env_overrides(&mut launch_env, shell);
        launch_env.insert("TE_APP_ID".to_owned(), app.app_id.clone());
        launch_env.insert("TE_FRAMEWORK_URL".to_owned(), framework_url.to_owned());

        let label = shell
            .label
            .clone()
            .unwrap_or_else(|| format!("app-worker:{}", app.app_id));
        let entry_name = shellspec_entry
            .clone()
            .unwrap_or_else(|| "app-worker".to_owned());
        let spec_id = format!("app:{}:{}", app.app_id, entry_name);
        let subgroups = vec![app.app_id.clone(), shell.subgroup.clone()];
        let handle = FerrousFrameworkShell::spawn(FerrousShellConfig {
            backend: FerrousBackend::Proc,
            // Ferrous owns shellspec rendering here. These placeholder values exist
            // only so default ctx keys like CWD/PYTHON remain sane if referenced.
            command: vec!["python".to_owned()],
            cwd: Some(PathBuf::from(project_root)),
            env: launch_env,
            label: label.clone(),
            spec_id,
            subgroups,
            ctx,
            shellspec_path: Some(shellspec_path),
            shellspec_entry,
            python_module: None,
            python_class: None,
        })
        .context("failed to spawn app worker through ferrous_framework")?;
        let shell_id = handle
            .shell_id()
            .context("failed to read ferrous_framework shell id")?;
        store.remember(shell_id.clone(), handle)?;
        Ok(LaunchResult {
            app_id: app.app_id.clone(),
            port: None,
            shell_id,
            label: Some(label),
            source: "ferrous_framework",
        })
    }
}

#[cfg(feature = "ferrous-framework-pyo3")]
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

#[cfg(feature = "ferrous-framework-pyo3")]
fn merge_shell_env_overrides(target: &mut HashMap<String, String>, shell: &AppShell) {
    for (key, value) in &shell.env {
        if let Some(value) = json_scalar_string(value) {
            target.insert(key.clone(), value);
        }
    }
}

#[cfg(feature = "ferrous-framework-pyo3")]
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

#[cfg(feature = "ferrous-framework-pyo3")]
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

#[cfg(feature = "ferrous-framework-pyo3")]
fn json_scalar_string(value: &Value) -> Option<String> {
    match value {
        Value::Null => Some(String::new()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::String(value) => Some(value.clone()),
        _ => None,
    }
}
