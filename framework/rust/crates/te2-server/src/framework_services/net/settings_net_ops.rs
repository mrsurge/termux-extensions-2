use super::super::settings_ops::{self, SettingsMap, SettingsStore};
use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};

pub(super) fn router() -> Router<crate::AppState> {
    Router::new()
        .route("/api/settings", get(get_settings).post(post_settings))
        .route("/api/android/config", get(android_config))
}

async fn get_settings() -> Json<crate::ApiResponse<SettingsMap>> {
    Json(crate::ApiResponse {
        ok: true,
        data: settings_ops::load_settings(&SettingsStore::default()),
    })
}

async fn post_settings(Json(payload): Json<SettingsMap>) -> Response {
    match tokio::task::spawn_blocking(move || {
        settings_ops::save_settings(&SettingsStore::default(), payload)
    })
    .await
    {
        Ok(Ok(data)) => Json(crate::ApiResponse { ok: true, data }).into_response(),
        Ok(Err(error)) => crate::json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to save settings: {error}"),
        ),
        Err(error) => {
            tracing::warn!(%error, "settings save task failed");
            crate::json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save settings")
        }
    }
}

async fn android_config() -> Json<crate::ApiResponse<settings_ops::AndroidConfigData>> {
    Json(crate::ApiResponse {
        ok: true,
        data: settings_ops::android_config(&SettingsStore::default()),
    })
}
