use super::super::bookmark_ops::{self, AddBookmarkRequest, Bookmark, BookmarkStore};
use axum::{
    Json, Router,
    extract::State,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use serde_json::{Value, json};

pub(crate) fn router() -> Router<crate::AppState> {
    Router::new().route(
        "/api/bookmarks",
        get(get_bookmarks).post(add_bookmark).put(update_bookmarks),
    )
}

async fn get_bookmarks(State(state): State<crate::AppState>) -> Response {
    let store = BookmarkStore::from_project_root(state.project_root());
    match tokio::task::spawn_blocking(move || bookmark_ops::list_bookmarks(&store)).await {
        Ok(Ok(bookmarks)) => ok_response(bookmarks),
        Ok(Err(error)) => error_response(format!("Failed to read bookmarks: {}", error.message())),
        Err(error) => {
            tracing::warn!(%error, "bookmark list task failed");
            error_response("Failed to read bookmarks: Bookmark task failed")
        }
    }
}

async fn add_bookmark(
    State(state): State<crate::AppState>,
    Json(request): Json<AddBookmarkRequest>,
) -> Response {
    let store = BookmarkStore::from_project_root(state.project_root());
    match tokio::task::spawn_blocking(move || bookmark_ops::add_bookmark(&store, request)).await {
        Ok(Ok(bookmarks)) => ok_response(bookmarks),
        Ok(Err(error)) if error.message() == "Name and path are required" => {
            error_response(error.message().to_owned())
        }
        Ok(Err(error)) => error_response(format!("Failed to add bookmark: {}", error.message())),
        Err(error) => {
            tracing::warn!(%error, "bookmark add task failed");
            error_response("Failed to add bookmark: Bookmark task failed")
        }
    }
}

async fn update_bookmarks(
    State(state): State<crate::AppState>,
    Json(payload): Json<Value>,
) -> Response {
    let bookmarks = match payload {
        Value::Array(_) => match serde_json::from_value::<Vec<Bookmark>>(payload) {
            Ok(bookmarks) => bookmarks,
            Err(error) => return error_response(format!("Failed to update bookmarks: {error}")),
        },
        _ => return error_response("A JSON array of bookmarks is required"),
    };

    let store = BookmarkStore::from_project_root(state.project_root());
    match tokio::task::spawn_blocking(move || bookmark_ops::replace_bookmarks(&store, bookmarks))
        .await
    {
        Ok(Ok(bookmarks)) => ok_response(bookmarks),
        Ok(Err(error)) => {
            error_response(format!("Failed to update bookmarks: {}", error.message()))
        }
        Err(error) => {
            tracing::warn!(%error, "bookmark update task failed");
            error_response("Failed to update bookmarks: Bookmark task failed")
        }
    }
}

fn ok_response<T: Serialize>(data: T) -> Response {
    Json(crate::ApiResponse { ok: true, data }).into_response()
}

fn error_response(message: impl Into<String>) -> Response {
    Json(json!({ "ok": false, "error": message.into() })).into_response()
}
