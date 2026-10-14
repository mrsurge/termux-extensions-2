//! Narrow HTTP compatibility, without changing MCP dispatch or retrying calls.
use axum::{
    Json,
    body::{Body, to_bytes},
    extract::Request,
    http::{Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::error::Error;

pub const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;

pub async fn compatibility(request: Request, next: Next) -> Response {
    let delete = request.method() == Method::DELETE;
    let json_post = request.method() == Method::POST
        && request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("application/json"));
    // Retain bounded bytes, not another object graph. Valid requests are decoded
    // only by rmcp; examine syntax only after its generic 415 rejection.
    let (request, captured) = if json_post {
        let (parts, body) = request.into_parts();
        let bytes = match to_bytes(body, MAX_REQUEST_BYTES).await {
            Ok(bytes) => bytes,
            Err(error) => {
                let oversized = error
                    .source()
                    .is_some_and(|source| source.is::<http_body_util::LengthLimitError>());
                return if oversized {
                    StatusCode::PAYLOAD_TOO_LARGE
                } else {
                    StatusCode::BAD_REQUEST
                }
                .into_response();
            }
        };
        (
            Request::from_parts(parts, Body::from(bytes.clone())),
            Some(bytes),
        )
    } else {
        (request, None)
    };
    let mut response = next.run(request).await;
    if delete && response.status() == StatusCode::ACCEPTED {
        *response.status_mut() = StatusCode::OK;
    } else if response.status() == StatusCode::UNSUPPORTED_MEDIA_TYPE {
        if let Some(bytes) = captured {
            if let Err(error) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if error.is_syntax() || error.is_eof() {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({
                            "jsonrpc": "2.0", "id": null,
                            "error": {"code": -32700, "message": "Parse error"}
                        })),
                    )
                        .into_response();
                }
            }
        }
    }
    response
}
