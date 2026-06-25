mod android_assets;
mod app_proxy;
mod app_worker_pipe_bridge;
mod apps_lifecycle;
mod framework_services;
mod frontend_assets;
mod launcher;
mod proxy_shell;
mod proxy_transport;
mod registry;
mod runtime;
mod runtime_bridge;
mod sio_proxy;

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
#[cfg(feature = "ferrous-framework-native")]
use ferrous_framework::{FerrousNativeHost, FerrousNativeHostConfig, FerrousNativeManager};
use launcher::LaunchStore;
use registry::{AppRegistry, AppRoot};
use serde::Serialize;
use serde_json::{Map as JsonMap, Value, json};
use sio_proxy::SioRouteIndex;
use socketioxide::SocketIo;
use std::{collections::HashMap, env, net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::{
    sync::{Notify, RwLock, broadcast},
    time::{Duration, timeout},
};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::{EnvFilter, fmt};

const APP_ID: &str = "te2-rust-spike";
const APPS_EVENT_CHANNEL_CAPACITY: usize = 64;

// Shared server state: config is immutable per process, while the reqwest
// client owns reusable connection state for dynamic app proxying.
#[derive(Clone)]
pub(crate) struct AppState {
    config: Arc<ServerConfig>,
    http_client: reqwest::Client,
    sio_routes: Arc<SioRouteIndex>,
    launch_store: Arc<LaunchStore>,
    #[cfg_attr(not(feature = "ferrous-framework-native"), allow(dead_code))]
    service_scheduler: framework_services::scheduler::FrameworkServiceScheduler,
    readiness_store: Arc<RwLock<HashMap<String, JsonMap<String, Value>>>>,
    apps_events: broadcast::Sender<apps_lifecycle::AppsEvent>,
    fws_bridge: Arc<FwsBridgeConfig>,
    te2_runtime_bridge: Arc<Te2RuntimeBridgeConfig>,
}

impl AppState {
    pub(crate) fn project_root(&self) -> &str {
        &self.config.project_root
    }

    pub(crate) fn app_roots(&self) -> &[AppRoot] {
        &self.config.app_roots
    }

    pub(crate) fn framework_url(&self) -> String {
        self.config.framework_url()
    }

    pub(crate) fn http_client(&self) -> &reqwest::Client {
        &self.http_client
    }

    pub(crate) fn sio_routes(&self) -> &SioRouteIndex {
        &self.sio_routes
    }

    pub(crate) fn launch_store(&self) -> &Arc<LaunchStore> {
        &self.launch_store
    }

    #[cfg_attr(not(feature = "ferrous-framework-native"), allow(dead_code))]
    pub(crate) fn service_scheduler(
        &self,
    ) -> &framework_services::scheduler::FrameworkServiceScheduler {
        &self.service_scheduler
    }

    pub(crate) fn readiness_store(&self) -> &Arc<RwLock<HashMap<String, JsonMap<String, Value>>>> {
        &self.readiness_store
    }

    pub(crate) fn apps_events(&self) -> &broadcast::Sender<apps_lifecycle::AppsEvent> {
        &self.apps_events
    }

    pub(crate) fn fws_child_env(&self) -> &HashMap<String, String> {
        &self.fws_bridge.child_env
    }

    pub(crate) fn fws_upstream_base_url(&self) -> &str {
        &self.fws_bridge.upstream_base_url
    }

    pub(crate) fn te2_runtime_upstream_base_url(&self) -> &str {
        &self.te2_runtime_bridge.upstream_base_url
    }
}

#[derive(Clone)]
struct FwsBridgeConfig {
    upstream_base_url: String,
    child_env: HashMap<String, String>,
}

#[derive(Clone)]
struct Te2RuntimeBridgeConfig {
    upstream_base_url: String,
}

#[derive(Debug)]
struct ServerConfig {
    host: String,
    port: u16,
    project_root: String,
    app_roots: Vec<AppRoot>,
}

struct FwsBridgeRuntime {
    config: FwsBridgeConfig,
    #[cfg(feature = "ferrous-framework-native")]
    host: Option<FerrousNativeHost>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    app: &'static str,
    version: &'static str,
    host: String,
    port: u16,
    project_root: String,
}

#[derive(Serialize)]
pub(crate) struct ApiResponse<T: Serialize> {
    pub(crate) ok: bool,
    pub(crate) data: T,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    // Process bootstrap owns environment-derived configuration and this spike's
    // server lifetime. The shared Python framework process is not managed here.
    let config = Arc::new(ServerConfig::from_env()?);
    let public_framework_url = config.framework_url();
    let fws_bridge_runtime = start_fws_bridge(&config, &public_framework_url)?;
    let addr = config.socket_addr()?;
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .context("failed to build HTTP proxy client")?;
    let bootstrap_registry = AppRegistry::load(&config.app_roots);
    let sio_routes = Arc::new(SioRouteIndex::from_registry(&bootstrap_registry));
    let sio_mounts = sio_routes.mount_paths();
    let (apps_events, _) = broadcast::channel(APPS_EVENT_CHANNEL_CAPACITY);
    info!(
        route_count = sio_routes.route_count(),
        mount_count = sio_mounts.len(),
        mounts = ?sio_mounts,
        "loaded manifest Socket.IO proxy routes"
    );
    let fws_bridge_config = fws_bridge_runtime.config.clone();
    #[cfg(feature = "ferrous-framework-native")]
    let launch_store = Arc::new(LaunchStore::new(
        fws_bridge_runtime
            .host
            .as_ref()
            .map(FerrousNativeHost::manager),
    ));
    #[cfg(not(feature = "ferrous-framework-native"))]
    let launch_store = Arc::new(LaunchStore::default());
    let state = AppState {
        config,
        http_client,
        sio_routes,
        launch_store,
        service_scheduler: framework_services::scheduler::FrameworkServiceScheduler::default(),
        readiness_store: Arc::new(RwLock::new(HashMap::new())),
        apps_events,
        fws_bridge: Arc::new(fws_bridge_config.clone()),
        te2_runtime_bridge: Arc::new(load_te2_runtime_bridge_config()),
    };
    #[cfg(feature = "ferrous-framework-native")]
    apps_lifecycle::start_fws_lifecycle_app_bridge(
        state.clone(),
        fws_bridge_runtime
            .host
            .as_ref()
            .map(FerrousNativeHost::manager),
    );
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;
    let shutdown_notify = Arc::new(Notify::new());
    let server_shutdown = shutdown_notify.clone();

    info!(%addr, "starting TE2 Rust framework spike");
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                server_shutdown.notified().await;
            })
            .await
    });

    wait_for_shutdown_signal().await;
    info!("TE2 Rust framework spike shutdown signal received");
    shutdown_fws_tree(&fws_bridge_runtime).await;
    shutdown_notify.notify_waiters();
    match timeout(Duration::from_secs(10), server).await {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(error))) => return Err(error.into()),
        Ok(Err(error)) => warn!(%error, "server task failed during shutdown"),
        Err(_) => warn!("HTTP server graceful shutdown timed out"),
    }
    close_fws_bridge(fws_bridge_runtime).await;
    Ok(())
}

