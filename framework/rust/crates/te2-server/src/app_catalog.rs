//! Replaceable declaration generation; never owns or stops a running process.
use crate::{
    native_selection::SelectionSnapshot,
    registry::{AppRegistry, AppRoot},
    sio_proxy::SioRouteIndex,
};
use anyhow::{Context, Result, ensure};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct AppInitialization {
    pub shellspecs: HashMap<PathBuf, Value>,
    pub native: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct AppCatalog {
    pub generation: u64,
    pub registry: AppRegistry,
    pub routes: SioRouteIndex,
    pub initialization: HashMap<String, AppInitialization>,
    pub native: Option<SelectionSnapshot>,
    pub declaration_digest: String,
}

// Bound configuration reads, not application source/assets. No scripts run.
fn read(path: &Path) -> Result<Vec<u8>> {
    use std::io::Read;
    ensure!(
        fs::metadata(path)?.is_file(),
        "app declaration is not a regular file: {}",
        path.display()
    );
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= 1024 * 1024,
        "app declaration exceeds limit: {}",
        path.display()
    );
    Ok(bytes)
}

fn optional_exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn referenced(app: &Path, relative: &str) -> Result<PathBuf> {
    let relative = Path::new(relative);
    ensure!(
        !relative.is_absolute()
            && !relative
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir)),
        "app declaration path escapes owner"
    );
    let path = app.join(relative).canonicalize()?;
    ensure!(
        path.starts_with(app.canonicalize()?),
        "app declaration symlink escapes owner"
    );
    Ok(path)
}

fn inventory(roots: &[AppRoot]) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    let mut files = BTreeMap::new();
    for root in roots {
        if !optional_exists(&root.path)? {
            continue;
        }
        for entry in fs::read_dir(&root.path)? {
            let app = entry?.path();
            if !fs::metadata(&app)?.is_dir()
                || app
                    .file_name()
                    .is_some_and(|v| v.to_string_lossy().starts_with('_'))
            {
                continue;
            }
            let manifest = app.join("manifest.json");
            if !optional_exists(&manifest)? {
                continue;
            }
            let bytes = read(&manifest)?;
            let value: Value = serde_json::from_slice(&bytes).context("invalid app manifest")?;
            files.insert(manifest.canonicalize()?, bytes);
            let mut refs = Vec::new();
            if let Some(path) = value.get("sio_service").and_then(Value::as_str) {
                refs.push(path.to_owned());
            }
            if let Some(path) = value
                .get("shellspec")
                .and_then(|v| v.get("app_worker").or_else(|| v.get("worker")))
                .and_then(Value::as_str)
            {
                refs.push(path.split('#').next().unwrap_or_default().to_owned());
            } else if optional_exists(&app.join("shellspec/app_worker.yaml"))? {
                refs.push("shellspec/app_worker.yaml".into());
            }
            if optional_exists(&app.join("native_build.json"))? {
                refs.push("native_build.json".into());
                let native: Value = serde_json::from_slice(&read(&app.join("native_build.json"))?)?;
                if let Some(provider) = native.get("runtimeProvider").and_then(Value::as_str) {
                    refs.push(provider.into());
                }
            }
            for relative in refs {
                let path = referenced(&app, &relative)?;
                files.insert(path.clone(), read(&path)?);
            }
            ensure!(
                files.len() <= 4096
                    && files.values().map(Vec::len).sum::<usize>() <= 16 * 1024 * 1024,
                "app catalog declaration budget exceeded"
            );
        }
    }
    Ok(files)
}

fn digest(files: &BTreeMap<PathBuf, Vec<u8>>) -> String {
    let mut hash = Sha256::new();
    for (path, bytes) in files {
        hash.update(path.to_string_lossy().as_bytes());
        hash.update([0]);
        hash.update((bytes.len() as u64).to_be_bytes());
        hash.update(bytes);
    }
    format!("{:x}", hash.finalize())
}

