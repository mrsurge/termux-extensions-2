mod launcher;
mod proxy_shell;
mod registry;
mod runtime;
mod sio_proxy;

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::ws::{Message, WebSocket, WebSocketUpgrade, rejection::WebSocketUpgradeRejection},
    extract::{OriginalUri, Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header},
    response::{
        IntoResponse, Redirect, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{any, get, post},
};
#[cfg(feature = "ferrous-framework-pyo3")]
use ferrous_framework::{FerrousFrameworkHost, FerrousHostConfig};
use futures_util::{SinkExt, StreamExt, stream};
use launcher::{LaunchStore, launch_app, launch_supported};
use proxy_shell::{
    parse_proxy_shell, proxy_shell_upstream_path, proxy_shell_urls,
    rewrite_payload as rewrite_proxy_shell_payload, should_rewrite as should_rewrite_proxy_shell,
};
use registry::{AppRegistry, AppRoot};
use runtime::{FwsDiscovery, RunningApp};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value, json};
use sio_proxy::{MatchedSioRoute, SioRouteIndex, SioTarget, join_upstream_path};
use socketioxide::SocketIo;
use std::{
    collections::{HashMap, HashSet},
    convert::Infallible,
    env, fs,
    net::SocketAddr,
    path::{Path as StdPath, PathBuf},
    sync::Arc,
};
use tokio::{
    sync::{Notify, RwLock, broadcast},
    time::{Duration, timeout},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message as UpstreamWsMessage, client::IntoClientRequest},
};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::{EnvFilter, fmt};
use url::{Url, form_urlencoded};

const APP_ID: &str = "te2-rust-spike";
const APPS_EVENT_CHANNEL_CAPACITY: usize = 64;

// Shared server state: config is immutable per process, while the reqwest
// client owns reusable connection state for dynamic app proxying.
#[derive(Clone)]
struct AppState {
    config: Arc<ServerConfig>,
    http_client: reqwest::Client,
    sio_routes: Arc<SioRouteIndex>,
    launch_store: Arc<LaunchStore>,
    readiness_store: Arc<RwLock<HashMap<String, JsonMap<String, Value>>>>,
    apps_events: broadcast::Sender<AppsEvent>,
    fws_bridge: Arc<FwsBridgeConfig>,
    te2_runtime_bridge: Arc<Te2RuntimeBridgeConfig>,
}

#[derive(Clone, Debug)]
struct AppsEvent {
    event_type: String,
    payload: Value,
}

impl AppsEvent {
    fn new(event_type: impl Into<String>, payload: Value) -> Self {
        Self {
            event_type: event_type.into(),
            payload,
        }
    }

    fn ws_message(&self) -> Value {
        json!({
            "type": self.event_type,
            "payload": self.payload,
        })
    }

