use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::ws::{WebSocketUpgrade, rejection::WebSocketUpgradeRejection},
    extract::{OriginalUri, Path, State},
    http::{HeaderMap, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::{any, get},
};
use tracing::warn;

use crate::{
    ApiResponse, AppState, apps_lifecycle, json_error,
    proxy_shell::{
        parse_proxy_shell, proxy_shell_upstream_path, proxy_shell_urls,
        rewrite_payload as rewrite_proxy_shell_payload,
        should_rewrite as should_rewrite_proxy_shell,
    },
    proxy_transport::{
        bridge_websocket, proxy_http_request, should_forward_request_header,
        should_forward_response_header, upstream_url,
    },
    registry::AppRegistry,
    sio_proxy::{MatchedSioRoute, SioRouteIndex, SioTarget, join_upstream_path},
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/apps/{app_id}/proxy_shell", get(proxy_shell_meta))
        // Proxy-shell routes must win before the generic app proxy catches the
        // same `/api/app/{app_id}/...` prefix.
        .route("/api/app/{app_id}/proxy", any(proxy_shell_root_request))
        .route("/api/app/{app_id}/proxy/", any(proxy_shell_root_request))
        .route("/api/app/{app_id}/proxy/{*rest}", any(proxy_shell_request))
        // Dynamic app-worker proxy. These routes do not start apps.
        .route("/ws/app/{app_id}/{*route}", get(proxy_app_websocket))
        .route("/api/app/{app_id}", any(proxy_app_root_request))
        .route("/api/app/{app_id}/{*subpath}", any(proxy_app_request))
}

pub(crate) fn register_sio_proxy_routes(
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

async fn proxy_shell_meta(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    let registry = AppRegistry::load(state.app_roots());
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

async fn proxy_app_websocket(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path((app_id, route)): Path<(String, String)>,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    let registry = AppRegistry::load(state.app_roots());
    let Some(running_app) = apps_lifecycle::running_app_for_id(&registry, &app_id) else {
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
    let registry = AppRegistry::load(state.app_roots());
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
    let Some(running_app) = apps_lifecycle::running_app_for_id(&registry, &app_id) else {
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
        .http_client()
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

    let registry = AppRegistry::load(state.app_roots());
    let Some(running_app) = apps_lifecycle::running_app_for_id(&registry, &app_id) else {
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
        .http_client()
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
    let Some(matched) = state.sio_routes().match_path(original_uri.path()) else {
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
    proxy_http_request(
        state.http_client(),
        method,
        headers,
        body,
        upstream,
        Vec::new(),
    )
    .await
}

fn resolve_sio_upstream(state: &AppState, matched: &MatchedSioRoute) -> Option<(String, u16)> {
    match matched.route.target {
        SioTarget::Static => Some((matched.route.host.clone(), matched.route.port?)),
        SioTarget::AppWorker => {
            let registry = AppRegistry::load(state.app_roots());
            let running = apps_lifecycle::running_app_for_id(&registry, &matched.route.app_id)?;
            Some(("127.0.0.1".to_owned(), running.port))
        }
    }
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

fn json_error_with_headers(
    status: StatusCode,
    error: &str,
    headers: &[(&'static str, String)],
) -> Response {
    let body = Body::from(serde_json::json!({ "ok": false, "error": error }).to_string());
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
