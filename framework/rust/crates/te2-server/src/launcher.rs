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
use std::{collections::HashMap, path::PathBuf};

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

pub(crate) fn runtime_debug_enabled() -> bool {
    std::env::var("TE2_RUNTIME_DEBUG").is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

pub(crate) fn console_debug_enabled() -> bool {
    crate::console_policy::enabled()
}

pub(crate) fn console_debug_default() -> bool {
    console_debug_policy(
        runtime_debug_enabled(),
        std::env::var("TE2_DEBUG_CONSOLE").ok().as_deref(),
    )
}

fn console_debug_policy(runtime_debug: bool, console: Option<&str>) -> bool {
    runtime_debug
        || console.is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
}

#[cfg(test)]
#[test]
fn console_policy_is_independent_of_runtime_diagnostics() {
    for flag in [None, Some("0"), Some("false"), Some(""), Some("unknown")] {
        assert!(!console_debug_policy(false, flag));
        assert!(console_debug_policy(true, flag));
    }
    for flag in ["1", "true", "yes", "on", " TRUE "] {
        assert!(console_debug_policy(false, Some(flag)));
    }
}

pub fn launch_app(
    store: &LaunchStore,
    app: &AppDefinition,
    project_root: &Path,
    framework_url: &str,
    framework_port: u16,
    framework_shells_env: &std::collections::HashMap<String, String>,
    initialization: &crate::app_catalog::AppInitialization,
    native: Option<&crate::native_selection::WorkerSelection>,
) -> Result<LaunchResult> {
    let launch_started = std::time::Instant::now();
    let trace_startup = runtime_debug_enabled();
    if trace_startup {
        tracing::info!(app_id = %app.app_id, phase = "launch.requested", "startup_timing");
    }
    #[cfg(not(feature = "ferrous-framework-native"))]
    {
        let _ = (
            store,
            app,
            project_root,
            framework_url,
            framework_port,
            framework_shells_env,
            initialization,
            native,
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
        // is both the app server and the framework RPC pipe endpoint.
        for shell in &app.shells {
            let (shellspec_path, shellspec_entry) = shellspec_launch_target(app, shell)?;
            let entry_name = shellspec_entry.unwrap_or_else(|| "app-worker".to_owned());
            let document = initialization.shellspecs.get(&shellspec_path).context(
                "shellspec is not part of the selected catalog generation; refresh apps",
            )?;

            let mut launch_env_overrides = HashMap::new();
            let mut parent: HashMap<String, String> = std::env::vars().collect();
            let mut native_defaults = HashMap::new();
            apply_native_launch_environment(&mut parent, &mut native_defaults, native)?;
            parent.extend(native_defaults.clone());
            merge_shell_env_overrides(&mut launch_env_overrides, shell);
            apply_framework_launch_env(
                &mut launch_env_overrides,
                &app.app_id,
                framework_url,
                framework_port,
                framework_shells_env
                    .get("TE2_RUNTIME_DEBUG")
                    .is_some_and(|value| value == "1"),
            );
            let render_env =
                shellspec_render_environment(parent, framework_shells_env, &launch_env_overrides);

            let input = ShellspecRenderInput {
                ctx: ctx.clone(),
                env: render_env,
            };
            let mut rendered_shell = render_shellspec_entry(document, &entry_name, &input)?;
            merge_native_spawn_defaults(
                &native_defaults,
                &rendered_shell.env,
                &mut launch_env_overrides,
            );
            if let Some(native) = native {
                for key in &native.remove_environment {
                    anyhow::ensure!(
                        std::env::var_os(key).is_none()
                            || launch_env_overrides.contains_key(key)
                            || rendered_shell.env.contains_key(key),
                        "native environment removal requires renewed bootstrap preparation"
                    );
                }
            }
            anyhow::ensure!(
                !app.pipe_readiness()
                    || !is_app_worker_shell(shell)
                    || rendered_shell.backend == "pipe",
                "pipe readiness requires a pipe app-worker shell"
            );
            let label = shell
                .label
                .clone()
                .unwrap_or_else(|| default_shell_label(app, shell, &entry_name));
            let parent_shell_id = if is_app_worker_shell(shell) {
                None
            } else {
                primary_shell_id.clone()
            };

            // Explicit worker readiness owns the gate (HTTP callback or pipe-only
            // mode). A shell probe must never substitute for that fact.
            if should_bypass_shellspec_readiness(app, shell) {
                rendered_shell.readiness = None;
            }
            // Timestamp spawn separately from manifest rendering and later
            // worker-owned readiness. These records never release the gate.
            let spawn_started = std::time::Instant::now();
            if trace_startup {
                tracing::info!(app_id = %app.app_id, entry = %entry_name, phase = "spawn.begin", elapsed_ms = launch_started.elapsed().as_secs_f64() * 1000.0, "startup_timing");
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

            if trace_startup {
                tracing::info!(app_id = %app.app_id, shell_id = %record.id, phase = "spawn.end", elapsed_ms = spawn_started.elapsed().as_secs_f64() * 1000.0, "startup_timing");
            }

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
fn merge_native_spawn_defaults(
    defaults: &HashMap<String, String>,
    declared: &HashMap<String, String>,
    overrides: &mut HashMap<String, String>,
) {
    for (key, value) in defaults {
        if !declared.contains_key(key) {
            overrides
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
    }
}

#[cfg(feature = "ferrous-framework-native")]
fn apply_native_launch_environment(
    parent: &mut HashMap<String, String>,
    overrides: &mut HashMap<String, String>,
    native: Option<&crate::native_selection::WorkerSelection>,
) -> Result<()> {
    if let Some(native) = native {
        anyhow::ensure!(
            native.status == crate::native_selection::SelectionStatus::Ready,
            "native worker requires build/preparation"
        );
        for key in &native.remove_environment {
            parent.remove(key);
        }
        overrides.extend(native.environment.clone());
        overrides.insert(
            native.environment_key.clone(),
            native
                .executable
                .clone()
                .context("missing native executable")?,
        );
    }
    Ok(())
}

#[cfg(feature = "ferrous-framework-native")]
fn shellspec_render_environment(
    mut parent: HashMap<String, String>,
    framework: &HashMap<String, String>,
    overrides: &HashMap<String, String>,
) -> HashMap<String, String> {
    // Ferrous supplies an overlay, not the complete inherited environment.
    // Bootstrap-selected executable paths must also be available to templates.
    parent.extend(framework.clone());
    parent.extend(overrides.clone());
    parent
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
    runtime_debug: bool,
) {
    target.insert("TE_APP_ID".to_owned(), app_id.to_owned());
    target.insert("TE_FRAMEWORK_URL".to_owned(), framework_url.to_owned());
    target.insert("TE_PORT".to_owned(), framework_port.to_string());
    // Override both manifest values and inherited environment, even when disabled.
    target.insert(
        "TE2_RUNTIME_DEBUG".to_owned(),
        if runtime_debug { "1" } else { "0" }.to_owned(),
    );
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

    #[test]
    fn refreshed_native_selection_replaces_inherited_command_without_process_env_mutation() {
        use crate::native_selection::{SelectionStatus, WorkerSelection};
        let mut parent = HashMap::from([
            ("ALPHA_BIN".into(), "/old/alpha".into()),
            ("OLD_CONTEXT".into(), "stale".into()),
        ]);
        let mut overrides = HashMap::new();
        let mut selected = WorkerSelection {
            app_id: "alpha".into(),
            environment_key: "ALPHA_BIN".into(),
            declaration: "a".repeat(64),
            status: SelectionStatus::Ready,
            executable: Some("/new/alpha".into()),
            fingerprint: Some("b".repeat(24)),
            environment: HashMap::from([("RUNTIME_HOME".into(), "/new/runtime".into())]),
            remove_environment: vec!["OLD_CONTEXT".into()],
        };
        apply_native_launch_environment(&mut parent, &mut overrides, Some(&selected)).unwrap();
        assert!(!parent.contains_key("OLD_CONTEXT"));
        let document = serde_json::json!({"shells":{"app-worker":{"backend":"pipe","command":["${env:ALPHA_BIN}"],"env":{"RUNTIME_HOME":"${env:RUNTIME_HOME}"}}}});
        let rendered = render_shellspec_entry(
            &document,
            "app-worker",
            &ShellspecRenderInput {
                ctx: HashMap::new(),
                env: shellspec_render_environment(parent.clone(), &HashMap::new(), &overrides),
            },
        )
        .unwrap();
        assert_eq!(rendered.command[0], "/new/alpha");
        assert_eq!(rendered.env["RUNTIME_HOME"], "/new/runtime");
        assert_eq!(parent["ALPHA_BIN"], "/old/alpha");
        let declared = HashMap::from([("RUNTIME_HOME".into(), "/explicit/user/runtime".into())]);
        let mut spawn = HashMap::new();
        merge_native_spawn_defaults(&overrides, &declared, &mut spawn);
        assert!(!spawn.contains_key("RUNTIME_HOME"));
        assert_eq!(spawn["ALPHA_BIN"], "/new/alpha");
        selected.status = SelectionStatus::BuildRequired;
        assert!(
            apply_native_launch_environment(&mut parent, &mut overrides, Some(&selected)).is_err()
        );
    }

    #[test]
    fn native_worker_shellspec_receives_bootstrap_environment() {
        let document = serde_json::json!({"version":"1", "shells":{"app-worker":{
            "backend":"pipe", "cwd":"${ctx:PROJECT_ROOT}",
            "command":["${env:SAMPLE_EDITOR_WORKER_BIN}", "${ctx:PROJECT_ROOT}", "${free_port}"],
            "env":{"PYTHONPATH":"${env:PYTHONPATH}:${ctx:PROJECT_ROOT}", "TE_APP_ID":"${ctx:APP_ID}"}
        }}});
        let worker = "/cache/te2/sample_editor/build/bin/fingerprint/release/sample-editor-worker";
        let parent = HashMap::from([
            ("SAMPLE_EDITOR_WORKER_BIN".to_owned(), worker.to_owned()),
            ("PYTHONPATH".to_owned(), "/parent/python".to_owned()),
            ("TE_FRAMEWORK_URL".to_owned(), "parent".to_owned()),
        ]);
        let framework = HashMap::from([
            ("TE_FRAMEWORK_URL".to_owned(), "framework".to_owned()),
            ("TE_PORT".to_owned(), "8089".to_owned()),
        ]);
        let overrides = HashMap::from([("TE_PORT".to_owned(), "8081".to_owned())]);
        let env = shellspec_render_environment(parent, &framework, &overrides);
        assert_eq!(env["TE_FRAMEWORK_URL"], "framework");
        assert_eq!(env["TE_PORT"], "8081");
        let rendered = render_shellspec_entry(
            &document,
            "app-worker",
            &ShellspecRenderInput {
                ctx: HashMap::from([
                    ("PROJECT_ROOT".to_owned(), "/checkout".to_owned()),
                    ("APP_ID".to_owned(), "sample_editor".to_owned()),
                ]),
                env,
            },
        )
        .unwrap();
        assert_eq!(rendered.command[0], worker);
        assert_eq!(rendered.command[1], "/checkout");
        assert_eq!(rendered.backend, "pipe");
        assert_eq!(rendered.env["PYTHONPATH"], "/parent/python:/checkout");
    }

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
        apply_framework_launch_env(
            &mut overrides,
            "example",
            "http://127.0.0.1:8081",
            8081,
            false,
        );

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

    #[test]
    fn runtime_debug_overrides_manifest_in_both_directions() {
        for enabled in [false, true] {
            let mut overrides = HashMap::new();
            overrides.insert(
                "TE2_RUNTIME_DEBUG".to_owned(),
                if enabled { "0" } else { "1" }.to_owned(),
            );
            apply_framework_launch_env(
                &mut overrides,
                "example",
                "http://127.0.0.1:8081",
                8081,
                enabled,
            );
            assert_eq!(
                overrides.get("TE2_RUNTIME_DEBUG").map(String::as_str),
                Some(if enabled { "1" } else { "0" })
            );
        }
    }
}