    fn sse_event(&self) -> Event {
        Event::default()
            .event(self.event_type.clone())
            .data(self.payload.to_string())
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
    #[cfg(feature = "ferrous-framework-pyo3")]
    host: Option<FerrousFrameworkHost>,
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

#[derive(Debug, Default, Deserialize)]
struct OpenAppRequest {
    #[serde(default)]
    params: JsonMap<String, Value>,
}

#[derive(Debug, Deserialize)]
struct StateWriteRequest {
    key: String,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    merge: bool,
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
    let state = AppState {
        config,
        http_client,
        sio_routes,
        launch_store: Arc::new(LaunchStore::default()),
        readiness_store: Arc::new(RwLock::new(HashMap::new())),
        apps_events,
        fws_bridge: Arc::new(fws_bridge_config.clone()),
        te2_runtime_bridge: Arc::new(load_te2_runtime_bridge_config()),
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
        .route("/", get(index))
        .route("/app/{app_id}", get(app_shell))
        .route("/api/health", get(health))
        .route(
            "/api/state",
            get(get_state).post(post_state).delete(delete_state),
        )
        // The spike keeps the FWS dashboard and peer socket on its own public
        // surface, but the concrete runtime is Ferrous-hosted and proxied here.
        .route("/fws", any(proxy_fws_request))
        .route("/fws/", any(proxy_fws_request))
        .route("/fws/{*rest}", any(proxy_fws_request))
        .route("/ws/fws", get(proxy_fws_ws_request))
        .route("/ws/fws/{*rest}", get(proxy_fws_ws_request))
        .route("/fws_ws/socket.io", any(proxy_fws_socketio_request))
        .route("/fws_ws/socket.io/", any(proxy_fws_socketio_request))
        .route("/fws_ws/socket.io/{*rest}", any(proxy_fws_socketio_request))
        .route("/te2_console_ws/socket.io", any(proxy_te2_console_request))
        .route("/te2_console_ws/socket.io/", any(proxy_te2_console_request))
        .route(
            "/te2_console_ws/socket.io/{*rest}",
            any(proxy_te2_console_request),
        )
        .route("/te2_mcp", any(proxy_te2_mcp_request))
        .route("/te2_mcp/", any(proxy_te2_mcp_request))
        .route("/te2_mcp/{*rest}", any(proxy_te2_mcp_request))
        .route("/te2_mcp_http", any(proxy_te2_mcp_http_request))
        .route("/te2_mcp_http/", any(proxy_te2_mcp_http_request))
        .route("/te2_mcp_http/{*rest}", any(proxy_te2_mcp_http_request))
        .route("/api/extensions", get(list_extensions))
        // Apps extension/app registry read model.
        .route("/api/apps", get(list_apps))
        .route("/api/apps/catalog", get(apps_catalog))
        .route("/api/apps/running", get(running_apps))
        .route("/api/apps/events", get(apps_events_sse))
        .route("/api/apps/{app_id}/start", post(start_app))
        .route("/api/apps/{app_id}/open", post(open_app))
        .route("/api/apps/{app_id}/quit", post(quit_app))
        .route(
            "/api/apps/{app_id}/readiness",
            get(get_app_readiness)
                .post(set_app_readiness)
                .put(set_app_readiness),
        )
        .route("/api/apps/{app_id}/proxy_shell", get(proxy_shell_meta))
        .route("/api/apps/reload", post(reload_apps))
        .route("/sw.js", get(service_worker))
        // App launcher event bridge. WebSocket and SSE share the same app
        // lifecycle broadcast channel so launchers and app shells do not poll.
        .route("/ws/apps", get(apps_ws))
        // Proxy-shell routes must win before the generic app proxy catches the
        // same `/api/app/{app_id}/...` prefix.
        .route("/api/app/{app_id}/proxy", any(proxy_shell_root_request))
        .route("/api/app/{app_id}/proxy/", any(proxy_shell_root_request))
        .route("/api/app/{app_id}/proxy/{*rest}", any(proxy_shell_request))
        // Dynamic app-worker proxy. These routes do not start apps.
        .route("/ws/app/{app_id}/{*route}", get(proxy_app_websocket))
        .route("/api/app/{app_id}", any(proxy_app_root_request))
        .route("/api/app/{app_id}/{*subpath}", any(proxy_app_request))
        // Static compatibility assets for the app launcher and manifest-backed apps.
        .route(
            "/extensions/{ext_dir}/{*filename}",
            get(serve_extension_file),
        )
        .route("/apps/{*path}", get(serve_app_file))
        .route("/static/{*filename}", get(serve_static_file));

    register_sio_proxy_routes(router, &state.sio_routes)
        .with_state(state)
        .layer(socket_layer)
        .layer(TraceLayer::new_for_http())
}

fn register_sio_proxy_routes(
    mut router: Router<AppState>,
    routes: &SioRouteIndex,
) -> Router<AppState> {
    // Manifest `sio_service` declarations are concrete physical Engine.IO
    // routes. Register base and rest forms for each public path/alias.
    for mount in routes.mount_paths() {
        let normalized_mount = mount.trim_end_matches('/').to_owned();
        let slash_mount = format!("{normalized_mount}/");
        let rest_mount = format!("{normalized_mount}/{{*rest}}");
        router = router
            .route(&normalized_mount, any(sio_proxy_request))
            .route(&slash_mount, any(sio_proxy_request))
            .route(&rest_mount, any(sio_proxy_request));
    }
    router
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

async fn index(State(state): State<AppState>) -> Response {
    let path = framework_template_path(&state.config.project_root, "index.html");
    match fs::read(&path) {
        Ok(body) => file_response(&path, body),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn app_shell(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    let registry = AppRegistry::load(&state.config.app_roots);
    let Some(app) = registry.get_app(&app_id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let backend_required = app.backend_module().is_some();
    if backend_required && running_app_for_id(&registry, &app_id).is_none() {
        return Redirect::to("/").into_response();
    }

    let path = framework_template_path(&state.config.project_root, "app_shell.html");
    let template = match fs::read_to_string(&path) {
        Ok(template) => template,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let content = template
        .replace(
            "{{ app_id|tojson }}",
            &serde_json::to_string(&app_id).unwrap_or_else(|_| "\"\"".to_owned()),
        )
        .replace(
            "{{ url_for('static', filename='js/ws_port.js') }}",
            "/static/js/ws_port.js",
        );
    html_response(content)
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
    let readiness = state.readiness_store.read().await;
    Json(ApiResponse {
        ok: true,
        data: catalog_payloads_with_running_and_readiness(&registry, &running_ids, &readiness),
    })
}

async fn running_apps(State(state): State<AppState>) -> Json<ApiResponse<Vec<Value>>> {
    let registry = AppRegistry::load(&state.config.app_roots);
    let readiness = state.readiness_store.read().await;
    Json(ApiResponse {
        ok: true,
        data: running_app_payloads(&registry, &readiness),
    })
}

async fn get_state(State(state): State<AppState>, uri: Uri) -> Response {
    let keys = state_keys_from_query(uri.query());
    if keys.is_empty() {
        return json_error(
            StatusCode::BAD_REQUEST,
            "query parameter \"key\" is required",
        );
    }
    let store = load_value_map(&state.config.state_store_path());
    let mut data = JsonMap::new();
    for key in keys {
        let value = store.get(&key).cloned().unwrap_or(Value::Null);
        data.insert(key, value);
    }
    Json(ApiResponse { ok: true, data }).into_response()
}

async fn post_state(
    State(state): State<AppState>,
    Json(payload): Json<StateWriteRequest>,
) -> Response {
    if payload.key.trim().is_empty() {
        return json_error(
            StatusCode::BAD_REQUEST,
            "\"key\" must be a non-empty string",
        );
    }
    let mut store = load_value_map(&state.config.state_store_path());
    if payload.merge {
        if let (Some(existing), Value::Object(next)) = (store.get(&payload.key), &payload.value) {
            if let Value::Object(existing_map) = existing {
                let mut merged = existing_map.clone();
                for (key, value) in next {
                    merged.insert(key.clone(), value.clone());
                }
                store.insert(payload.key.clone(), Value::Object(merged));
            } else {
                store.insert(payload.key.clone(), payload.value.clone());
            }
        } else {
            store.insert(payload.key.clone(), payload.value.clone());
        }
    } else {
        store.insert(payload.key.clone(), payload.value.clone());
    }
    if let Err(error) = save_value_map(&state.config.state_store_path(), &store) {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to persist state: {error}"),
        );
    }
    let data = store.get(&payload.key).cloned().unwrap_or(Value::Null);
    Json(ApiResponse { ok: true, data }).into_response()
}

async fn delete_state(State(state): State<AppState>, uri: Uri) -> Response {
    let keys = state_keys_from_query(uri.query());
    if keys.is_empty() {
        return json_error(
            StatusCode::BAD_REQUEST,
            "query parameter \"key\" is required",
        );
    }
    let mut store = load_value_map(&state.config.state_store_path());
    let mut removed = 0_u64;
    for key in keys {
        if store.remove(&key).is_some() {
            removed += 1;
        }
    }
    if let Err(error) = save_value_map(&state.config.state_store_path(), &store) {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to persist state: {error}"),
        );
    }
    Json(ApiResponse {
        ok: true,
        data: json!({ "removed": removed }),
    })
    .into_response()
}

async fn start_app(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    match start_app_inner(&state, &app_id).await {
        Ok(data) => {
            publish_app_running_changed(&state, &app_id, "start", Some(&data), None).await;
            Json(ApiResponse { ok: true, data }).into_response()
        }
        Err(response) => response,
    }
}

async fn start_app_inner(state: &AppState, app_id: &str) -> Result<Value, Response> {
    let registry = AppRegistry::load(&state.config.app_roots);
    let Some(app) = registry.get_app(app_id).cloned() else {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            &format!("App '{app_id}' not found"),
        ));
    };
    if !app.enabled {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("App '{app_id}' is disabled"),
        ));
    }
    ensure_starting_readiness_if_supported(state, &app).await;
    if let Some(running) = running_app_for_id(&registry, app_id) {
        let readiness = state.readiness_store.read().await;
        return Ok(running_app_to_value(&registry, running, &readiness));
    }
    if app.backend_module().is_none() && app.shells.is_empty() {
        return Ok(json!({
            "app_id": app.app_id,
            "message": "No backend to start",
        }));
    }
    if !launch_supported() {
        return Err(json_error(
            StatusCode::NOT_IMPLEMENTED,
            "Rust spike was built without the ferrous-framework-pyo3 feature.",
        ));
    }

    let project_root = PathBuf::from(state.config.project_root.clone());
    let framework_url = state.config.framework_url();
    let framework_shells_env = state.fws_bridge.child_env.clone();
    let launch_store = state.launch_store.clone();
    let launch_result = match tokio::task::spawn_blocking(move || {
        launch_app(
            &launch_store,
            &app,
            &project_root,
            &framework_url,
            &framework_shells_env,
        )
    })
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            warn!(%error, %app_id, "failed to launch app worker");
            return Err(json_error(StatusCode::BAD_GATEWAY, &error.to_string()));
        }
        Err(error) => {
            warn!(%error, %app_id, "launch task failed");
            return Err(json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("launch task failed for '{app_id}'"),
            ));
        }
    };

    if let Some(running) =
        wait_for_running_app(&state.config.app_roots, app_id, &launch_result.shell_id).await
    {
        let readiness = state.readiness_store.read().await;
        return Ok(running_app_to_value(&registry, running, &readiness));
    }

    Ok(serde_json::to_value(launch_result).unwrap_or_else(|_| json!({ "app_id": app_id })))
}

