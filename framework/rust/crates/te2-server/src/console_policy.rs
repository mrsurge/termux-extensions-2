//! Runtime-only built-in logging policy. Never mutate the process environment.
use axum::{
    Json, Router,
    extract::DefaultBodyLimit,
    http::{HeaderMap, StatusCode, header},
    routing::get,
};
use serde::{Deserialize, Serialize};
use std::sync::{
    OnceLock,
    atomic::{AtomicBool, Ordering},
};

static ENABLED: OnceLock<AtomicBool> = OnceLock::new();

fn policy() -> &'static AtomicBool {
    ENABLED.get_or_init(|| AtomicBool::new(crate::launcher::console_debug_default()))
}

pub(crate) fn enabled() -> bool {
    policy().load(Ordering::Relaxed)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Update {
    enabled: bool,
}

#[derive(Serialize)]
struct Snapshot {
    enabled: bool,
    scope: &'static str,
}

type Reply = ([(header::HeaderName, &'static str); 1], Json<Snapshot>);

fn snapshot(enabled: bool) -> Reply {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(Snapshot {
            enabled,
            scope: "new_app_pages",
        }),
    )
}

async fn status() -> Reply {
    snapshot(enabled())
}

async fn update(headers: HeaderMap, Json(request): Json<Update>) -> Result<Reply, StatusCode> {
    // Require a non-simple header in addition to JSON ingress. The framework's
    // outer network-exposure policy still owns connection admission.
    if headers
        .get("x-te2-console-control")
        .and_then(|value| value.to_str().ok())
        != Some("logging")
    {
        return Err(StatusCode::FORBIDDEN);
    }
    policy().store(request.enabled, Ordering::Relaxed);
    Ok(snapshot(request.enabled))
}

pub(crate) fn router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new()
        .route("/api/console/logging", get(status).post(update))
        .layer(DefaultBodyLimit::max(1024))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;

    #[test]
    fn console_policy_update_is_strict_and_overrides_seed() {
        assert!(serde_json::from_str::<Update>(r#"{"enabled":"true"}"#).is_err());
        assert!(serde_json::from_str::<Update>(r#"{"enabled":true,"other":1}"#).is_err());
        let policy = AtomicBool::new(true);
        let request: Update = serde_json::from_str(r#"{"enabled":false}"#).unwrap();
        policy.store(request.enabled, Ordering::Relaxed);
        assert!(!policy.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn console_policy_http_admission_and_bootstrap_inheritance() {
        let app: Router = router();
        let previous = enabled();
        for (body, control, expected) in [
            (r#"{"enabled":false}"#, false, StatusCode::FORBIDDEN),
            (
                r#"{"enabled":"true"}"#,
                true,
                StatusCode::UNPROCESSABLE_ENTITY,
            ),
            (
                r#"{"enabled":true,"other":1}"#,
                true,
                StatusCode::UNPROCESSABLE_ENTITY,
            ),
        ] {
            let mut request = Request::post("/api/console/logging")
                .header(header::CONTENT_TYPE, "application/json");
            if control {
                request = request.header("x-te2-console-control", "logging");
            }
            let response = app
                .clone()
                .oneshot(request.body(Body::from(body)).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
            assert_eq!(enabled(), previous);
        }
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/console/logging")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-te2-console-control", "logging")
                    .body(Body::from(format!(r#"{{"enabled":{}}}"#, !previous)))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(crate::launcher::console_debug_enabled(), !previous);
        let response = app
            .oneshot(
                Request::get("/api/console/logging")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["enabled"], !previous);
        assert_eq!(value["scope"], "new_app_pages");
        policy().store(previous, Ordering::Relaxed);
    }
}
