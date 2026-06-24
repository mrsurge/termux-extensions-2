use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug)]
pub struct AppRoot {
    pub source_kind: String,
    pub path: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
pub struct AppShell {
    #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
    pub ref_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inline_spec: Option<Value>,
    pub label: Option<String>,
    pub subgroup: String,
    pub wait_ready: bool,
    pub env: Map<String, Value>,
    pub ui: Map<String, Value>,
}

#[derive(Clone, Debug)]
pub struct AppDefinition {
    pub app_id: String,
    pub name: String,
    pub description: String,
    pub dir_name: String,
    pub root_dir: PathBuf,
    pub manifest_path: PathBuf,
    pub source_kind: String,
    pub source_root: PathBuf,
    pub asset_base_url: String,
    pub entrypoints: Map<String, Value>,
    pub shells: Vec<AppShell>,
    pub services_path: String,
    pub service_modules: Vec<String>,
    pub proxy_shell: Option<Map<String, Value>>,
    pub framework_shell_ui: Option<Map<String, Value>>,
    pub icon_src_raw: String,
    pub icon_text: String,
    pub icon_emoji: String,
    pub fullscreen: bool,
    pub readiness_support: bool,
    pub enabled: bool,
    pub raw_manifest: Map<String, Value>,
    pub registry_errors: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct AppRegistry {
    apps: Vec<AppDefinition>,
    apps_by_id: HashMap<String, usize>,
    apps_by_dir: HashMap<String, usize>,
}

impl AppRegistry {
    pub fn load(roots: &[AppRoot]) -> Self {
        let mut apps_by_id: HashMap<String, usize> = HashMap::new();
        let mut apps_by_dir: HashMap<String, usize> = HashMap::new();
        let mut apps: Vec<AppDefinition> = Vec::new();

        for root in roots {
            if !root.path.exists() {
                continue;
            }
            let mut dirs = match fs::read_dir(&root.path) {
                Ok(entries) => entries
                    .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                    .collect::<Vec<_>>(),
                Err(_) => continue,
            };
            dirs.sort_by_key(|path| path.file_name().map(|name| name.to_os_string()));

            for app_dir in dirs {
                if !app_dir.is_dir() {
                    continue;
                }
                let dir_name = file_name_string(&app_dir);
                if dir_name.starts_with('_') {
                    continue;
                }
                let manifest_path = app_dir.join("manifest.json");
                if !manifest_path.exists() {
                    continue;
                }

                let app_def = match load_app_definition(
                    &root.source_kind,
                    &root.path,
                    &app_dir,
                    &manifest_path,
                ) {
                    Ok(app_def) => app_def,
                    Err(error) => broken_app_definition(
                        &root.source_kind,
                        &root.path,
                        &app_dir,
                        &manifest_path,
                        error,
                    ),
                };
                if let Some(existing_index) = apps_by_id.get(&app_def.app_id).copied() {
                    let existing = &mut apps[existing_index];
                    existing.registry_errors.push(format!(
                        "duplicate app_id '{}' ignored from {} (already loaded from {})",
                        app_def.app_id,
                        app_def.manifest_path.display(),
                        existing.manifest_path.display()
                    ));
                    continue;
                }

                let index = apps.len();
                apps_by_id.insert(app_def.app_id.clone(), index);
                apps_by_dir.entry(app_def.dir_name.clone()).or_insert(index);
                apps.push(app_def);
            }
        }

        apps.sort_by_key(|app| (app.name.to_lowercase(), app.app_id.to_lowercase()));
        apps_by_id.clear();
        for (index, app) in apps.iter().enumerate() {
            apps_by_id.insert(app.app_id.clone(), index);
        }
        apps_by_dir.clear();
        for (index, app) in apps.iter().enumerate() {
            apps_by_dir.entry(app.dir_name.clone()).or_insert(index);
        }
        Self {
            apps,
            apps_by_id,
            apps_by_dir,
        }
    }

    pub fn list_payloads(&self) -> Vec<Value> {
        self.apps.iter().map(AppDefinition::to_payload).collect()
    }

    pub fn catalog_payloads_with_running(&self, running_ids: &HashSet<String>) -> Vec<Value> {
        self.apps
            .iter()
            .map(|app| app.to_catalog_payload(running_ids.contains(&app.app_id)))
            .collect()
    }

    pub fn contains_app(&self, app_id: &str) -> bool {
        self.apps_by_id.contains_key(app_id)
    }

