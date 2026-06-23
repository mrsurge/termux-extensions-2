use super::super::fs_ops::{self, BrowseError, BrowseRequest};
use axum::{
    Json, Router,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};

pub(crate) fn router() -> Router<crate::AppState> {
    Router::new().route("/api/browse", get(browse))
}

async fn browse(Query(request): Query<BrowseRequest>) -> Response {
    match tokio::task::spawn_blocking(move || fs_ops::browse(request)).await {
        Ok(Ok(data)) => Json(crate::ApiResponse { ok: true, data }).into_response(),
        Ok(Err(error)) => browse_error_response(error),
        Err(error) => {
            tracing::warn!(%error, "browse task failed");
            crate::json_error(StatusCode::INTERNAL_SERVER_ERROR, "Browse task failed")
        }
    }
}

fn browse_error_response(error: BrowseError) -> Response {
    match error {
        BrowseError::AccessDenied => crate::json_error(StatusCode::BAD_REQUEST, "Access denied"),
        BrowseError::UnsupportedSudo => crate::json_error(
            StatusCode::NOT_IMPLEMENTED,
            "sudo browse is not implemented in the Rust spike.",
        ),
        BrowseError::Io(error) => match error.kind() {
            std::io::ErrorKind::NotFound => {
                crate::json_error(StatusCode::NOT_FOUND, "Directory not found")
            }
            std::io::ErrorKind::PermissionDenied => {
                crate::json_error(StatusCode::FORBIDDEN, &error.to_string())
            }
            _ => crate::json_error(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
        },
    }
}
