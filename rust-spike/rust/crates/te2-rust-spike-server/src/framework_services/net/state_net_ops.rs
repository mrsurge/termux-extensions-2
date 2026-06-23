use super::super::state_ops::{
    self, StateDeleteRequest, StateError, StateReadRequest, StateStore, StateWriteRequest,
};
use axum::{
    Json, Router,
    extract::OriginalUri,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use url::form_urlencoded;

pub(super) fn router() -> Router<crate::AppState> {
    Router::new().route(
        "/api/state",
        get(get_state).post(post_state).delete(delete_state),
    )
}

async fn get_state(uri: OriginalUri) -> Response {
    let request = StateReadRequest {
        keys: state_keys_from_query(uri.0.query()),
    };
    match state_ops::get_state(&StateStore::default(), request) {
        Ok(data) => Json(crate::ApiResponse { ok: true, data }).into_response(),
        Err(error) => state_error_response(error),
    }
}

async fn post_state(Json(request): Json<StateWriteRequest>) -> Response {
    match tokio::task::spawn_blocking(move || state_ops::set_state(&StateStore::default(), request))
        .await
    {
        Ok(Ok(data)) => Json(crate::ApiResponse { ok: true, data }).into_response(),
        Ok(Err(error)) => state_error_response(error),
        Err(error) => {
            tracing::warn!(%error, "state write task failed");
            crate::json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to persist state")
        }
    }
}

async fn delete_state(uri: OriginalUri) -> Response {
    let request = StateDeleteRequest {
        keys: state_keys_from_query(uri.0.query()),
    };
    match tokio::task::spawn_blocking(move || {
        state_ops::delete_state(&StateStore::default(), request)
    })
    .await
    {
        Ok(Ok(data)) => Json(crate::ApiResponse { ok: true, data }).into_response(),
        Ok(Err(error)) => state_error_response(error),
        Err(error) => {
            tracing::warn!(%error, "state delete task failed");
            crate::json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to persist state")
        }
    }
}

fn state_error_response(error: StateError) -> Response {
    match error {
        StateError::MissingKey => crate::json_error(
            StatusCode::BAD_REQUEST,
            "query parameter \"key\" is required",
        ),
        StateError::EmptyKey => crate::json_error(
            StatusCode::BAD_REQUEST,
            "\"key\" must be a non-empty string",
        ),
        StateError::Io(error) => crate::json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to persist state: {error}"),
        ),
    }
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