fn build_router(state: AppState) -> Router {
    let (socket_layer, io) = SocketIo::builder().with_state(state.clone()).build_layer();
    register_socket_namespaces(&io);

    let router = Router::new()
        // Host/frontend compatibility surface.
        .merge(frontend_assets::router())
        .merge(android_assets::router())
        .route("/api/health", get(health))
        .merge(framework_services::router())
        .merge(runtime_bridge::router())
        .merge(apps_lifecycle::router())
        .merge(app_proxy::router());

    app_proxy::register_sio_proxy_routes(router, state.sio_routes())
        .with_state(state)
        .layer(socket_layer)
        .layer(TraceLayer::new_for_http())
}

fn register_socket_namespaces(io: &SocketIo) {
    // Socket.IO is present now so route shape is stable while raw app aliases
    // and service proxying are implemented in later phases.
    io.ns(
        "/",
        |_socket: socketioxide::extract::SocketRef| async move {},
    );
    io.ns(
        "/apps",
        |_socket: socketioxide::extract::SocketRef| async move {},
    );
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        app: APP_ID,
        version: env!("CARGO_PKG_VERSION"),
        host: state.config.host.clone(),
        port: state.config.port,
        project_root: state.config.project_root.clone(),
    })
}

pub(crate) fn json_error(status: StatusCode, error: &str) -> Response {
    let body = Body::from(json!({ "ok": false, "error": error }).to_string());
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}
impl ServerConfig {
    fn from_env() -> Result<Self> {
        // Environment names mirror the Python bootstrap contract so this spike
        // can run side-by-side with the existing framework during development.
        let host = env::var("TE2_RUST_SPIKE_HOST").unwrap_or_else(|_| "127.0.0.1".to_owned());
        let port = env::var("TE2_RUST_SPIKE_PORT")
            .unwrap_or_else(|_| env::var("TE_PORT").unwrap_or_else(|_| "8089".to_owned()))
            .parse::<u16>()
            .context("TE2_RUST_SPIKE_PORT must be a valid u16 port")?;
        let project_root = env::var("TE2_RUST_SPIKE_PROJECT_ROOT").unwrap_or_else(|_| {
            env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .display()
                .to_string()
        });
        let app_roots = app_roots_from_env(&project_root);
        Ok(Self {
            host,
            port,
            project_root,
            app_roots,
        })
    }