async fn open_app(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    payload: Option<Json<OpenAppRequest>>,
) -> Response {
    let params = payload.map(|Json(body)| body.params).unwrap_or_default();
    let app_info = match start_app_inner(&state, &app_id).await {
        Ok(data) => data,
        Err(response) => return response,
    };
    publish_app_running_changed(&state, &app_id, "open", Some(&app_info), None).await;

    let mut url = format!("/app/{app_id}");
    if !params.is_empty() {
        let mut serializer = form_urlencoded::Serializer::new(String::new());
        for (key, value) in params {
            match value {
                Value::Null => {}
                Value::String(raw) => {
                    serializer.append_pair(&key, &raw);
                }
                other => {
                    serializer.append_pair(&key, &other.to_string());
                }
            }
        }
        let query = serializer.finish();
        if !query.is_empty() {
            url.push('?');
            url.push_str(&query);
        }
    }

    Json(ApiResponse {
        ok: true,
        data: json!({
            "url": url,
            "app_info": app_info,
        }),
    })
    .into_response()
}

async fn quit_app(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    let registry = AppRegistry::load(&state.config.app_roots);
    if registry.get_app(&app_id).is_none() {
        return json_error(StatusCode::NOT_FOUND, &format!("App '{app_id}' not found"));
    }

    let root_pids = FwsDiscovery::from_env().root_pids_for_app(&app_id);
    if root_pids.is_empty() {
        return json_error(
            StatusCode::NOT_FOUND,
            "App is not running or already terminated.",
        );
    }

    let Some(upstream) = absolute_upstream_url(
        &state.fws_bridge.upstream_base_url,
        &format!("/fws/action/app/{app_id}/shutdown"),
        None,
        false,
    ) else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "FWS bridge runtime is not available.",
        );
    };

    let response = match state
        .http_client
        .post(upstream.clone())
        .header("x-fws-ajax", "1")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            warn!(%error, %app_id, %upstream, "failed to reach FWS app shutdown action");
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to terminate app group for '{app_id}'."),
            );
        }
    };
    if !response.status().is_success() {
        warn!(
            status = %response.status(),
            %app_id,
            %upstream,
            "FWS app shutdown action returned non-success"
        );
        return json_error(
            StatusCode::BAD_GATEWAY,
            &format!("Failed to terminate app group for '{app_id}'."),
        );
    }

    state.readiness_store.write().await.remove(&app_id);
    publish_app_running_changed(&state, &app_id, "quit", None, Some(false)).await;
    Json(ApiResponse {
        ok: true,
        data: json!({
            "message": format!("App {app_id} terminated."),
            "root_pids": root_pids,
            "stats": {},
        }),
    })
    .into_response()
}

async fn set_app_readiness(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    payload: Option<Json<JsonMap<String, Value>>>,
) -> Response {
    let registry = AppRegistry::load(&state.config.app_roots);
    let app = match readiness_manifest_or_error(&registry, &app_id) {
        Ok(app) => app,
        Err(response) => return response,
    };
    let body = payload.map(|Json(body)| body).unwrap_or_default();
    let status = body
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if status.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "status is required");
    }
    let status_normalized = normalize_readiness_status(status);
    if !matches!(
        status_normalized.as_str(),
        "starting" | "ready" | "error" | "stopped"
    ) {
        return json_error(StatusCode::BAD_REQUEST, "invalid readiness status");
    }

    let mut readiness = body;
    readiness.insert("app_id".to_owned(), Value::String(app.app_id.clone()));
    readiness.insert("status".to_owned(), Value::String(status_normalized));
    state
        .readiness_store
        .write()
        .await
        .insert(app_id.clone(), readiness.clone());
    publish_apps_event(
        &state,
        AppsEvent::new(
            "app_readiness_changed",
            json!({ "app_id": app_id, "readiness": readiness.clone() }),
        ),
    );
    publish_catalog_snapshot(&state).await;
    Json(ApiResponse {
        ok: true,
        data: Value::Object(readiness),
    })
    .into_response()
}

async fn get_app_readiness(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    let registry = AppRegistry::load(&state.config.app_roots);
    if let Err(response) = readiness_manifest_or_error(&registry, &app_id) {
        return response;
    }
    if let Some(readiness) = state.readiness_store.read().await.get(&app_id).cloned() {
        return Json(ApiResponse {
            ok: true,
            data: Value::Object(readiness),
        })
        .into_response();
    }
    let data = if running_app_for_id(&registry, &app_id).is_some() {
        json!({ "app_id": app_id, "status": "starting" })
    } else {
        json!({ "app_id": app_id, "status": "stopped" })
    };
    Json(ApiResponse { ok: true, data }).into_response()
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
    publish_apps_event(
        &state,
        AppsEvent::new("registry_reloaded", Value::Object(data.clone())),
    );
    publish_catalog_snapshot(&state).await;
    Json(ApiResponse { ok: true, data })
}

