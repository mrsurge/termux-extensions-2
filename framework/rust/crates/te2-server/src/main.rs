mod android_assets;
mod app_proxy;
mod app_worker_pipe_bridge;
mod apps_lifecycle;
mod framework_services;
mod frontend_assets;
mod launcher;
mod network_exposure;
mod proxy_shell;
mod proxy_transport;
mod registry;
mod runtime;
mod runtime_bridge;
mod sio_proxy;
mod te2_paths;

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{StatusCode, header},
    middleware,
    response::{IntoResponse, Response},
    routing::get,
};
#[cfg(feature = "ferrous-framework-native")]
use ferrous_framework::{FerrousNativeHost, FerrousNativeHostConfig, FerrousNativeManager};
use launcher::LaunchStore;
use network_exposure::{NetworkConnectionInfo, NetworkExposurePolicy};
use registry::{AppRegistry, AppRoot};
use serde::Serialize;
use serde_json::{Map as JsonMap, Value, json};
use sio_proxy::SioRouteIndex;
use socket2::{Domain, Protocol, Socket, Type};
use socketioxide::SocketIo;
use std::{
    collections::HashMap,
    env,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::Arc,
};
use tokio::{
    sync::{Notify, RwLock, broadcast},
    task::JoinSet,
    time::{Duration, timeout},
};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::{EnvFilter, fmt};

const APP_ID: &str = "te2";
const APPS_EVENT_CHANNEL_CAPACITY: usize = 64;

// Shared server state: config is immutable per process, while the reqwest
// client owns reusable connection state for dynamic app proxying.
#[derive(Clone)]
pub(crate) struct AppState {
    config: Arc<ServerConfig>,
    instance_id: Arc<str>,
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

    pub(crate) fn instance_id(&self) -> &str {
        &self.instance_id
    }

    pub(crate) fn app_roots(&self) -> &[AppRoot] {
        &self.config.app_roots
    }

    pub(crate) fn framework_url(&self) -> String {
        self.config.framework_url()
    }

    pub(crate) fn framework_port(&self) -> u16 {
        self.config.port
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
    bind_hosts: Vec<IpAddr>,
    internal_host: IpAddr,
    network_policy: NetworkExposurePolicy,
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
    #[serde(rename = "instanceId")]
    instance_id: String,
    host: String,
    #[serde(rename = "bindHosts")]
    bind_hosts: Vec<String>,
    #[serde(rename = "frameworkUrl")]
    framework_url: String,
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

    // Process bootstrap owns environment-derived configuration and this server's
    // server lifetime. The shared Python framework process is not managed here.
    let config = Arc::new(ServerConfig::from_env()?);
    let public_framework_url = config.framework_url();
    let bind_addrs = config.socket_addrs();
    let listeners = bind_tcp_listeners(&bind_addrs)?;
    let fws_bridge_runtime = start_fws_bridge(&config, &public_framework_url)?;
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
        instance_id: Arc::from(new_instance_id()?),
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
    let shutdown_notify = Arc::new(Notify::new());
    let mut servers = JoinSet::new();

    info!(bind_addresses = ?bind_addrs, internal_framework_url = %public_framework_url, "starting TE2 framework server");
    for listener in listeners {
        let server_shutdown = shutdown_notify.clone();
        let listener_app = app.clone();
        servers.spawn(async move {
            axum::serve(
                listener,
                listener_app.into_make_service_with_connect_info::<NetworkConnectionInfo>(),
            )
            .with_graceful_shutdown(async move {
                server_shutdown.notified().await;
            })
            .await
        });
    }

    wait_for_shutdown_signal().await;
    info!("TE2 framework server shutdown signal received");
    shutdown_fws_tree(&fws_bridge_runtime).await;
    shutdown_notify.notify_waiters();
    match timeout(Duration::from_secs(10), async {
        while let Some(result) = servers.join_next().await {
            match result {
                Ok(Ok(())) => {}
                Ok(Err(error)) => warn!(%error, "HTTP server failed during shutdown"),
                Err(error) => warn!(%error, "HTTP server task failed during shutdown"),
            }
        }
    })
    .await
    {
        Ok(()) => {}
        Err(_) => {
            servers.abort_all();
            warn!("HTTP server graceful shutdown timed out");
        }
    }
    close_fws_bridge(fws_bridge_runtime).await;
    Ok(())
}

fn build_router(state: AppState) -> Router {
    let (socket_layer, io) = SocketIo::builder().with_state(state.clone()).build_layer();
    register_socket_namespaces(&io);
    let network_policy = state.config.network_policy.clone();

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
        .layer(middleware::from_fn_with_state(
            network_policy,
            network_exposure::enforce_network_exposure,
        ))
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
        instance_id: state.instance_id().to_owned(),
        host: state.config.host.clone(),
        bind_hosts: state
            .config
            .bind_hosts
            .iter()
            .map(ToString::to_string)
            .collect(),
        framework_url: state.config.framework_url(),
        port: state.config.port,
        project_root: state.config.project_root.clone(),
    })
}

