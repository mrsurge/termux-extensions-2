use axum::{
    Router,
    body::Bytes,
    extract::ws::{WebSocketUpgrade, rejection::WebSocketUpgradeRejection},
    extract::{OriginalUri, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get},
};

use crate::{
    AppState, json_error,
    proxy_transport::{absolute_upstream_url, bridge_websocket, proxy_absolute_bridge_request},
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
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
        .route("/api/framework_shells", any(proxy_fws_request))
        .route("/api/framework_shells/", any(proxy_fws_request))
        .route("/api/framework_shells/{*rest}", any(proxy_fws_request))
        // Runtime-owned console/MCP surfaces stay Python-sidecar-backed for now.
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
        state.fws_upstream_base_url(),
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
        state.http_client(),
        state.te2_runtime_upstream_base_url(),
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
        state.http_client(),
        state.te2_runtime_upstream_base_url(),
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
        state.http_client(),
        state.te2_runtime_upstream_base_url(),
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
        state.http_client(),
        state.fws_upstream_base_url(),
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

fn normalize_mcp_mount_path(path: &str, mount_root: &str) -> String {
    if path == mount_root {
        return format!("{mount_root}/");
    }
    path.to_owned()
}