async fn proxy_shell_meta(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    let registry = AppRegistry::load(&state.config.app_roots);
    let Some(app) = registry.get_app(&app_id) else {
        return json_error(StatusCode::NOT_FOUND, &format!("App '{app_id}' not found"));
    };
    let proxy_shell = match parse_proxy_shell(app) {
        Ok(Some(config)) => config,
        Ok(None) => {
            return json_error(
                StatusCode::NOT_FOUND,
                &format!("App '{app_id}' does not declare an enabled proxy_shell"),
            );
        }
        Err(error) => {
            warn!(%error, %app_id, "invalid proxy_shell config");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("App '{app_id}' proxy_shell config is invalid"),
            );
        }
    };
    Json(ApiResponse {
        ok: true,
        data: proxy_shell_urls(&app_id, &proxy_shell),
    })
    .into_response()
}

async fn apps_ws(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    // `/ws/apps` is the launcher/app-shell live state lane. Every client gets
    // the current snapshot first, then compatible lifecycle update messages.
    ws.on_upgrade(move |socket| handle_apps_ws(socket, state))
        .into_response()
}

async fn handle_apps_ws(mut socket: WebSocket, state: AppState) {
    if send_apps_ws_event(
        &mut socket,
        AppsEvent::new("apps_snapshot", apps_snapshot_payload(&state).await),
    )
    .await
    .is_err()
    {
        return;
    }

    let mut events = state.apps_events.subscribe();
    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    _ => {}
                }
            }
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        if send_apps_ws_event(&mut socket, event).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let event = AppsEvent::new("catalog_snapshot", apps_snapshot_payload(&state).await);
                        if send_apps_ws_event(&mut socket, event).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn send_apps_ws_event(socket: &mut WebSocket, event: AppsEvent) -> Result<(), axum::Error> {
    socket
        .send(Message::Text(event.ws_message().to_string().into()))
        .await
}

async fn apps_events_sse(State(state): State<AppState>) -> Response {
    // SSE mirrors the same event names as the Python apps extension while also
    // emitting an initial snapshot so new clients can hydrate without a GET.
    let initial_state = state.clone();
    let initial = stream::once(async move {
        Ok::<Event, Infallible>(
            AppsEvent::new("apps_snapshot", apps_snapshot_payload(&initial_state).await)
                .sse_event(),
        )
    });
    let update_state = state.clone();
    let updates = stream::unfold(
        (state.apps_events.subscribe(), update_state),
        |(mut events, state)| async move {
            loop {
                match events.recv().await {
                    Ok(event) => {
                        return Some((Ok::<Event, Infallible>(event.sse_event()), (events, state)));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let event =
                            AppsEvent::new("catalog_snapshot", apps_snapshot_payload(&state).await)
                                .sse_event();
                        return Some((Ok::<Event, Infallible>(event), (events, state)));
                    }
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        },
    );
    let mut response = Sse::new(initial.chain(updates))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(25))
                .text("ping"),
        )
        .into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
    response
}

async fn proxy_app_websocket(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path((app_id, route)): Path<(String, String)>,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    let registry = AppRegistry::load(&state.config.app_roots);
    let Some(running_app) = running_app_for_id(&registry, &app_id) else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!("App '{app_id}' is not running. Start it from the launcher first."),
        );
    };

    // Generic app websocket routes preserve the Python framework shape:
    // `/ws/app/<app>/<route>` maps to `/ws/<route>` on the running worker.
    let upstream_path = format!("/ws/{}", route.trim_start_matches('/'));
    let upstream_url = upstream_url(
        "ws",
        "127.0.0.1",
        running_app.port,
        &upstream_path,
        uri.query(),
    );
    ws.on_upgrade(move |socket| bridge_websocket(socket, upstream_url, headers, "app_websocket"))
        .into_response()
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

async fn proxy_shell_root_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    proxy_shell_request_inner(ws, state, app_id, String::new(), method, uri, headers, body).await
}

async fn proxy_shell_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    State(state): State<AppState>,
    Path((app_id, rest)): Path<(String, String)>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    proxy_shell_request_inner(ws, state, app_id, rest, method, uri, headers, body).await
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

