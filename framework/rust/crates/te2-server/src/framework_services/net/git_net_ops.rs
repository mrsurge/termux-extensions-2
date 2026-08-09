use super::super::git_ops::{self, GitSummaryError, GitSummaryRequest};
use axum::{
    Json, Router,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};

pub(crate) fn router() -> Router<crate::AppState> {
    Router::new().route("/api/git/summary", get(git_summary))
}

async fn git_summary(Query(request): Query<GitSummaryRequest>) -> Response {
    match tokio::task::spawn_blocking(move || git_ops::git_summary(request)).await {
        Ok(Ok(data)) => Json(crate::ApiResponse { ok: true, data }).into_response(),
        Ok(Err(GitSummaryError::MissingPath)) => {
            crate::json_error(StatusCode::BAD_REQUEST, "Path required")
        }
        Err(error) => {
            tracing::warn!(%error, "git summary task failed");
            Json(crate::ApiResponse {
                ok: true,
                data: serde_json::json!({ "is_repo": false, "error": "Git summary task failed" }),
            })
            .into_response()
        }
    }
}