fn native_declaration(app: &crate::registry::AppDefinition) -> Result<Option<String>> {
    let path = app.root_dir.join("native_build.json");
    if !optional_exists(&path)? {
        return Ok(None);
    }
    let mut inputs = vec![path.clone(), app.manifest_path.clone()];
    let declaration: Value = serde_json::from_slice(&read(&path)?)?;
    if let Some(provider) = declaration.get("runtimeProvider").and_then(Value::as_str) {
        inputs.push(referenced(&app.root_dir, provider)?);
    }
    let mut hash = Sha256::new();
    for path in inputs {
        hash.update(path.canonicalize()?.to_string_lossy().as_bytes());
        hash.update([0]);
        hash.update(read(&path)?);
        hash.update([0]);
    }
    Ok(Some(format!("{:x}", hash.finalize())))
}

impl AppCatalog {
    pub fn bootstrap(roots: &[AppRoot]) -> Self {
        match Self::load(roots, 0) {
            Ok(catalog) => catalog,
            Err(error) => {
                // Preserve startup's existing broken-app catalog behavior;
                // refresh, unlike startup, must never publish a partial candidate.
                tracing::warn!(%error, "initial catalog contains invalid declarations");
                let registry = AppRegistry::load(roots);
                // Never install a lenient index in the global dispatcher: a
                // malformed app must not shadow a protected framework URL.
                let routes = SioRouteIndex::try_from_registry(&registry).unwrap_or_else(|error| {
                    tracing::warn!(%error, "invalid startup socket declarations; app socket routes withheld");
                    SioRouteIndex::default()
                });
                let mut initialization = HashMap::new();
                for app in registry.apps() {
                    let captured: Result<AppInitialization> = (|| {
                        let mut init = AppInitialization {
                            native: native_declaration(app)?,
                            ..Default::default()
                        };
                        for shell in &app.shells {
                            let reference = shell
                                .ref_path
                                .as_deref()
                                .context("inline shellspec unsupported")?;
                            let relative = reference.split('#').next().unwrap_or_default();
                            let path = referenced(&app.root_dir, relative)?;
                            init.shellspecs.insert(
                                app.root_dir.join(relative),
                                serde_yaml::from_slice(&read(&path)?)?,
                            );
                        }
                        Ok(init)
                    })();
                    if let Ok(init) = captured {
                        initialization.insert(app.app_id.clone(), init);
                    }
                }
                Self {
                    generation: 0,
                    registry,
                    routes,
                    initialization,
                    native: None,
                    declaration_digest: String::new(),
                }
            }
        }
    }

    pub fn load(roots: &[AppRoot], generation: u64) -> Result<Self> {
        let files = inventory(roots)?;
        let mut registry = AppRegistry::load(roots);
        let mut initialization = HashMap::new();
        for app in registry.apps_mut() {
            ensure!(
                app.registry_errors
                    .iter()
                    .all(|error| error.starts_with("duplicate app_id")),
                "invalid app declaration {}: {:?}",
                app.app_id,
                app.registry_errors
            );
            let original: Value = serde_json::from_slice(
                files
                    .get(&app.manifest_path)
                    .context("app manifest changed during scan")?,
            )?;
            ensure!(
                original.as_object() == Some(&app.raw_manifest),
                "app manifest changed during scan"
            );
            crate::app_intent_pipe::validate_manifest_exports(&app.raw_manifest)?;
            crate::app_policy::AppPolicy::read(app)?;
            if let Some(path) = app.raw_manifest.get("sio_service").and_then(Value::as_str) {
                let path = referenced(&app.root_dir, path)?;
                let config: Value = serde_json::from_slice(
                    files
                        .get(&path)
                        .context("missing socket declaration snapshot")?,
                )?;
                ensure!(config.is_object(), "socket declaration must be an object");
                app.raw_manifest.insert("sio_service".into(), config);
            }
            let mut init = AppInitialization {
                native: native_declaration(app)?,
                ..Default::default()
            };
            for shell in &app.shells {
                let reference = shell
                    .ref_path
                    .as_deref()
                    .context("inline shellspec is not supported by app launcher")?;
                let path = app
                    .root_dir
                    .join(reference.split('#').next().unwrap_or_default());
                let resolved = referenced(
                    &app.root_dir,
                    reference.split('#').next().unwrap_or_default(),
                )?;
                let document: Value = serde_yaml::from_slice(
                    files.get(&resolved).context("missing shellspec snapshot")?,
                )?;
                ensure!(document.is_object(), "shellspec must be an object");
                init.shellspecs.insert(path, document);
            }
            initialization.insert(app.app_id.clone(), init);
        }
        let routes = SioRouteIndex::try_from_registry(&registry)?;
        ensure!(
            inventory(roots)? == files,
            "app declarations changed during scan; retry refresh"
        );
        Ok(Self {
            generation,
            registry,
            routes,
            initialization,
            native: None,
            declaration_digest: digest(&files),
        })
    }

