mod registry;
mod runtime;

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::Path,
    extract::State,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::{HeaderMap, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::{any, get, post},
};
use registry::{AppRegistry, AppRoot};
use runtime::{FwsDiscovery, RunningApp};
use serde::Serialize;
use serde_json::{Value, json};
use socketioxide::SocketIo;
use std::{
    collections::HashSet,
    env, fs,
    net::SocketAddr,
    path::{Path as StdPath, PathBuf},
    sync::Arc,
};
use tokio::{
    sync::Notify,
    time::{Duration, timeout},
};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::{EnvFilter, fmt};

const APP_ID: &str = "te2-rust-spike";

// Shared server state: config is immutable per process, while the reqwest
// client owns reusable connection state for dynamic app proxying.
#[derive(Clone)]
struct AppState {
    config: Arc<ServerConfig>,
    http_client: reqwest::Client,
}

#[derive(Debug)]
struct ServerConfig {
    host: String,
    port: u16,
    project_root: String,
    app_roots: Vec<AppRoot>,
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
struct ApiResponse<T: Serialize> {
    ok: bool,
    data: T,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    // Process bootstrap owns environment-derived configuration and this spike's
    // server lifetime. The shared Python framework process is not managed here.
    let config = Arc::new(ServerConfig::from_env()?);
    let addr = config.socket_addr()?;
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .context("failed to build HTTP proxy client")?;
    let state = AppState {
        config,
        http_client,
    };
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
    shutdown_notify.notify_waiters();
    match timeout(Duration::from_secs(10), server).await {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(error))) => return Err(error.into()),
        Ok(Err(error)) => warn!(%error, "server task failed during shutdown"),
        Err(_) => warn!("HTTP server graceful shutdown timed out"),
    }
    Ok(())
}

fn build_router(state: AppState) -> Router {
    let (socket_layer, io) = SocketIo::builder().with_state(state.clone()).build_layer();
    register_socket_namespaces(&io);

    Router::new()
        // Host/frontend compatibility surface.
        .route("/", get(index))
        .route("/api/health", get(health))
        .route("/api/extensions", get(list_extensions))
        // Apps extension/app registry read model.
        .route("/api/apps", get(list_apps))
        .route("/api/apps/catalog", get(apps_catalog))
        .route("/api/apps/running", get(running_apps))
        .route("/api/apps/reload", post(reload_apps))
        // App launcher event bridge. This is snapshot-only until registry events move.
        .route("/ws/apps", get(apps_ws))
        // Dynamic app-worker proxy. These routes do not start apps.
        .route("/api/app/{app_id}", any(proxy_app_root_request))
        .route("/api/app/{app_id}/{*subpath}", any(proxy_app_request))
        // Static compatibility assets for the app launcher and manifest-backed apps.
        .route(
            "/extensions/{ext_dir}/{*filename}",
            get(serve_extension_file),
        )
        .route(
            "/apps/by-id/{app_id}/{*filename}",
            get(serve_app_file_by_id),
        )
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

async fn index() -> &'static str {
    "TE2 Rust framework spike"
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

async fn list_extensions(State(state): State<AppState>) -> Response {
    // Legacy generic extensions are intentionally not ported. This endpoint only
    // fakes the apps extension registration that the existing index page expects.
    match load_apps_extension_payload(&state.config.project_root) {
        Some(payload) => Json(ApiResponse {
            ok: true,
            data: vec![payload],
        })
        .into_response(),
        None => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Apps extension manifest could not be loaded.",
        ),
    }
}

async fn list_apps(State(state): State<AppState>) -> Json<ApiResponse<Vec<Value>>> {
    let registry = AppRegistry::load(&state.config.app_roots);
    Json(ApiResponse {
        ok: true,
        data: registry.list_payloads(),
    })
}

async fn apps_catalog(State(state): State<AppState>) -> Json<ApiResponse<Vec<Value>>> {
    let registry = AppRegistry::load(&state.config.app_roots);
    let running_ids = running_app_ids(&registry);
    Json(ApiResponse {
        ok: true,
        data: registry.catalog_payloads_with_running(&running_ids),
    })
}