    fn socket_addr(&self) -> Result<SocketAddr> {
        format!("{}:{}", self.host, self.port)
            .parse()
            .context("failed to parse socket address")
    }

    fn framework_url(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }
}

fn app_roots_from_env(project_root: &str) -> Vec<AppRoot> {
    // App-root order is part of registry semantics: builtin apps first, then
    // user-local wrappers, then any explicit extra roots.
    let raw_paths = env::var_os("TE2_RUST_SPIKE_APP_ROOTS")
        .map(|raw| env::split_paths(&raw).collect::<Vec<_>>())
        .unwrap_or_else(|| {
            vec![
                PathBuf::from(project_root).join("app").join("apps"),
                xdg_data_home().join("te2").join("apps"),
            ]
        });
    raw_paths
        .into_iter()
        .enumerate()
        .map(|(index, path)| AppRoot {
            source_kind: match index {
                0 => "builtin".to_owned(),
                1 => "user_local".to_owned(),
                other => format!("extra_{other}"),
            },
            path,
        })
        .collect()
}

fn xdg_data_home() -> PathBuf {
    env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".local")
                .join("share")
        })
}

fn load_te2_runtime_bridge_config() -> Te2RuntimeBridgeConfig {
    let upstream_base_url = env::var("TE2_RUST_SPIKE_RUNTIME_BRIDGE_URL").unwrap_or_default();
    Te2RuntimeBridgeConfig { upstream_base_url }
}

