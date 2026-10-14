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
    let router = Router::new()
        // The framework keeps the FWS dashboard and peer socket on its own public
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
        // Only the console relay remains Python-sidecar-owned.
        .route("/te2_console_ws/socket.io", any(proxy_te2_console_request))
        .route("/te2_console_ws/socket.io/", any(proxy_te2_console_request))
        .route(
            "/te2_console_ws/socket.io/{*rest}",
            any(proxy_te2_console_request),
        )
        .merge(retired_mcp_router());
    #[cfg(not(feature = "native-mcp"))]
    let router = router
        .route("/te2_mcp_http", any(native_mcp_disabled))
        .route("/te2_mcp_http/", any(native_mcp_disabled))
        .route("/te2_mcp_http/{*rest}", any(native_mcp_disabled));
    router
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

async fn retired_mcp() -> Response {
    (
        StatusCode::GONE,
        axum::Json(serde_json::json!({
            "error": "Legacy HTTP+SSE MCP transport has been retired.",
            "endpoint": "/te2_mcp_http",
            "transport": "streamable-http"
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn legacy_mcp_is_retired_without_upstream_or_state() {
        for path in [
            "/te2_mcp",
            "/te2_mcp/",
            "/te2_mcp/sse",
            "/te2_mcp/messages?session_id=old",
        ] {
            for method in [Method::GET, Method::POST, Method::DELETE] {
                let response = retired_mcp_router::<()>()
                    .oneshot(
                        Request::builder()
                            .method(method)
                            .uri(path)
                            .body(Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::GONE);
                let data: serde_json::Value =
                    serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap())
                        .unwrap();
                assert_eq!(data["endpoint"], "/te2_mcp_http");
                assert_eq!(data["transport"], "streamable-http");
            }
        }
    }
}

fn retired_mcp_router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new()
        .route("/te2_mcp", any(retired_mcp))
        .route("/te2_mcp/", any(retired_mcp))
        .route("/te2_mcp/{*rest}", any(retired_mcp))
}

#[cfg(not(feature = "native-mcp"))]
async fn native_mcp_disabled() -> Response {
    json_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "This framework was built without native-mcp; no Python MCP fallback is supported.",
    )
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