async fn running_apps(State(state): State<AppState>) -> Json<ApiResponse<Vec<Value>>> {
    let registry = AppRegistry::load(&state.config.app_roots);
    Json(ApiResponse {
        ok: true,
        data: running_app_payloads(&registry),
    })
}

async fn reload_apps(
    State(state): State<AppState>,
) -> Json<ApiResponse<serde_json::Map<String, Value>>> {
    let registry = AppRegistry::load(&state.config.app_roots);
    let mut data = serde_json::Map::new();
    data.insert(
        "count".to_owned(),
        Value::from(registry.list_payloads().len()),
    );
    Json(ApiResponse { ok: true, data })
}

async fn apps_ws(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    // The current launcher frontend opens `/ws/apps` for catalog state. This
    // first Rust slice sends the initial snapshot and leaves live fanout for later.
    ws.on_upgrade(move |socket| handle_apps_ws(socket, state))
        .into_response()
}

async fn handle_apps_ws(mut socket: WebSocket, state: AppState) {
    let snapshot = apps_snapshot_payload(&state);
    let message = json!({
        "type": "apps_snapshot",
        "payload": snapshot,
    });
    if socket
        .send(Message::Text(message.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    while let Some(result) = socket.recv().await {
        match result {
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }
}

async fn proxy_app_root_request(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    proxy_app_request_inner(state, app_id, String::new(), method, uri, headers, body).await
}

async fn proxy_app_request(
    State(state): State<AppState>,
    Path((app_id, subpath)): Path<(String, String)>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    proxy_app_request_inner(state, app_id, subpath, method, uri, headers, body).await
}

async fn proxy_app_request_inner(
    state: AppState,
    app_id: String,
    subpath: String,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // Preserve the existing Code TE2 agent bridge CORS exception while keeping
    // general app proxy behavior same-origin.
    let cors_headers = file_editor_agent_cors_headers(&app_id, &subpath, &headers);
    if method == Method::OPTIONS && !cors_headers.is_empty() {
        return response_with_extra_headers(StatusCode::NO_CONTENT, Body::empty(), &cors_headers);
    }

    let registry = AppRegistry::load(&state.config.app_roots);
    let Some(running_app) = running_app_for_id(&registry, &app_id) else {
        return json_error_with_headers(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!("App '{app_id}' is not running. Start it from the launcher first."),
            &cors_headers,
        );
    };

    // The dynamic app proxy is intentionally non-launching. Startup remains an
    // explicit app lifecycle action; proxy requests only route to known workers.
    let mut upstream_url = format!(
        "http://127.0.0.1:{}/{}",
        running_app.port,
        subpath.trim_start_matches('/')
    );
    if let Some(query) = uri.query() {
        upstream_url.push('?');
        upstream_url.push_str(query);
    }

    // Transport hygiene: forward the request body and end-to-end headers, but
    // strip host/hop-by-hop headers so the worker sees a normal local request.
    let reqwest_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => {
            return json_error(StatusCode::METHOD_NOT_ALLOWED, "Unsupported HTTP method.");
        }
    };
    let mut request = state
        .http_client
        .request(reqwest_method, upstream_url.clone());
    for (name, value) in headers.iter() {
        if should_forward_request_header(name.as_str()) {
            request = request.header(name, value);
        }
    }

    let upstream = match request.body(body).send().await {
        Ok(response) => response,
        Err(error) => {
            warn!(%error, %app_id, %upstream_url, "failed to reach app worker");
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("App '{app_id}' worker is not reachable yet. Please retry shortly."),
            );
        }
    };

    // Response passthrough mirrors the Python proxy by removing headers that can
    // become invalid once the framework has consumed the upstream body.
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let upstream_headers = upstream.headers().clone();
    let upstream_body = match upstream.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            warn!(%error, %app_id, "failed to read app worker response body");
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("App '{app_id}' worker response could not be read."),
            );
        }
    };

    let mut builder = Response::builder().status(status);
    for (name, value) in upstream_headers.iter() {
        if should_forward_response_header(name.as_str()) {
            builder = builder.header(name, value);
        }
    }
    for (name, value) in cors_headers {
        builder = builder.header(name, value);
    }
    builder
        .body(Body::from(upstream_body))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn serve_extension_file(
    State(state): State<AppState>,
    Path((ext_dir, filename)): Path<(String, String)>,
) -> Result<Response, StatusCode> {
    // Only the app launcher extension is served here. Other legacy extension
    // directories are deliberately outside this spike's compatibility target.
    let Some(resolved) =
        resolve_apps_extension_asset(&state.config.project_root, &ext_dir, &filename)
    else {
        return Err(StatusCode::NOT_FOUND);
    };
    let body = fs::read(&resolved).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(file_response(&resolved, body))
}

