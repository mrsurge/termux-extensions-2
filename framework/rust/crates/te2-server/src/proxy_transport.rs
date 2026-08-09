use axum::{
    body::{Body, Bytes},
    extract::ws::{Message, WebSocket, WebSocketUpgrade, rejection::WebSocketUpgradeRejection},
    http::{HeaderMap, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message as UpstreamWsMessage, client::IntoClientRequest},
};
use tracing::warn;
use url::Url;

use crate::json_error;

pub(crate) async fn proxy_absolute_bridge_request(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    http_client: &reqwest::Client,
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
        proxy_streaming_http_request(http_client, method, headers, body, upstream, Vec::new()).await
    } else {
        proxy_http_request(http_client, method, headers, body, upstream, Vec::new()).await
    }
}

pub(crate) async fn proxy_http_request(
    http_client: &reqwest::Client,
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
    let mut request = http_client.request(reqwest_method, upstream_url.clone());
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

pub(crate) async fn proxy_streaming_http_request(
    http_client: &reqwest::Client,
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
    let mut request = http_client.request(reqwest_method, upstream_url.clone());
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

pub(crate) async fn bridge_websocket(
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

pub(crate) fn upstream_url(
    scheme: &str,
    host: &str,
    port: u16,
    path: &str,
    query: Option<&str>,
) -> String {
    let mut url = format!("{scheme}://{host}:{port}{path}");
    if let Some(query) = query.filter(|value| !value.is_empty()) {
        url.push('?');
        url.push_str(query);
    }
    url
}

pub(crate) fn absolute_upstream_url(
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

pub(crate) fn should_forward_request_header(name: &str) -> bool {
    // Header filtering is shared by dynamic proxy routes so websocket and
    // Socket.IO aliases reuse the same transport boundary.
    !is_hop_by_hop_header(name) && !name.eq_ignore_ascii_case("host")
}

pub(crate) fn should_forward_response_header(name: &str) -> bool {
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