    pub fn unchanged(&self, roots: &[AppRoot]) -> Result<()> {
        ensure!(
            digest(&inventory(roots)?) == self.declaration_digest,
            "app declarations changed; retry refresh"
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AppState, FwsBridgeConfig, ServerConfig, Te2RuntimeBridgeConfig, launcher::LaunchStore,
    };
    use axum::{
        Json, Router,
        extract::ws::{Message, WebSocketUpgrade},
        response::IntoResponse,
        routing::{any, post},
    };
    use serde_json::json;
    use std::sync::{Arc, RwLock};
    use tokio::sync::{Mutex, RwLock as AsyncRwLock, broadcast};

    fn roots(root: &Path) -> Vec<AppRoot> {
        vec![AppRoot {
            source_kind: "test".into(),
            path: root.into(),
        }]
    }

    fn temporary() -> tempfile::TempDir {
        let root = std::env::var_os("TMPDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../../../.codex-scratch/catalog-tests")
            });
        fs::create_dir_all(&root).unwrap();
        tempfile::Builder::new()
            .prefix("catalog-")
            .tempdir_in(root)
            .unwrap()
    }

    fn declare(root: &Path, id: &str, port: u16, alias: &str, script: &str) {
        let app = root.join(id);
        fs::create_dir_all(&app).unwrap();
        fs::write(app.join("manifest.json"), serde_json::to_vec(&json!({
            "id":id,"name":id,"entrypoints":{"frontend_script":script},
            "ipc":{"services":{"sample":{"version":1,"callers":["peer"],"methods":["read"]}}},
            "sio_service":{"routes":[{"id":"stream","target":"static","port":port,
                "public_path":format!("/api/app/{id}/socket.io"),"upstream_path":"/engine", "aliases":[alias]}]}
        })).unwrap()).unwrap();
    }

    fn state(root: &Path, owner: &str) -> AppState {
        let app_roots = roots(root);
        AppState {
            config: Arc::new(ServerConfig {
                host: "127.0.0.1".into(),
                bind_hosts: vec!["127.0.0.1".parse().unwrap()],
                internal_host: "127.0.0.1".parse().unwrap(),
                network_policy: crate::network_exposure::NetworkExposurePolicy::from_env().unwrap(),
                port: 8089,
                project_root: root.display().to_string(),
                app_roots: app_roots.clone(),
            }),
            instance_id: Arc::from("isolated-catalog-test"),
            http_client: reqwest::Client::builder().no_proxy().build().unwrap(),
            catalog: Arc::new(RwLock::new(Arc::new(
                AppCatalog::load(&app_roots, 0).unwrap(),
            ))),
            catalog_launch_gate: Arc::new(AsyncRwLock::new(())),
            catalog_reload_gate: Arc::new(Mutex::new(())),
            native_selector: Some(Arc::new(
                crate::native_selection::NativeSelectionClient::new(owner, "fixture-key").unwrap(),
            )),
            running_apps: Arc::new(RwLock::new(HashMap::new())),
            launch_store: Arc::new(LaunchStore::default()),
            service_scheduler: Default::default(),
            readiness_store: Arc::new(AsyncRwLock::new(HashMap::new())),
            apps_events: broadcast::channel(32).0,
            fws_bridge: Arc::new(FwsBridgeConfig {
                upstream_base_url: String::new(),
                child_env: HashMap::new(),
            }),
            te2_runtime_bridge: Arc::new(Te2RuntimeBridgeConfig {
                upstream_base_url: owner.into(),
            }),
        }
    }

    async fn serve(app: Router) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, task)
    }

    async fn owner() -> (String, tokio::task::JoinHandle<()>) {
        serve(Router::new().route("/internal/native-runtime/select",post(|| async {
            Json(json!({"schema_version":1,"profile":"release","packaged":false,"generation":"a".repeat(64),"workers":[]}))
        }))).await
    }

    async fn upstream(label: &'static str) -> (u16, tokio::task::JoinHandle<()>) {
        let app = Router::new().fallback(any(
            move |ws: Result<
                WebSocketUpgrade,
                axum::extract::ws::rejection::WebSocketUpgradeRejection,
            >| async move {
                if let Ok(ws) = ws {
                    return ws
                        .on_upgrade(move |mut socket| async move {
                            while let Some(Ok(message)) = socket.recv().await {
                                if matches!(message, Message::Text(_)) {
                                    let _ = socket.send(Message::Text(label.into())).await;
                                }
                            }
                        })
                        .into_response();
                }
                label.into_response()
            },
        ));
        let (base, task) = serve(app).await;
        (url::Url::parse(&base).unwrap().port().unwrap(), task)
    }

    #[test]
    fn shipped_app_declarations_fit_the_generic_snapshot_contract() {
        let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..");
        let catalog = AppCatalog::load(&roots(&project.join("app/apps")), 0).unwrap();
        assert!(!catalog.registry.apps().is_empty());
    }

    #[test]
    fn captures_referenced_initialization_and_rejects_changed_generation() {
        let temp = temporary();
        declare(temp.path(), "alpha", 1234, "/alpha_ws/socket.io", "old.js");
        let app = temp.path().join("alpha");
        fs::create_dir(app.join("shellspec")).unwrap();
        fs::write(
            app.join("shellspec/app_worker.yaml"),
            "shells:\n  app-worker:\n    command: [old]\n",
        )
        .unwrap();
        let old = AppCatalog::load(&roots(temp.path()), 0).unwrap();
        fs::write(
            app.join("shellspec/app_worker.yaml"),
            "shells:\n  app-worker:\n    command: [new]\n",
        )
        .unwrap();
        assert!(old.unchanged(&roots(temp.path())).is_err());
        assert_eq!(
            old.initialization["alpha"].shellspecs[&app.join("shellspec/app_worker.yaml")]["shells"]
                ["app-worker"]["command"][0],
            "old"
        );
        let new = AppCatalog::load(&roots(temp.path()), 1).unwrap();
        assert_ne!(old.declaration_digest, new.declaration_digest);
    }

    #[test]
    fn rejects_protected_colliding_encoded_and_foreign_socket_paths() {
        for path in [
            "/api/health",
            "/te2_console_ws/socket.io",
            "/fws_ws/socket.io",
            "/api/app/other/socket.io",
            "/api/app/alpha/proxy/socket.io",
            "/api/app/alpha/%2f/socket.io",
            "/api/app/alpha/../socket.io",
        ] {
            let temp = temporary();
            declare(temp.path(), "alpha", 1234, path, "main.js");
            assert!(AppCatalog::load(&roots(temp.path()), 1).is_err(), "{path}");
        }
        let temp = temporary();
        declare(
            temp.path(),
            "alpha",
            1234,
            "/shared_ws/socket.io",
            "main.js",
        );
        declare(temp.path(), "beta", 1234, "/shared_ws/socket.io", "main.js");
        assert!(AppCatalog::load(&roots(temp.path()), 1).is_err());
    }

    #[tokio::test]
    async fn real_reload_add_change_remove_and_rollback_preserve_open_socket_and_owner() {
        use futures_util::{SinkExt, StreamExt};
        let temp = temporary();
        let (one, one_task) = upstream("first").await;
        let (two, two_task) = upstream("second").await;
        let (owner, owner_task) = owner().await;
        declare(temp.path(), "alpha", one, "/alpha_ws/socket.io", "old.js");
        let state = state(temp.path(), &owner);
        state.running_apps.write().unwrap().insert(
            "alpha".into(),
            crate::runtime::RunningApp {
                app_id: "alpha".into(),
                port: one,
                shell_id: "exact-original-shell".into(),
                label: None,
                source: "test",
                created_at: 1.0,
                updated_at: 1.0,
                locked: false,
                uptime: 0.0,
                cpu: 0.0,
                ram: 0,
                readiness: Default::default(),
            },
        );
        let app = Router::new()
            .merge(crate::apps_lifecycle::router())
            .merge(crate::app_proxy::router())
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                crate::app_proxy::dynamic_sio_proxy,
            ))
            .with_state(state.clone());
        let (base, server) = serve(app).await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let get = |path: &str| client.get(format!("{base}{path}"));
        assert_eq!(
            get("/alpha_ws/socket.io/")
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "first"
        );
        let (mut socket, _) = tokio_tungstenite::connect_async(format!(
            "{}/alpha_ws/socket.io",
            base.replacen("http", "ws", 1)
        ))
        .await
        .unwrap();
        let old = state.catalog_snapshot();
        declare(temp.path(), "beta", one, "/beta_ws/socket.io", "beta.js");
        assert!(
            client
                .post(format!("{base}/api/apps/reload"))
                .send()
                .await
                .unwrap()
                .status()
                .is_success()
        );
        assert_eq!(
            get("/beta_ws/socket.io")
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "first"
        );
        assert!(old.registry.get_app("beta").is_none());
        declare(temp.path(), "alpha", two, "/renamed_ws/socket.io", "new.js");
        let manifest = temp.path().join("alpha/manifest.json");
        let mut updated: Value = serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
        updated["ipc"]["services"]["sample"]["methods"] = json!(["write"]);
        fs::write(&manifest, serde_json::to_vec(&updated).unwrap()).unwrap();
        let response = client
            .post(format!("{base}/api/apps/reload"))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let response: Value = response.json().await.unwrap();
        assert_eq!(response["data"]["restart_required"], json!(["alpha"]));
        assert_eq!(
            get("/renamed_ws/socket.io")
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "second"
        );
        assert_eq!(
            get("/alpha_ws/socket.io").send().await.unwrap().status(),
            404
        );
        assert_eq!(
            state
                .catalog_snapshot()
                .registry
                .get_app("alpha")
                .unwrap()
                .entrypoints["frontend_script"],
            "new.js"
        );
        assert_eq!(
            state
                .catalog_snapshot()
                .registry
                .get_app("alpha")
                .unwrap()
                .raw_manifest["ipc"]["services"]["sample"]["methods"],
            json!(["write"])
        );
        assert_eq!(
            old.registry.get_app("alpha").unwrap().raw_manifest["ipc"]["services"]["sample"]["methods"],
            json!(["read"])
        );
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                "still alive".into(),
            ))
            .await
            .unwrap();
        assert_eq!(
            socket.next().await.unwrap().unwrap().into_text().unwrap(),
            "first"
        );
        let accepted = state.catalog_snapshot();
        declare(temp.path(), "beta", one, "/api/health", "bad.js");
        assert_eq!(
            client
                .post(format!("{base}/api/apps/reload"))
                .send()
                .await
                .unwrap()
                .status(),
            409
        );
        assert!(Arc::ptr_eq(&accepted, &state.catalog_snapshot()));
        declare(temp.path(), "beta", one, "/beta_ws/socket.io", "beta.js");
        fs::remove_dir_all(temp.path().join("alpha")).unwrap();
        assert!(
            client
                .post(format!("{base}/api/apps/reload"))
                .send()
                .await
                .unwrap()
                .status()
                .is_success()
        );
        assert_eq!(
            get("/renamed_ws/socket.io").send().await.unwrap().status(),
            404
        );
        assert_eq!(
            state.running_app_exact("alpha").unwrap().shell_id,
            "exact-original-shell"
        );
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                "removed but alive".into(),
            ))
            .await
            .unwrap();
        assert_eq!(
            socket.next().await.unwrap().unwrap().into_text().unwrap(),
            "first"
        );
        socket.close(None).await.unwrap();
        server.abort();
        owner_task.abort();
        one_task.abort();
        two_task.abort();
    }

    #[tokio::test]
    async fn cancelled_spawn_keeps_generation_admission_and_overlapping_reload_is_rejected() {
        let temp = temporary();
        declare(temp.path(), "alpha", 1234, "/alpha_ws/socket.io", "old.js");
        let (owner, owner_task) = owner().await;
        let state = state(temp.path(), &owner);
        let held = state.catalog_launch_gate.clone().read_owned().await;
        let (release, receiver) = std::sync::mpsc::channel();
        let (started, ready) = tokio::sync::oneshot::channel();
        let task = tokio::task::spawn_blocking(move || {
            let _owned = held;
            started.send(()).unwrap();
            receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
        });
        ready.await.unwrap();
        task.abort();
        assert!(state.catalog_launch_gate.try_write().is_err());
        let state_for_refresh = state.clone();
        let refresh = tokio::spawn(async move {
            crate::apps_lifecycle::reload_apps_data(&state_for_refresh).await
        });
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while state.catalog_reload_gate.try_lock().is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(state.catalog_snapshot().generation, 0);
        assert!(
            crate::apps_lifecycle::reload_apps_data(&state)
                .await
                .unwrap_err()
                .contains("already in progress")
        );
        release.send(()).unwrap();
        let _ = task.await;
        assert!(refresh.await.unwrap().is_ok());
        assert_eq!(state.catalog_snapshot().generation, 1);
        assert!(state.catalog_launch_gate.try_write().is_ok());
        owner_task.abort();
    }

    #[test]
    fn malformed_intent_policy_rejects_the_candidate() {
        for invalid in [
            json!({"version":0,"callers":["peer"],"methods":["read"]}),
            json!({"version":1,"callers":["peer"],"methods":[false]}),
            json!({"version":1,"callers":["peer"],"methods":["read"],"limits":{"write":{"timeoutMs":1000}}}),
        ] {
            let temp = temporary();
            declare(temp.path(), "alpha", 1234, "/alpha_ws/socket.io", "main.js");
            let path = temp.path().join("alpha/manifest.json");
            let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            manifest["ipc"]["services"]["sample"] = invalid;
            fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
            assert!(AppCatalog::load(&roots(temp.path()), 1).is_err());
        }
    }

    #[test]
    fn startup_error_catalog_cannot_override_framework_routes() {
        let temp = temporary();
        declare(temp.path(), "alpha", 1234, "/api/health", "main.js");
        let catalog = AppCatalog::bootstrap(&roots(temp.path()));
        assert!(catalog.registry.get_app("alpha").is_some());
        assert!(catalog.routes.match_path("/api/health").is_none());
    }

    #[test]
    fn second_root_entrypoints_routes_and_intents_share_one_generation() {
        let temp = temporary();
        let first = temp.path().join("builtin");
        let second = temp.path().join("user");
        declare(&first, "alpha", 1234, "/alpha_ws/socket.io", "alpha.js");
        declare(&second, "beta", 2345, "/beta_ws/socket.io", "old.js");
        let mut all = roots(&first);
        all.extend(roots(&second));
        let old = AppCatalog::load(&all, 0).unwrap();
        declare(&second, "beta", 3456, "/replacement_ws/socket.io", "new.js");
        let new = AppCatalog::load(&all, 1).unwrap();
        assert_eq!(
            new.registry.get_app("beta").unwrap().entrypoints["frontend_script"],
            "new.js"
        );
        assert_eq!(
            new.routes
                .match_path("/replacement_ws/socket.io")
                .unwrap()
                .route
                .port,
            Some(3456)
        );
        assert!(new.routes.match_path("/beta_ws/socket.io").is_none());
        assert!(old.routes.match_path("/beta_ws/socket.io").is_some());
        assert_eq!(
            new.registry.get_app("beta").unwrap().raw_manifest["ipc"]["services"]["sample"]["version"],
            1
        );
    }
}