async fn serve_app_file_by_id(
    State(state): State<AppState>,
    Path((app_id, filename)): Path<(String, String)>,
) -> Result<Response, StatusCode> {
    // Manifest-backed app assets resolve by app id so directory names can differ
    // from public ids without leaking filesystem layout to the frontend.
    let registry = AppRegistry::load(&state.config.app_roots);
    let Some(resolved) = registry.resolve_asset_path(&app_id, &filename) else {
        return Err(StatusCode::NOT_FOUND);
    };
    let body = fs::read(&resolved).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(file_response(&resolved, body))
}

fn apps_snapshot_payload(state: &AppState) -> Value {
    // Launcher snapshots combine the manifest registry with read-only FWS
    // discovery so running markers work before lifecycle mutation is ported.
    let registry = AppRegistry::load(&state.config.app_roots);
    let running_ids = running_app_ids(&registry);
    let mut sorted_running_ids = running_ids.iter().cloned().collect::<Vec<_>>();
    sorted_running_ids.sort();

    json!({
        "catalog": registry.catalog_payloads_with_running(&running_ids),
        "running_ids": sorted_running_ids,
    })
}

fn running_app_ids(registry: &AppRegistry) -> HashSet<String> {
    discover_running_apps(registry)
        .into_iter()
        .map(|app| app.app_id)
        .collect()
}

fn running_app_payloads(registry: &AppRegistry) -> Vec<Value> {
    discover_running_apps(registry)
        .into_iter()
        .filter_map(|app| {
            let app_id = app.app_id.clone();
            let mut payload = serde_json::to_value(app).ok()?.as_object().cloned()?;
            registry.augment_running_payload(&app_id, &mut payload);
            Some(Value::Object(payload))
        })
        .collect()
}

fn running_app_for_id(registry: &AppRegistry, app_id: &str) -> Option<RunningApp> {
    let app_id = app_id.trim();
    if !registry.contains_app(app_id) {
        return None;
    }
    discover_running_apps(registry)
        .into_iter()
        .find(|app| app.app_id == app_id)
}

fn discover_running_apps(registry: &AppRegistry) -> Vec<RunningApp> {
    // FWS remains the authority for already-running app workers in this slice;
    // the Rust server filters that read model to apps known by the registry.
    FwsDiscovery::from_env()
        .list_running_apps()
        .into_iter()
        .filter(|app| registry.contains_app(&app.app_id))
        .collect()
}

fn load_apps_extension_payload(project_root: &str) -> Option<Value> {
    // The frontend still loads an "extension" manifest. Keep that shape, but
    // pin it to app-launcher semantics instead of resurrecting generic extensions.
    let manifest_path = apps_extension_root(project_root).join("manifest.json");
    let text = fs::read_to_string(manifest_path).ok()?;
    let mut manifest = serde_json::from_str::<Value>(&text)
        .ok()?
        .as_object()
        .cloned()?;
    manifest.insert("_ext_dir".to_owned(), Value::String("apps".to_owned()));
    Some(Value::Object(manifest))
}

fn resolve_apps_extension_asset(
    project_root: &str,
    ext_dir: &str,
    filename: &str,
) -> Option<PathBuf> {
    if ext_dir != "apps" {
        return None;
    }
    let root = apps_extension_root(project_root).canonicalize().ok()?;
    let candidate = root.join(filename).canonicalize().ok()?;
    if !candidate.starts_with(&root) {
        return None;
    }
    Some(candidate)
}