fn start_fws_bridge(config: &ServerConfig, public_framework_url: &str) -> Result<FwsBridgeRuntime> {
    #[cfg(not(feature = "ferrous-framework-native"))]
    {
        let _ = (config, public_framework_url);
        return Ok(FwsBridgeRuntime {
            config: FwsBridgeConfig {
                upstream_base_url: String::new(),
                child_env: HashMap::new(),
            },
        });
    }

    #[cfg(feature = "ferrous-framework-native")]
    {
        let _ = config;
        let mut host_env = env::vars().collect::<HashMap<_, _>>();
        host_env.insert(
            "TE_FRAMEWORK_URL".to_owned(),
            public_framework_url.to_owned(),
        );
        host_env.insert(
            "FRAMEWORK_SHELLS_FWS_SOCKETIO_URL".to_owned(),
            public_framework_url.to_owned(),
        );
        let manager = FerrousNativeManager::try_with_env_map(&host_env)
            .context("failed to initialize Ferrous native manager")?;
        let host = FerrousNativeHost::spawn_with_manager(
            FerrousNativeHostConfig {
                host: "127.0.0.1".to_owned(),
                port: 0,
                // The native host is bound to loopback and published through this spike.
                // Public callers hit the spike facade, not the internal host directly.
                require_auth: false,
            },
            manager,
        )
        .context("failed to start Ferrous native FWS bridge host")?;
        let upstream_base_url = host.url();
        let mut child_env = host.child_env_overlay();
        child_env.insert(
            "FRAMEWORK_SHELLS_FWS_SOCKETIO_URL".to_owned(),
            public_framework_url.to_owned(),
        );
        child_env.insert(
            "TE_FRAMEWORK_URL".to_owned(),
            public_framework_url.to_owned(),
        );
        info!(
            public_framework_url,
            upstream_base_url, "started Ferrous native FWS bridge host"
        );
        Ok(FwsBridgeRuntime {
            config: FwsBridgeConfig {
                upstream_base_url,
                child_env,
            },
            host: Some(host),
        })
    }
}

async fn close_fws_bridge(runtime: FwsBridgeRuntime) {
    let _ = &runtime;
    #[cfg(feature = "ferrous-framework-native")]
    if let Some(host) = runtime.host {
        match tokio::task::spawn_blocking(move || host.close_blocking()).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => warn!(%error, "failed to close Ferrous FWS bridge host"),
            Err(error) => warn!(%error, "Ferrous FWS bridge host shutdown task failed"),
        }
    }
}

async fn shutdown_fws_tree(runtime: &FwsBridgeRuntime) {
    let _ = runtime;

    // Framework shutdown delegates process ownership to FWS. App-specific quit
    // still uses the app-group endpoint; full framework teardown enters the
    // native Ferrous tree hook before Axum closes the public facade.
    #[cfg(feature = "ferrous-framework-native")]
    if let Some(host) = runtime.host.as_ref() {
        let manager = host.manager();
        match tokio::task::spawn_blocking(move || manager.shutdown_tree_blocking(Vec::new())).await
        {
            Ok(Ok(result)) => info!(
                ok = result.ok,
                kind = %result.kind,
                target = %result.target,
                elapsed_ms = result.elapsed_ms,
                root_pids = ?result.root_pids,
                total = result.stats.total,
                terminated = result.stats.terminated,
                clean_exits = result.stats.clean_exits,
                force_killed = result.stats.force_killed,
                errors = ?result.stats.errors,
                "Ferrous native FWS shutdown tree completed"
            ),
            Ok(Err(error)) => warn!(%error, "failed to run Ferrous native FWS shutdown tree"),
            Err(error) => warn!(%error, "Ferrous native FWS shutdown tree task failed"),
        }
    } else {
        warn!("Ferrous native FWS bridge host is unavailable; skipping FWS shutdown tree");
    }
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt().with_env_filter(filter).init();
}

async fn wait_for_shutdown_signal() {
    // The spike handles its own process shutdown only; it must not restart or
    // manage the shared Python framework server.
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            warn!(%error, "failed to install Ctrl-C handler");
        }
    };

    #[cfg(unix)]
    {
        let terminate = async {
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(mut signal) => {
                    signal.recv().await;
                }
                Err(error) => warn!(%error, "failed to install SIGTERM handler"),
            }
        };
        tokio::select! {
            _ = ctrl_c => {}
            _ = terminate => {}
        }
    }

    #[cfg(not(unix))]
    {
        ctrl_c.await;
    }
}