async fn proxy_shell_request_inner(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    state: AppState,
    app_id: String,
    rest: String,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let registry = AppRegistry::load(&state.config.app_roots);
    let Some(app) = registry.get_app(&app_id) else {
        return json_error(StatusCode::NOT_FOUND, &format!("App '{app_id}' not found"));
    };
    let proxy_shell = match parse_proxy_shell(app) {
        Ok(Some(config)) => config,
        Ok(None) => {
            return json_error(
                StatusCode::NOT_FOUND,
                &format!("proxy_shell is not enabled for '{app_id}'"),
            );
        }
        Err(error) => {
            warn!(%error, %app_id, "invalid proxy_shell config");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("App '{app_id}' proxy_shell config is invalid"),
            );
        }
    };
    let Some(running_app) = running_app_for_id(&registry, &app_id) else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!("App '{app_id}' is not running"),
        );
    };

    let mut upstream_path = proxy_shell_upstream_path(&rest);
    if upstream_path == "/socket.io" {
        upstream_path = "/socket.io/".to_owned();
    }

    // Proxy-shell routes are app-worker-backed, but they preserve upstream
    // standalone app URL semantics instead of the generic `/api/app/...` remap.
    if let Ok(ws) = ws {
        let upstream = upstream_url(
            "ws",
            "127.0.0.1",
            running_app.port,
            &upstream_path,
            uri.query(),
        );
        return ws
            .on_upgrade(move |socket| bridge_websocket(socket, upstream, headers, "proxy_shell"))
            .into_response();
    }

    let upstream_url = upstream_url(
        "http",
        "127.0.0.1",
        running_app.port,
        &upstream_path,
        uri.query(),
    );
    let reqwest_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => return json_error(StatusCode::METHOD_NOT_ALLOWED, "Unsupported HTTP method."),
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
            warn!(%error, %app_id, %upstream_url, "failed to reach proxy_shell upstream");
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("App '{app_id}' proxy_shell upstream is not reachable yet."),
            );
        }
    };
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let upstream_headers = upstream.headers().clone();
    let content_type = upstream_headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut response_body = match upstream.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            warn!(%error, %app_id, "failed to read proxy_shell upstream response body");
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("App '{app_id}' proxy_shell response could not be read."),
            );
        }
    };
    if should_rewrite_proxy_shell(&upstream_path, &content_type, &proxy_shell) {
        if let Ok(text) = String::from_utf8(response_body.to_vec()) {
            let rewritten = rewrite_proxy_shell_payload(&text, &app_id, &proxy_shell);
            if rewritten != text {
                response_body = Bytes::from(rewritten);
            }
        }
    }

    let mut builder = Response::builder().status(status);
    for (name, value) in upstream_headers.iter() {
        if should_forward_response_header(name.as_str()) {
            builder = builder.header(name, value);
        }
    }
    builder
        .body(Body::from(response_body))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
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

    // Response passthrough should stay transparent for app-worker routes. The
    // legacy Python framework streams these bodies directly instead of waiting
    // to buffer the full response before replying.
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let upstream_headers = upstream.headers().clone();
    let upstream_body = futures_util::stream::unfold(upstream, |mut upstream| async move {
        match upstream.chunk().await {
            Ok(Some(chunk)) => Some((Ok::<Bytes, std::io::Error>(chunk), upstream)),
            Ok(None) => None,
            Err(error) => Some((Err(std::io::Error::other(error)), upstream)),
        }
    });

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
        .body(Body::from_stream(upstream_body))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn sio_proxy_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    State(state): State<AppState>,
    OriginalUri(original_uri): OriginalUri,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(matched) = state.sio_routes.match_path(original_uri.path()) else {
        return json_error(
            StatusCode::NOT_FOUND,
            "Socket.IO proxy route was not found.",
        );
    };
    let Some((host, port)) = resolve_sio_upstream(&state, &matched) else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!(
                "Socket.IO route '{}' for app '{}' is not available.",
                matched.route.route_id, matched.route.app_id
            ),
        );
    };
    let upstream_path = join_upstream_path(&matched.route.upstream_path, &matched.rest);

    // Engine.IO polling and websocket upgrade share the same manifest route. The
    // Rust framework owns only the physical pipe; namespaces stay upstream-owned.
    if let Ok(ws) = ws {
        let upstream = upstream_url("ws", &host, port, &upstream_path, uri.query());
        return ws
            .on_upgrade(move |socket| bridge_websocket(socket, upstream, headers, "sio_service"))
            .into_response();
    }

    let upstream = upstream_url("http", &host, port, &upstream_path, uri.query());
    proxy_http_request(&state, method, headers, body, upstream, Vec::new()).await
}

async fn proxy_fws_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    State(state): State<AppState>,
    OriginalUri(original_uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    proxy_absolute_fws_request(
        ws,
        &state,
        original_uri.path(),
        original_uri.query(),
        method,
        headers,
        body,
        "fws_dashboard",
    )
    .await
}

async fn proxy_fws_ws_request(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    OriginalUri(original_uri): OriginalUri,
    headers: HeaderMap,
) -> Response {
    let Some(upstream) = absolute_upstream_url(
        &state.fws_bridge.upstream_base_url,
        original_uri.path(),
        original_uri.query(),
        true,
    ) else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "FWS bridge runtime is not available.",
        );
    };
    ws.on_upgrade(move |socket| bridge_websocket(socket, upstream, headers, "fws_ws"))
        .into_response()
}

async fn proxy_fws_socketio_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    State(state): State<AppState>,
    OriginalUri(original_uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    proxy_absolute_fws_request(
        ws,
        &state,
        original_uri.path(),
        original_uri.query(),
        method,
        headers,
        body,
        "fws_socketio",
    )
    .await
}

async fn proxy_te2_console_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    State(state): State<AppState>,
    OriginalUri(original_uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    proxy_absolute_bridge_request(
        ws,
        &state,
        &state.te2_runtime_bridge.upstream_base_url,
        "TE2 runtime bridge is not available.",
        original_uri.path(),
        original_uri.query(),
        method,
        headers,
        body,
        "te2_console",
        false,
    )
    .await
}

async fn proxy_te2_mcp_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    State(state): State<AppState>,
    OriginalUri(original_uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let upstream_path = normalize_mcp_mount_path(original_uri.path(), "/te2_mcp");
    proxy_absolute_bridge_request(
        ws,
        &state,
        &state.te2_runtime_bridge.upstream_base_url,
        "TE2 runtime bridge is not available.",
        &upstream_path,
        original_uri.query(),
        method,
        headers,
        body,
        "te2_mcp",
        true,
    )
    .await
}