fn apps_extension_root(project_root: &str) -> PathBuf {
    PathBuf::from(project_root)
        .join("app")
        .join("extensions")
        .join("apps")
}

fn should_forward_request_header(name: &str) -> bool {
    // Header filtering is shared by dynamic proxy routes so later websocket and
    // Socket.IO alias work can reuse the same transport boundary.
    !is_hop_by_hop_header(name) && !name.eq_ignore_ascii_case("host")
}

fn should_forward_response_header(name: &str) -> bool {
    !is_hop_by_hop_header(name)
        && !name.eq_ignore_ascii_case("content-length")
        && !name.eq_ignore_ascii_case("content-encoding")
}

fn is_hop_by_hop_header(name: &str) -> bool {
    name.eq_ignore_ascii_case("connection")
        || name.eq_ignore_ascii_case("keep-alive")
        || name.eq_ignore_ascii_case("proxy-authenticate")
        || name.eq_ignore_ascii_case("proxy-authorization")
        || name.eq_ignore_ascii_case("te")
        || name.eq_ignore_ascii_case("trailer")
        || name.eq_ignore_ascii_case("transfer-encoding")
        || name.eq_ignore_ascii_case("upgrade")
}

fn file_editor_agent_cors_headers(
    app_id: &str,
    subpath: &str,
    headers: &HeaderMap,
) -> Vec<(&'static str, String)> {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let allowed_origin = matches!(origin, "http://127.0.0.1:12359" | "http://localhost:12359");
    let agent_path = subpath == "agent/cwd" || subpath.starts_with("agent/");
    if app_id == "file_editor_cm6" && allowed_origin && agent_path {
        vec![
            ("access-control-allow-origin", origin.to_owned()),
            ("vary", "Origin".to_owned()),
            (
                "access-control-allow-methods",
                "GET, POST, OPTIONS".to_owned(),
            ),
            ("access-control-allow-headers", "Content-Type".to_owned()),
            ("access-control-max-age", "600".to_owned()),
        ]
    } else {
        Vec::new()
    }
}

fn response_with_extra_headers(
    status: StatusCode,
    body: Body,
    headers: &[(&'static str, String)],
) -> Response {
    let mut builder = Response::builder().status(status);
    for (name, value) in headers {
        builder = builder.header(*name, value);
    }
    builder
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn json_error(status: StatusCode, error: &str) -> Response {
    json_error_with_headers(status, error, &[])
}

fn json_error_with_headers(
    status: StatusCode,
    error: &str,
    headers: &[(&'static str, String)],
) -> Response {
    let body = Body::from(json!({ "ok": false, "error": error }).to_string());
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json");
    for (name, value) in headers {
        builder = builder.header(*name, value);
    }
    builder
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

fn file_response(path: &StdPath, body: Vec<u8>) -> Response {
    // Static file serving is intentionally small here: enough content typing and
    // no-cache behavior for live app assets without pulling in a full file server.
    let suffix = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut builder = Response::builder();
    if let Some(content_type) = content_type_for_suffix(&suffix) {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    if matches!(suffix.as_str(), "js" | "mjs" | "ts" | "css") {
        builder = builder
            .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
            .header(header::PRAGMA, "no-cache")
            .header(header::EXPIRES, "0");
    }
    builder
        .body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn content_type_for_suffix(suffix: &str) -> Option<&'static str> {
    match suffix {
        "css" => Some("text/css"),
        "html" | "htm" => Some("text/html; charset=utf-8"),
        "js" | "mjs" | "ts" => Some("application/javascript"),
        "json" => Some("application/json"),
        "png" => Some("image/png"),
        "svg" => Some("image/svg+xml"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "ico" => Some("image/x-icon"),
        "woff2" => Some("font/woff2"),
        "woff" => Some("font/woff"),
        "ttf" => Some("font/ttf"),
        _ => None,
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