fn new_instance_id() -> Result<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).context("failed to generate framework instance id")?;
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(value, "{byte:02x}");
    }
    Ok(value)
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
        // Environment names mirror the Python bootstrap contract so the server
        // can run side-by-side with the existing framework during development.
        let host = env::var("TE2_SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_owned());
        let bind_hosts = bind_hosts_from_env(&host)?;
        let internal_host = internal_host_from_env(&bind_hosts)?;
        let network_policy = NetworkExposurePolicy::from_env()?;
        let port = env::var("TE2_SERVER_PORT")
            .unwrap_or_else(|_| env::var("TE_PORT").unwrap_or_else(|_| "8089".to_owned()))
            .parse::<u16>()
            .context("TE2_SERVER_PORT must be a valid u16 port")?;
        let project_root = env::var("TE2_SERVER_PROJECT_ROOT").unwrap_or_else(|_| {
            env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .display()
                .to_string()
        });
        let app_roots = app_roots_from_env(&project_root);
        Ok(Self {
            host,
            bind_hosts,
            internal_host,
            network_policy,
            port,
            project_root,
            app_roots,
        })
    }

    fn socket_addrs(&self) -> Vec<SocketAddr> {
        self.bind_hosts
            .iter()
            .copied()
            .map(|host| SocketAddr::new(host, self.port))
            .collect()
    }

    fn framework_url(&self) -> String {
        format_http_url(self.internal_host, self.port)
    }
}

fn bind_hosts_from_env(fallback_host: &str) -> Result<Vec<IpAddr>> {
    let raw_hosts = match env::var("TE2_SERVER_BIND_HOSTS") {
        Ok(raw) => serde_json::from_str::<Vec<String>>(&raw)
            .context("TE2_SERVER_BIND_HOSTS must be a JSON string array")?,
        Err(env::VarError::NotPresent) => vec![fallback_host.to_owned()],
        Err(error) => return Err(error).context("failed to read TE2_SERVER_BIND_HOSTS"),
    };
    if raw_hosts.is_empty() {
        anyhow::bail!("TE2_SERVER_BIND_HOSTS must contain at least one address");
    }
    let mut hosts = Vec::with_capacity(raw_hosts.len());
    for raw in raw_hosts {
        let host = raw
            .parse::<IpAddr>()
            .with_context(|| format!("invalid bind address in TE2_SERVER_BIND_HOSTS: {raw}"))?;
        if !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    Ok(hosts)
}

fn internal_host_from_env(bind_hosts: &[IpAddr]) -> Result<IpAddr> {
    if let Ok(raw) = env::var("TE2_SERVER_INTERNAL_HOST") {
        return raw
            .parse::<IpAddr>()
            .context("TE2_SERVER_INTERNAL_HOST must be an exact IP address");
    }
    if bind_hosts.iter().any(
        |host| matches!(host, IpAddr::V4(value) if value.is_unspecified() || value.is_loopback()),
    ) {
        return Ok(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
    }
    if bind_hosts.iter().any(
        |host| matches!(host, IpAddr::V6(value) if value.is_unspecified() || value.is_loopback()),
    ) {
        return Ok(IpAddr::V6(std::net::Ipv6Addr::LOCALHOST));
    }
    Ok(bind_hosts[0])
}

fn format_http_url(host: IpAddr, port: u16) -> String {
    match host {
        IpAddr::V4(host) => format!("http://{host}:{port}"),
        IpAddr::V6(host) => format!("http://[{host}]:{port}"),
    }
}

fn bind_tcp_listeners(addrs: &[SocketAddr]) -> Result<Vec<tokio::net::TcpListener>> {
    addrs.iter().copied().map(bind_tcp_listener).collect()
}

fn bind_tcp_listener(addr: SocketAddr) -> Result<tokio::net::TcpListener> {
    let socket = Socket::new(Domain::for_address(addr), Type::STREAM, Some(Protocol::TCP))
        .with_context(|| format!("failed to create listener socket for {addr}"))?;
    socket
        .set_reuse_address(true)
        .with_context(|| format!("failed to configure listener socket for {addr}"))?;
    if addr.is_ipv6() {
        socket
            .set_only_v6(true)
            .with_context(|| format!("failed to isolate IPv6 listener {addr}"))?;
    }
    socket
        .bind(&addr.into())
        .with_context(|| format!("failed to bind {addr}"))?;
    socket
        .listen(1024)
        .with_context(|| format!("failed to listen on {addr}"))?;
    socket
        .set_nonblocking(true)
        .with_context(|| format!("failed to make listener nonblocking for {addr}"))?;
    let listener: std::net::TcpListener = socket.into();
    tokio::net::TcpListener::from_std(listener)
        .with_context(|| format!("failed to register listener with Tokio for {addr}"))
}

fn app_roots_from_env(project_root: &str) -> Vec<AppRoot> {
    // App-root order is part of registry semantics: builtin apps first, then
    // user-local wrappers, then any explicit extra roots.
    let raw_paths = env::var_os("TE2_SERVER_APP_ROOTS")
        .map(|raw| env::split_paths(&raw).collect::<Vec<_>>())
        .unwrap_or_else(|| {
            vec![
                PathBuf::from(project_root).join("app").join("apps"),
                te2_paths::data_home().join("apps"),
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

fn load_te2_runtime_bridge_config() -> Te2RuntimeBridgeConfig {
    let upstream_base_url = env::var("TE2_RUNTIME_BRIDGE_URL").unwrap_or_default();
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
                // The native host is bound to loopback and published through this server.
                // Public callers hit the framework facade, not the internal host directly.
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
    // The server handles its own process shutdown only; it must not restart or
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