    pub fn augment_running_payload(&self, app_id: &str, payload: &mut Map<String, Value>) {
        let Some(app) = self.get_app(app_id) else {
            return;
        };
        payload.insert("name".to_owned(), Value::String(app.name.clone()));
        payload.insert(
            "icon_emoji".to_owned(),
            Value::String(app.icon_emoji.clone()),
        );
        payload.insert("icon_text".to_owned(), Value::String(app.icon_text.clone()));
        payload.insert("icon_src".to_owned(), Value::String(app.icon_src()));
        payload.insert("_dir".to_owned(), Value::String(app.dir_name.clone()));
        payload.insert(
            "asset_base_url".to_owned(),
            Value::String(app.asset_base_url.clone()),
        );
        payload.insert(
            "source_kind".to_owned(),
            Value::String(app.source_kind.clone()),
        );
    }

    pub fn get_app(&self, app_id: &str) -> Option<&AppDefinition> {
        let index = self.apps_by_id.get(app_id)?;
        self.apps.get(*index)
    }

    pub fn apps(&self) -> &[AppDefinition] {
        &self.apps
    }

    pub fn resolve_asset_path(&self, app_id: &str, filename: &str) -> Option<PathBuf> {
        let index = self.apps_by_id.get(app_id)?;
        let app = self.apps.get(*index)?;
        let candidate = app.root_dir.join(filename).canonicalize().ok()?;
        let root = app.root_dir.canonicalize().ok()?;
        if !candidate.starts_with(root) {
            return None;
        }
        Some(candidate)
    }