async fn proxy_te2_mcp_http_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    State(state): State<AppState>,
    OriginalUri(original_uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let upstream_path = normalize_mcp_mount_path(original_uri.path(), "/te2_mcp_http");
    proxy_absolute_bridge_request(
        ws,
        &state,
        &state.te2_runtime_bridge.upstream_base_url,
        "TE2 runtime bridge is not available.",
        &upstream_path,
        original_uri.query(),
        method,
        headers,
        body,
        "te2_mcp_http",
        true,
    )
    .await
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

async fn serve_app_file(
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Result<Response, StatusCode> {
    let (resolved_by_id, resolved_by_dir) = if let Some(rest) = path.strip_prefix("by-id/") {
        let Some((app_id, filename)) = rest.split_once('/') else {
            return Err(StatusCode::NOT_FOUND);
        };
        (Some((app_id, filename)), None)
    } else {
        let Some((app_dir, filename)) = path.split_once('/') else {
            return Err(StatusCode::NOT_FOUND);
        };
        (None, Some((app_dir, filename)))
    };

    let registry = AppRegistry::load(&state.config.app_roots);
    // Both `/apps/by-id/{app_id}/...` and legacy `/apps/{dir}/...` resolve
    // through one route to avoid overlapping wildcard route ambiguity.
    let resolved = if let Some((app_id, filename)) = resolved_by_id {
        registry.resolve_asset_path(app_id, filename)
    } else if let Some((app_dir, filename)) = resolved_by_dir {
        registry.resolve_asset_path_by_dir(app_dir, filename)
    } else {
        None
    };
    let Some(resolved) = resolved else {
        return Err(StatusCode::NOT_FOUND);
    };
    let body = fs::read(&resolved).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(file_response(&resolved, body))
}

async fn serve_static_file(
    State(state): State<AppState>,
    Path(filename): Path<String>,
) -> Result<Response, StatusCode> {
    let root = framework_static_root(&state.config.project_root);
    let Some(resolved) = resolve_file_under_root(&root, &filename) else {
        return Err(StatusCode::NOT_FOUND);
    };
    let body = fs::read(&resolved).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(file_response(&resolved, body))
}

async fn service_worker(State(state): State<AppState>) -> Response {
    let sw_path = framework_static_root(&state.config.project_root)
        .join("js")
        .join("sw.js");
    let version_path = PathBuf::from(&state.config.project_root)
        .join("app")
        .join("apps")
        .join("file_editor_cm6")
        .join("static")
        .join("version.txt");
    let version = fs::read_to_string(version_path)
        .ok()
        .map(|raw| raw.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "0".to_owned());
    match fs::read_to_string(&sw_path) {
        Ok(content) => javascript_response(content.replace("__ASSET_VERSION__", &version)),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn apps_snapshot_payload(state: &AppState) -> Value {
    // Launcher snapshots combine the manifest registry with read-only FWS
    // discovery so running markers work before lifecycle mutation is ported.
    let registry = AppRegistry::load(&state.config.app_roots);
    let running_ids = running_app_ids(&registry);
    let readiness = state.readiness_store.read().await;
    let mut sorted_running_ids = running_ids.iter().cloned().collect::<Vec<_>>();
    sorted_running_ids.sort();

    json!({
        "catalog": catalog_payloads_with_running_and_readiness(&registry, &running_ids, &readiness),
        "running_ids": sorted_running_ids,
    })
}

fn publish_apps_event(state: &AppState, event: AppsEvent) {
    let _ = state.apps_events.send(event);
}

async fn publish_catalog_snapshot(state: &AppState) {
    publish_apps_event(
        state,
        AppsEvent::new("catalog_snapshot", apps_snapshot_payload(state).await),
    );
}

async fn publish_app_running_changed(
    state: &AppState,
    app_id: &str,
    trigger: &str,
    app_info: Option<&Value>,
    running_override: Option<bool>,
) {
    let registry = AppRegistry::load(&state.config.app_roots);
    let running = running_app_for_id(&registry, app_id);
    let running_flag = running_override.unwrap_or_else(|| running.is_some());
    let shell_id = running
        .as_ref()
        .map(|app| app.shell_id.clone())
        .or_else(|| {
            app_info
                .and_then(Value::as_object)
                .and_then(|object| object.get("shell_id"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        });

    publish_catalog_snapshot(state).await;
    publish_apps_event(
        state,
        AppsEvent::new(
            "app_running_changed",
            json!({
                "app_id": app_id,
                "running": running_flag,
                "event_type": trigger,
                "shell_id": shell_id,
            }),
        ),
    );
}

fn running_app_ids(registry: &AppRegistry) -> HashSet<String> {
    discover_running_apps(registry)
        .into_iter()
        .map(|app| app.app_id)
        .collect()
}

fn running_app_payloads(
    registry: &AppRegistry,
    readiness_store: &HashMap<String, JsonMap<String, Value>>,
) -> Vec<Value> {
    discover_running_apps(registry)
        .into_iter()
        .map(|app| running_app_to_value(registry, app, readiness_store))
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

fn running_app_to_value(
    registry: &AppRegistry,
    app: RunningApp,
    readiness_store: &HashMap<String, JsonMap<String, Value>>,
) -> Value {
    let app_id = app.app_id.clone();
    let mut payload = serde_json::to_value(app)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if let Some(readiness) = readiness_store.get(&app_id) {
        payload.insert("readiness".to_owned(), Value::Object(readiness.clone()));
    } else if registry
        .get_app(&app_id)
        .is_some_and(|app| app.readiness_support && app.backend_module().is_some())
    {
        payload.insert(
            "readiness".to_owned(),
            json!({ "app_id": app_id, "status": "starting" }),
        );
    }
    registry.augment_running_payload(&app_id, &mut payload);
    Value::Object(payload)
}

async fn wait_for_running_app(
    app_roots: &[AppRoot],
    app_id: &str,
    shell_id: &str,
) -> Option<RunningApp> {
    for _ in 0..30 {
        let registry = AppRegistry::load(app_roots);
        if let Some(running) = running_app_for_id(&registry, app_id) {
            if running.shell_id == shell_id || running.app_id == app_id {
                return Some(running);
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    None
}

fn resolve_sio_upstream(state: &AppState, matched: &MatchedSioRoute) -> Option<(String, u16)> {
    match matched.route.target {
        SioTarget::Static => Some((matched.route.host.clone(), matched.route.port?)),
        SioTarget::AppWorker => {
            let registry = AppRegistry::load(&state.config.app_roots);
            let running = running_app_for_id(&registry, &matched.route.app_id)?;
            Some(("127.0.0.1".to_owned(), running.port))
        }
    }
}

async fn proxy_absolute_fws_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    state: &AppState,
    upstream_path: &str,
    query: Option<&str>,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
    bridge_label: &'static str,
) -> Response {
    proxy_absolute_bridge_request(
        ws,
        state,
        &state.fws_bridge.upstream_base_url,
        "FWS bridge runtime is not available.",
        upstream_path,
        query,
        method,
        headers,
        body,
        bridge_label,
        false,
    )
    .await
}

async fn proxy_absolute_bridge_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    state: &AppState,
    upstream_base_url: &str,
    unavailable_message: &'static str,
    upstream_path: &str,
    query: Option<&str>,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
    bridge_label: &'static str,
    stream_response_body: bool,
) -> Response {
    if let Ok(ws) = ws {
        let Some(upstream) = absolute_upstream_url(upstream_base_url, upstream_path, query, true)
        else {
            return json_error(StatusCode::SERVICE_UNAVAILABLE, unavailable_message);
        };
        return ws
            .on_upgrade(move |socket| bridge_websocket(socket, upstream, headers, bridge_label))
            .into_response();
    }

    let Some(upstream) = absolute_upstream_url(upstream_base_url, upstream_path, query, false)
    else {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, unavailable_message);
    };
    if stream_response_body {
        proxy_streaming_http_request(state, method, headers, body, upstream, Vec::new()).await
    } else {
        proxy_http_request(state, method, headers, body, upstream, Vec::new()).await
    }
}

async fn proxy_http_request(
    state: &AppState,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
    upstream_url: String,
    extra_headers: Vec<(&'static str, String)>,
) -> Response {
    let reqwest_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => return json_error(StatusCode::METHOD_NOT_ALLOWED, "Unsupported HTTP method."),
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
            warn!(%error, %upstream_url, "failed to reach upstream HTTP proxy target");
            return json_error(
                StatusCode::BAD_GATEWAY,
                "Upstream proxy target is not reachable yet. Please retry shortly.",
            );
        }
    };
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let upstream_headers = upstream.headers().clone();
    let upstream_body = match upstream.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            warn!(%error, "failed to read upstream HTTP proxy response body");
            return json_error(
                StatusCode::BAD_GATEWAY,
                "Upstream proxy response could not be read.",
            );
        }
    };

    let mut builder = Response::builder().status(status);
    for (name, value) in upstream_headers.iter() {
        if should_forward_response_header(name.as_str()) {
            builder = builder.header(name, value);
        }
    }
    for (name, value) in extra_headers {
        builder = builder.header(name, value);
    }
    builder
        .body(Body::from(upstream_body))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn proxy_streaming_http_request(
    state: &AppState,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
    upstream_url: String,
    extra_headers: Vec<(&'static str, String)>,
) -> Response {
    let reqwest_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => return json_error(StatusCode::METHOD_NOT_ALLOWED, "Unsupported HTTP method."),
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
            warn!(%error, %upstream_url, "failed to reach upstream streaming proxy target");
            return json_error(
                StatusCode::BAD_GATEWAY,
                "Upstream proxy target is not reachable yet. Please retry shortly.",
            );
        }
    };
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let upstream_headers = upstream.headers().clone();
    let body_stream = futures_util::stream::unfold(upstream, |mut upstream| async move {
        match upstream.chunk().await {
            Ok(Some(chunk)) => Some((Ok::<Bytes, std::io::Error>(chunk), upstream)),
            Ok(None) => None,
            Err(error) => Some((Err(std::io::Error::other(error)), upstream)),
        }
    });

    let mut builder = Response::builder().status(status);
    for (name, value) in upstream_headers.iter() {
        if should_forward_response_header(name.as_str()) {
            builder = builder.header(name, value);
        }
    }
    for (name, value) in extra_headers {
        builder = builder.header(name, value);
    }
    builder
        .body(Body::from_stream(body_stream))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn bridge_websocket(
    socket: WebSocket,
    upstream_url: String,
    headers: HeaderMap,
    bridge_label: &'static str,
) {
    let mut request = match upstream_url.clone().into_client_request() {
        Ok(request) => request,
        Err(error) => {
            warn!(%error, %upstream_url, bridge_label, "failed to build upstream websocket request");
            return;
        }
    };
    copy_websocket_headers(&headers, request.headers_mut());

    let upstream = match connect_async(request).await {
        Ok((stream, _response)) => stream,
        Err(error) => {
            warn!(%error, %upstream_url, bridge_label, "failed to connect upstream websocket");
            return;
        }
    };

    // The websocket bridge is deliberately protocol-agnostic: text, binary,
    // ping/pong, and close frames pass through without interpreting Socket.IO.
    let (mut client_tx, mut client_rx) = socket.split();
    let (mut upstream_tx, mut upstream_rx) = upstream.split();

    let client_to_upstream = async {
        while let Some(result) = client_rx.next().await {
            let Ok(message) = result else {
                break;
            };
            let (message, should_close) = axum_to_upstream_ws_message(message);
            if let Some(message) = message {
                if upstream_tx.send(message).await.is_err() {
                    break;
                }
            }
            if should_close {
                break;
            }
        }
    };

    let upstream_to_client = async {
        while let Some(result) = upstream_rx.next().await {
            let Ok(message) = result else {
                break;
            };
            let (message, should_close) = upstream_to_axum_ws_message(message);
            if let Some(message) = message {
                if client_tx.send(message).await.is_err() {
                    break;
                }
            }
            if should_close {
                break;
            }
        }
    };

    tokio::select! {
        _ = client_to_upstream => {}
        _ = upstream_to_client => {}
    }
}

fn axum_to_upstream_ws_message(message: Message) -> (Option<UpstreamWsMessage>, bool) {
    match message {
        Message::Text(text) => (
            Some(UpstreamWsMessage::Text(text.to_string().into())),
            false,
        ),
        Message::Binary(bytes) => (Some(UpstreamWsMessage::Binary(bytes)), false),
        Message::Ping(bytes) => (Some(UpstreamWsMessage::Ping(bytes)), false),
        Message::Pong(bytes) => (Some(UpstreamWsMessage::Pong(bytes)), false),
        Message::Close(_) => (Some(UpstreamWsMessage::Close(None)), true),
    }
}

fn upstream_to_axum_ws_message(message: UpstreamWsMessage) -> (Option<Message>, bool) {
    match message {
        UpstreamWsMessage::Text(text) => (Some(Message::Text(text.to_string().into())), false),
        UpstreamWsMessage::Binary(bytes) => (Some(Message::Binary(bytes)), false),
        UpstreamWsMessage::Ping(bytes) => (Some(Message::Ping(bytes)), false),
        UpstreamWsMessage::Pong(bytes) => (Some(Message::Pong(bytes)), false),
        UpstreamWsMessage::Close(_) => (Some(Message::Close(None)), true),
        UpstreamWsMessage::Frame(_) => (None, false),
    }
}

fn copy_websocket_headers(
    source: &HeaderMap,
    target: &mut tokio_tungstenite::tungstenite::http::HeaderMap,
) {
    for name in [
        header::ORIGIN,
        header::COOKIE,
        header::USER_AGENT,
        header::SEC_WEBSOCKET_PROTOCOL,
    ] {
        if let Some(value) = source.get(&name) {
            target.insert(name, value.clone());
        }
    }
}

fn upstream_url(scheme: &str, host: &str, port: u16, path: &str, query: Option<&str>) -> String {
    let mut url = format!("{scheme}://{host}:{port}{path}");
    if let Some(query) = query.filter(|value| !value.is_empty()) {
        url.push('?');
        url.push_str(query);
    }
    url
}

fn absolute_upstream_url(
    base_url: &str,
    path: &str,
    query: Option<&str>,
    websocket: bool,
) -> Option<String> {
    let mut url = Url::parse(base_url).ok()?;
    if websocket {
        let target_scheme = match url.scheme() {
            "https" => "wss",
            _ => "ws",
        };
        let _ = url.set_scheme(target_scheme);
    }
    url.set_path(path);
    url.set_query(query.filter(|value| !value.is_empty()));
    Some(url.to_string())
}

fn normalize_mcp_mount_path(path: &str, mount_root: &str) -> String {
    if path == mount_root {
        return format!("{mount_root}/");
    }
    path.to_owned()
}

fn load_te2_runtime_bridge_config() -> Te2RuntimeBridgeConfig {
    let upstream_base_url = env::var("TE2_RUST_SPIKE_RUNTIME_BRIDGE_URL").unwrap_or_default();
    Te2RuntimeBridgeConfig { upstream_base_url }
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

    fn framework_url(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }

    fn state_store_path(&self) -> PathBuf {
        xdg_cache_home()
            .join("termux_extensions")
            .join("state_store.json")
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

fn xdg_cache_home() -> PathBuf {
    env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".cache")
        })
}

fn framework_template_path(project_root: &str, filename: &str) -> PathBuf {
    PathBuf::from(project_root)
        .join("app")
        .join("templates")
        .join(filename)
}

fn framework_static_root(project_root: &str) -> PathBuf {
    PathBuf::from(project_root).join("app").join("static")
}

fn resolve_file_under_root(root: &StdPath, filename: &str) -> Option<PathBuf> {
    let root = root.canonicalize().ok()?;
    let candidate = root.join(filename).canonicalize().ok()?;
    if !candidate.starts_with(&root) {
        return None;
    }
    Some(candidate)
}

fn state_keys_from_query(query: Option<&str>) -> Vec<String> {
    query
        .map(|raw| {
            form_urlencoded::parse(raw.as_bytes())
                .filter_map(|(key, value)| {
                    if key == "key" && !value.trim().is_empty() {
                        Some(value.into_owned())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn load_value_map(path: &StdPath) -> JsonMap<String, Value> {
    let Ok(text) = fs::read_to_string(path) else {
        return JsonMap::new();
    };
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn save_value_map(path: &StdPath, data: &JsonMap<String, Value>) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create parent dir {}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(&Value::Object(data.clone()))
        .context("failed to serialize JSON store")?;
    fs::write(path, text).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn html_response(content: String) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(content))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn javascript_response(content: String) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, "application/javascript")
        .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
        .header(header::PRAGMA, "no-cache")
        .header(header::EXPIRES, "0")
        .body(Body::from(content))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn readiness_manifest_or_error<'a>(
    registry: &'a AppRegistry,
    app_id: &str,
) -> Result<&'a registry::AppDefinition, Response> {
    let Some(app) = registry.get_app(app_id) else {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            &format!("App '{app_id}' not found"),
        ));
    };
    if !app.readiness_support {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            &format!("App '{app_id}' does not support readiness"),
        ));
    }
    Ok(app)
}

fn normalize_readiness_status(status: &str) -> String {
    let lowered = status.trim().to_ascii_lowercase();
    match lowered.as_str() {
        "loading" => "starting".to_owned(),
        "ok" | "up" | "serving" => "ready".to_owned(),
        _ => lowered,
    }
}

async fn ensure_starting_readiness_if_supported(state: &AppState, app: &registry::AppDefinition) {
    if !app.readiness_support || app.backend_module().is_none() {
        return;
    }
    let mut readiness = state.readiness_store.write().await;
    let existing_status = readiness
        .get(&app.app_id)
        .and_then(|value| value.get("status"))
        .and_then(Value::as_str)
        .map(normalize_readiness_status);
    if matches!(existing_status.as_deref(), Some("ready" | "starting")) {
        return;
    }
    let entry = readiness.entry(app.app_id.clone()).or_default();
    entry.insert("app_id".to_owned(), Value::String(app.app_id.clone()));
    entry.insert("status".to_owned(), Value::String("starting".to_owned()));
}

fn catalog_payloads_with_running_and_readiness(
    registry: &AppRegistry,
    running_ids: &HashSet<String>,
    readiness_store: &HashMap<String, JsonMap<String, Value>>,
) -> Vec<Value> {
    registry
        .catalog_payloads_with_running(running_ids)
        .into_iter()
        .map(|payload| {
            let Some(mut object) = payload.as_object().cloned() else {
                return payload;
            };
            let Some(app_id) = object.get("id").and_then(Value::as_str).map(str::to_owned) else {
                return Value::Object(object);
            };
            if let Some(readiness) = readiness_store.get(&app_id) {
                object.insert("readiness".to_owned(), Value::Object(readiness.clone()));
            } else if running_ids.contains(&app_id)
                && registry
                    .get_app(&app_id)
                    .is_some_and(|app| app.readiness_support && app.backend_module().is_some())
            {
                object.insert(
                    "readiness".to_owned(),
                    json!({ "app_id": app_id, "status": "starting" }),
                );
            }
            Value::Object(object)
        })
        .collect()
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
        "webmanifest" => Some("application/manifest+json"),
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

fn start_fws_bridge(config: &ServerConfig, public_framework_url: &str) -> Result<FwsBridgeRuntime> {
    #[cfg(not(feature = "ferrous-framework-pyo3"))]
    {
        let _ = (config, public_framework_url);
        return Ok(FwsBridgeRuntime {
            config: FwsBridgeConfig {
                upstream_base_url: String::new(),
                child_env: HashMap::new(),
            },
        });
    }

    #[cfg(feature = "ferrous-framework-pyo3")]
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
        let run_id = env::var("FRAMEWORK_SHELLS_RUN_ID")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("{APP_ID}-fws"));
        let host = FerrousFrameworkHost::spawn(FerrousHostConfig {
            host: "127.0.0.1".to_owned(),
            port: 0,
            env: host_env,
            run_id: Some(run_id),
            python_module: None,
            python_class: None,
        })
        .context("failed to start Ferrous FWS bridge host")?;
        let upstream_base_url = host
            .url()
            .context("failed to read Ferrous FWS bridge URL")?;
        let mut child_env = host
            .child_env()
            .context("failed to read Ferrous FWS bridge child environment")?;
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
            upstream_base_url, "started Ferrous FWS bridge host"
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
    #[cfg(feature = "ferrous-framework-pyo3")]
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
    // still uses the app-group endpoint; this path calls the Ferrous host hook.
    #[cfg(feature = "ferrous-framework-pyo3")]
    if let Some(host) = runtime.host.clone() {
        match tokio::task::spawn_blocking(move || host.shutdown_tree_blocking(Vec::new())).await {
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
                "Ferrous FWS shutdown tree completed"
            ),
            Ok(Err(error)) => warn!(%error, "failed to run Ferrous FWS shutdown tree"),
            Err(error) => warn!(%error, "Ferrous FWS shutdown tree task failed"),
        }
    } else {
        warn!("Ferrous FWS bridge host is unavailable; skipping FWS shutdown tree");
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
