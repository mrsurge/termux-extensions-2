use crate::registry::AppDefinition;
#[cfg(feature = "ferrous-framework-native")]
use crate::registry::AppShell;
#[cfg(feature = "ferrous-framework-native")]
use anyhow::Context;
use anyhow::{Result, bail};
#[cfg(feature = "ferrous-framework-native")]
use ferrous_framework::{
    FerrousNativeManager, FerrousShellLaunchOverrides,
    shellspec::{ShellspecRenderInput, render_shellspec_entry},
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
    pub shells: Vec<LaunchedShell>,
    pub source: &'static str,
}

#[derive(Debug, Serialize)]
pub struct LaunchedShell {
    pub shell_id: String,
    pub label: String,
    pub entry_name: String,
    pub subgroup: String,
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

    #[cfg(feature = "ferrous-framework-native")]
    pub fn manager(&self) -> Option<FerrousNativeManager> {
        self.manager.clone()
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
    framework_port: u16,
    framework_shells_env: &std::collections::HashMap<String, String>,
) -> Result<LaunchResult> {
    #[cfg(not(feature = "ferrous-framework-native"))]
    {
        let _ = (
            store,
            app,
            project_root,
            framework_url,
            framework_port,
            framework_shells_env,
        );
        bail!("TE2 server was built without the ferrous-framework-native feature")
    }

    #[cfg(feature = "ferrous-framework-native")]
    {
        // App launch is owned by the same Ferrous native manager that backs the
        // dashboard/peer host, so FWS metadata and shutdown controls stay aligned.
        let manager = store
            .manager
            .clone()
            .context("Ferrous native manager is unavailable")?;
        let ctx = build_launch_context(app, project_root);
        let mut launched_shells = Vec::new();
        let mut primary_shell_id: Option<String> = None;
        let mut primary_label: Option<String> = None;

        // App launch keeps the manifest app-worker as the lifecycle/proxy
        // authority. If that shellspec renders backend=pipe, the same process
        // is both the FastAPI worker and the framework RPC pipe endpoint.
        for shell in &app.shells {
            let (shellspec_path, shellspec_entry) = shellspec_launch_target(app, shell)?;
            let entry_name = shellspec_entry.unwrap_or_else(|| "app-worker".to_owned());
            let document = load_shellspec_document(&shellspec_path)?;

            let mut launch_env_overrides = HashMap::new();
            merge_shell_env_overrides(&mut launch_env_overrides, shell);
            apply_framework_launch_env(
                &mut launch_env_overrides,
                &app.app_id,
                framework_url,
                framework_port,
            );
            let mut render_env = framework_shells_env.clone();
            render_env.extend(launch_env_overrides.clone());

            let input = ShellspecRenderInput {
                ctx: ctx.clone(),
                env: render_env,
            };
            let mut rendered_shell = render_shellspec_entry(&document, &entry_name, &input)?;
            let label = shell
                .label
                .clone()
                .unwrap_or_else(|| default_shell_label(app, shell, &entry_name));
            let parent_shell_id = if is_app_worker_shell(shell) {
                None
            } else {
                primary_shell_id.clone()
            };

            // App-level readiness is the Python framework parity path for larger apps:
            // launch the worker, then let /api/apps/{app_id}/readiness become authority.
            if should_bypass_shellspec_readiness(app, shell) {
                rendered_shell.readiness = None;
            }
            let record = manager
                .spawn_rendered_shellspec_with_overrides_blocking(
                    rendered_shell.clone(),
                    FerrousShellLaunchOverrides {
                        env: launch_env_overrides,
                        label: Some(label),
                        spec_id: Some(format!("app:{}:{entry_name}", app.app_id)),
                        subgroups: Some(shell_launch_subgroups(
                            app,
                            shell,
                            &rendered_shell.subgroups,
                            &rendered_shell.env,
                        )),
                        ui: build_shell_ui(app, shell),
                        debug: None,
                        parent_shell_id,
                    },
                )
                .with_context(|| {
                    format!(
                        "failed to spawn app shell '{entry_name}' through ferrous_framework native manager"
                    )
                })?;

            if is_app_worker_shell(shell) && primary_shell_id.is_none() {
                primary_shell_id = Some(record.id.clone());
                primary_label = Some(record.label.clone());
            }
            launched_shells.push(LaunchedShell {
                shell_id: record.id,
                label: record.label,
                entry_name,
                subgroup: shell.subgroup.clone(),
            });
        }

        let primary = primary_shell_id
            .or_else(|| launched_shells.first().map(|shell| shell.shell_id.clone()));
        let shell_id = primary.context("app has no launchable shellspec")?;
        Ok(LaunchResult {
            app_id: app.app_id.clone(),
            port: None,
            shell_id,
            label: primary_label,
            shells: launched_shells,
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
fn default_shell_label(app: &AppDefinition, shell: &AppShell, entry_name: &str) -> String {
    if is_app_worker_shell(shell) {
        format!("app-worker:{}", app.app_id)
    } else {
        format!("app-shell:{}:{entry_name}", app.app_id)
    }
}

#[cfg(feature = "ferrous-framework-native")]
fn is_app_worker_shell(shell: &AppShell) -> bool {
    shell.subgroup.trim() == "app-worker"
}

#[cfg(feature = "ferrous-framework-native")]
fn should_bypass_shellspec_readiness(app: &AppDefinition, shell: &AppShell) -> bool {
    app.readiness_support && is_app_worker_shell(shell)
}

#[cfg(feature = "ferrous-framework-native")]
fn shell_launch_subgroups(
    app: &AppDefinition,
    shell: &AppShell,
    rendered_subgroups: &[String],
    rendered_env: &HashMap<String, String>,
) -> Vec<String> {
    let mut subgroups = Vec::new();
    push_unique_subgroup(&mut subgroups, &app.app_id);
    push_unique_subgroup(&mut subgroups, shell.subgroup.trim());
    for subgroup in rendered_subgroups {
        push_unique_subgroup(&mut subgroups, subgroup);
    }
    if is_app_worker_shell(shell) {
        for service_name in rendered_pipe_service_names(rendered_env) {
            push_unique_subgroup(&mut subgroups, service_name);
        }
    }
    subgroups
}

#[cfg(feature = "ferrous-framework-native")]
fn rendered_pipe_service_names(rendered_env: &HashMap<String, String>) -> Vec<&str> {
    let mut names = Vec::new();
    for env_key in ["TE_PIPE_NAME", "TE_PIPE_NAMES"] {
        if let Some(raw) = rendered_env.get(env_key) {
            for name in raw.split([',', ';']).map(str::trim) {
                if !name.is_empty() && !names.iter().any(|existing| existing == &name) {
                    names.push(name);
                }
            }
        }
    }
    names
}

#[cfg(feature = "ferrous-framework-native")]
fn push_unique_subgroup(subgroups: &mut Vec<String>, value: &str) {
    let value = value.trim();
    if value.is_empty() || subgroups.iter().any(|existing| existing == value) {
        return;
    }
    subgroups.push(value.to_owned());
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
fn apply_framework_launch_env(
    target: &mut HashMap<String, String>,
    app_id: &str,
    framework_url: &str,
    framework_port: u16,
) {
    target.insert("TE_APP_ID".to_owned(), app_id.to_owned());
    target.insert("TE_FRAMEWORK_URL".to_owned(), framework_url.to_owned());
    target.insert("TE_PORT".to_owned(), framework_port.to_string());
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
        "app '{}' declares an inline shellspec; TE2 server launch currently requires a shellspec ref",
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

#[cfg(all(test, feature = "ferrous-framework-native"))]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn shell(subgroup: &str) -> AppShell {
        AppShell {
            ref_path: Some("shellspec/app_worker.yaml#app-worker".to_owned()),
            inline_spec: None,
            label: None,
            subgroup: subgroup.to_owned(),
            wait_ready: true,
            env: Map::new(),
            ui: Map::new(),
        }
    }

    fn app(readiness_support: bool) -> AppDefinition {
        AppDefinition {
            app_id: "example".to_owned(),
            id_aliases: Vec::new(),
            name: "Example".to_owned(),
            description: String::new(),
            dir_name: "example".to_owned(),
            root_dir: PathBuf::from("/example"),
            manifest_path: PathBuf::from("/example/manifest.json"),
            source_kind: "test".to_owned(),
            source_root: PathBuf::from("/"),
            asset_base_url: "/apps/by-id/example".to_owned(),
            entrypoints: Map::new(),
            shells: Vec::new(),
            services_path: "services".to_owned(),
            service_modules: Vec::new(),
            proxy_shell: None,
            framework_shell_ui: None,
            icon_src_raw: String::new(),
            icon_text: String::new(),
            icon_emoji: String::new(),
            fullscreen: false,
            readiness_support,
            enabled: true,
            raw_manifest: Map::new(),
            registry_errors: Vec::new(),
        }
    }

    #[test]
    fn readiness_support_app_worker_uses_app_level_readiness() {
        assert!(should_bypass_shellspec_readiness(
            &app(true),
            &shell("app-worker")
        ));
    }

    #[test]
    fn non_readiness_support_app_worker_keeps_shellspec_readiness() {
        assert!(!should_bypass_shellspec_readiness(
            &app(false),
            &shell("app-worker")
        ));
    }

    #[test]
    fn non_app_worker_shell_keeps_shellspec_readiness() {
        assert!(!should_bypass_shellspec_readiness(
            &app(true),
            &shell("service.worker")
        ));
    }

    #[test]
    fn framework_identity_is_an_explicit_launch_override() {
        let mut overrides = HashMap::new();
        overrides.insert("TE_PORT".to_owned(), "8089".to_owned());
        apply_framework_launch_env(&mut overrides, "example", "http://127.0.0.1:8081", 8081);

        assert_eq!(
            overrides.get("TE_APP_ID").map(String::as_str),
            Some("example")
        );
        assert_eq!(
            overrides.get("TE_FRAMEWORK_URL").map(String::as_str),
            Some("http://127.0.0.1:8081")
        );
        assert_eq!(overrides.get("TE_PORT").map(String::as_str), Some("8081"));
    }
}