    pub fn resolve_asset_path_by_dir(&self, dir_name: &str, filename: &str) -> Option<PathBuf> {
        let app = self
            .apps_by_dir
            .get(dir_name)
            .and_then(|index| self.apps.get(*index))?;
        let candidate = app.root_dir.join(filename).canonicalize().ok()?;
        let root = app.root_dir.canonicalize().ok()?;
        if !candidate.starts_with(root) {
            return None;
        }
        Some(candidate)
    }
}

impl AppDefinition {
    pub fn backend_module(&self) -> Option<&str> {
        self.entrypoints
            .get("backend_blueprint")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    fn sidebar_state(&self) -> Value {
        self.raw_manifest
            .get("sidebar_state")
            .and_then(Value::as_object)
            .cloned()
            .map(Value::Object)
            .unwrap_or(Value::Null)
    }

    fn icon_src(&self) -> String {
        let raw = self.icon_src_raw.trim();
        if raw.is_empty() {
            return String::new();
        }
        if raw.starts_with("http://") || raw.starts_with("https://") || raw.starts_with('/') {
            return raw.to_owned();
        }
        format!(
            "{}/{}",
            self.asset_base_url.trim_end_matches('/'),
            raw.trim_start_matches('/')
        )
    }

    fn to_payload(&self) -> Value {
        let mut payload = Map::new();
        payload.insert("id".to_owned(), Value::String(self.app_id.clone()));
        payload.insert("name".to_owned(), Value::String(self.name.clone()));
        payload.insert(
            "description".to_owned(),
            Value::String(self.description.clone()),
        );
        payload.insert(
            "entrypoints".to_owned(),
            Value::Object(self.entrypoints.clone()),
        );
        payload.insert("fullscreen".to_owned(), Value::Bool(self.fullscreen));
        payload.insert("icon_src".to_owned(), Value::String(self.icon_src()));
        payload.insert(
            "icon_src_raw".to_owned(),
            Value::String(self.icon_src_raw.clone()),
        );
        payload.insert(
            "icon_text".to_owned(),
            Value::String(self.icon_text.clone()),
        );
        payload.insert(
            "icon_emoji".to_owned(),
            Value::String(self.icon_emoji.clone()),
        );
        payload.insert(
            "source_kind".to_owned(),
            Value::String(self.source_kind.clone()),
        );
        payload.insert(
            "source_root".to_owned(),
            Value::String(self.source_root.display().to_string()),
        );
        payload.insert(
            "root_dir".to_owned(),
            Value::String(self.root_dir.display().to_string()),
        );
        payload.insert(
            "manifest_path".to_owned(),
            Value::String(self.manifest_path.display().to_string()),
        );
        payload.insert(
            "asset_base_url".to_owned(),
            Value::String(self.asset_base_url.clone()),
        );
        payload.insert(
            "proxy_shell".to_owned(),
            self.proxy_shell
                .clone()
                .map(Value::Object)
                .unwrap_or(Value::Null),
        );
        payload.insert(
            "framework_shell_ui".to_owned(),
            self.framework_shell_ui
                .clone()
                .map(Value::Object)
                .unwrap_or(Value::Null),
        );
        payload.insert(
            "shells".to_owned(),
            serde_json::to_value(&self.shells).unwrap_or_else(|_| Value::Array(Vec::new())),
        );
        payload.insert(
            "services_path".to_owned(),
            Value::String(self.services_path.clone()),
        );
        payload.insert(
            "service_modules".to_owned(),
            Value::Array(
                self.service_modules
                    .iter()
                    .cloned()
                    .map(Value::String)
                    .collect(),
            ),
        );
        payload.insert("sidebar_state".to_owned(), self.sidebar_state());
        payload.insert(
            "readiness_support".to_owned(),
            Value::Bool(self.readiness_support),
        );
        payload.insert("enabled".to_owned(), Value::Bool(self.enabled));
        payload.insert("_dir".to_owned(), Value::String(self.dir_name.clone()));
        if !self.registry_errors.is_empty() {
            payload.insert(
                "__service_errors__".to_owned(),
                Value::Array(
                    self.registry_errors
                        .iter()
                        .cloned()
                        .map(Value::String)
                        .collect(),
                ),
            );
        }
        Value::Object(payload)
    }

    fn to_catalog_payload(&self, running: bool) -> Value {
        let mut payload = Map::new();
        payload.insert("id".to_owned(), Value::String(self.app_id.clone()));
        payload.insert("name".to_owned(), Value::String(self.name.clone()));
        payload.insert(
            "description".to_owned(),
            Value::String(self.description.clone()),
        );
        payload.insert("_dir".to_owned(), Value::String(self.dir_name.clone()));
        payload.insert("icon_src".to_owned(), Value::String(self.icon_src()));
        payload.insert(
            "icon_src_raw".to_owned(),
            Value::String(self.icon_src_raw.clone()),
        );
        payload.insert(
            "icon_text".to_owned(),
            Value::String(self.icon_text.clone()),
        );
        payload.insert(
            "icon_emoji".to_owned(),
            Value::String(self.icon_emoji.clone()),
        );
        payload.insert("fullscreen".to_owned(), Value::Bool(self.fullscreen));
        payload.insert(
            "backend_required".to_owned(),
            Value::Bool(self.backend_module().is_some()),
        );
        payload.insert("running".to_owned(), Value::Bool(running));
        payload.insert(
            "readiness".to_owned(),
            if running && self.backend_module().is_some() && self.readiness_support {
                let mut readiness = Map::new();
                readiness.insert("app_id".to_owned(), Value::String(self.app_id.clone()));
                readiness.insert("status".to_owned(), Value::String("starting".to_owned()));
                Value::Object(readiness)
            } else {
                Value::Object(Map::new())
            },
        );
        payload.insert(
            "launch_url".to_owned(),
            Value::String(format!("/app/{}", self.app_id)),
        );
        payload.insert(
            "embed_url".to_owned(),
            Value::String(format!("/app/{}?embed=1", self.app_id)),
        );
        payload.insert(
            "asset_base_url".to_owned(),
            Value::String(self.asset_base_url.clone()),
        );
        payload.insert(
            "source_kind".to_owned(),
            Value::String(self.source_kind.clone()),
        );
        payload.insert("sidebar_state".to_owned(), self.sidebar_state());
        payload.insert(
            "readiness_support".to_owned(),
            Value::Bool(self.readiness_support),
        );
        payload.insert("enabled".to_owned(), Value::Bool(self.enabled));
        Value::Object(payload)
    }
}

fn load_app_definition(
    source_kind: &str,
    source_root: &Path,
    app_dir: &Path,
    manifest_path: &Path,
) -> Result<AppDefinition> {
    let manifest_text = fs::read_to_string(manifest_path)
        .with_context(|| format!("manifest load failed: {}", manifest_path.display()))?;
    let raw_value: Value = serde_json::from_str(&manifest_text)
        .with_context(|| format!("manifest parse failed: {}", manifest_path.display()))?;
    let manifest = raw_value
        .as_object()
        .cloned()
        .context("manifest root must be a JSON object")?;

    let dir_name = file_name_string(app_dir);
    let app_id = string_field(&manifest, "id")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| dir_name.clone());
    let entrypoints = object_field(&manifest, "entrypoints").unwrap_or_default();
    let (services_path, service_modules) = services_fields(&manifest);
    let proxy_shell = object_field(&manifest, "proxy_shell");
    let framework_shell_ui = object_field(&manifest, "framework_shell_ui");
    let root_dir = app_dir
        .canonicalize()
        .unwrap_or_else(|_| app_dir.to_path_buf());
    let source_root = source_root
        .canonicalize()
        .unwrap_or_else(|_| source_root.to_path_buf());

    Ok(AppDefinition {
        app_id: app_id.clone(),
        name: string_field(&manifest, "name").unwrap_or_else(|| app_id.clone()),
        description: string_field(&manifest, "description").unwrap_or_default(),
        dir_name,
        root_dir,
        manifest_path: manifest_path
            .canonicalize()
            .unwrap_or_else(|_| manifest_path.to_path_buf()),
        source_kind: source_kind.to_owned(),
        source_root,
        asset_base_url: format!("/apps/by-id/{app_id}"),
        entrypoints,
        shells: resolve_shells(&manifest, app_dir),
        services_path,
        service_modules,
        proxy_shell,
        framework_shell_ui,
        icon_src_raw: string_field(&manifest, "icon_src").unwrap_or_default(),
        icon_text: string_field(&manifest, "icon_text").unwrap_or_default(),
        icon_emoji: string_field(&manifest, "icon_emoji").unwrap_or_default(),
        fullscreen: bool_field(&manifest, "fullscreen"),
        readiness_support: manifest
            .get("readiness_support")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        enabled: manifest
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        raw_manifest: manifest,
        registry_errors: Vec::new(),
    })
}

fn broken_app_definition(
    source_kind: &str,
    source_root: &Path,
    app_dir: &Path,
    manifest_path: &Path,
    error: anyhow::Error,
) -> AppDefinition {
    let dir_name = file_name_string(app_dir);
    let root_dir = app_dir
        .canonicalize()
        .unwrap_or_else(|_| app_dir.to_path_buf());
    let source_root = source_root
        .canonicalize()
        .unwrap_or_else(|_| source_root.to_path_buf());
    AppDefinition {
        app_id: dir_name.clone(),
        name: dir_name.clone(),
        description: String::new(),
        dir_name: dir_name.clone(),
        root_dir,
        manifest_path: manifest_path
            .canonicalize()
            .unwrap_or_else(|_| manifest_path.to_path_buf()),
        source_kind: source_kind.to_owned(),
        source_root,
        asset_base_url: format!("/apps/by-id/{dir_name}"),
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
        readiness_support: false,
        enabled: true,
        raw_manifest: Map::new(),
        registry_errors: vec![format!("manifest load failed: {error:#}")],
    }
}

fn resolve_shells(manifest: &Map<String, Value>, app_root: &Path) -> Vec<AppShell> {
    let mut shells = Vec::new();
    if let Some(shellspec_cfg) = manifest.get("shellspec").and_then(Value::as_object) {
        let app_worker = shellspec_cfg
            .get("app_worker")
            .or_else(|| shellspec_cfg.get("worker"));
        push_manifest_shell(&mut shells, app_worker, "app-worker", true);
    }

    if shells.is_empty() && app_root.join("shellspec").join("app_worker.yaml").exists() {
        shells.push(AppShell {
            ref_path: Some("shellspec/app_worker.yaml#app-worker".to_owned()),
            inline_spec: None,
            label: None,
            subgroup: "app-worker".to_owned(),
            wait_ready: true,
            env: Map::new(),
            ui: Map::new(),
        });
    }

    shells
}

fn push_manifest_shell(
    shells: &mut Vec<AppShell>,
    shell_value: Option<&Value>,
    subgroup: &str,
    wait_ready: bool,
) {
    if let Some(ref_path) = shell_value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        shells.push(AppShell {
            ref_path: Some(ref_path.to_owned()),
            inline_spec: None,
            label: None,
            subgroup: subgroup.to_owned(),
            wait_ready,
            env: Map::new(),
            ui: Map::new(),
        });
    } else if let Some(inline_spec) = shell_value.and_then(Value::as_object) {
        shells.push(AppShell {
            ref_path: None,
            inline_spec: Some(Value::Object(inline_spec.clone())),
            label: None,
            subgroup: subgroup.to_owned(),
            wait_ready,
            env: Map::new(),
            ui: Map::new(),
        });
    }
}

fn services_fields(manifest: &Map<String, Value>) -> (String, Vec<String>) {
    let Some(services) = manifest.get("services").and_then(Value::as_object) else {
        return ("services".to_owned(), Vec::new());
    };
    let path = services
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("services")
        .to_owned();
    let modules = services
        .get("modules")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    (path, modules)
}

fn object_field(manifest: &Map<String, Value>, key: &str) -> Option<Map<String, Value>> {
    manifest.get(key).and_then(Value::as_object).cloned()
}

fn string_field(manifest: &Map<String, Value>, key: &str) -> Option<String> {
    manifest
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(str::to_owned)
}

fn bool_field(manifest: &Map<String, Value>, key: &str) -> bool {
    manifest.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn file_name_string(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned()
}
