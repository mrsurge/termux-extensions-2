//! Token-protected facade on the existing listener. Credentials never enter URLs.
use crate::runtime_debug_pipe::{self, DebugTarget};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use std::{
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    sync::{Arc, OnceLock},
    time::Duration,
};

static TOKEN: OnceLock<Arc<str>> = OnceLock::new();

pub(crate) fn initialize(port: u16, url: &str) -> anyhow::Result<()> {
    let enabled = std::env::var("TE2_RUNTIME_DEBUG").is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    });
    if !enabled {
        return Ok(());
    }
    let root = crate::te2_paths::Te2Paths::from_env()
        .map_err(anyhow::Error::msg)?
        .runtime_home;
    if !root.exists() {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&root)?;
    }
    let metadata = fs::symlink_metadata(&root)?;
    if !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o077 != 0
    {
        anyhow::bail!("runtime debug requires an owned private runtime directory");
    }
    let token: Arc<str> = Arc::from(format!(
        "{}{}",
        crate::new_instance_id()?,
        crate::new_instance_id()?
    ));
    let path = root.join(format!("runtime-debug-{port}.json"));
    let mut temporary = tempfile::NamedTempFile::new_in(&root)?;
    temporary
        .as_file()
        .set_permissions(fs::Permissions::from_mode(0o600))?;
    use std::io::Write;
    temporary.write_all(&serde_json::to_vec(
        &json!({"frameworkUrl": url, "token": &*token}),
    )?)?;
    temporary.as_file().sync_all()?;
    temporary.persist(&path)?;
    TOKEN
        .set(token.clone())
        .map_err(|_| anyhow::anyhow!("runtime debug already initialized"))?;
    // Do not unlink on shutdown: an overlapping replacement may have published
    // its credential. A stopped instance's token is inert and replaced at start.
    Ok(())
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({"ok": false, "error": {"code": code}}))).into_response()
}

pub(crate) struct DebugFailure {
    status: StatusCode,
    code: String,
}

impl DebugFailure {
    fn new(status: StatusCode, code: &str) -> Self {
        Self {
            status,
            code: code.to_owned(),
        }
    }
    #[cfg(any(feature = "native-mcp", test))]
    pub(crate) fn data(&self) -> serde_json::Value {
        json!({"ok": false, "error": {"code": self.code}})
    }
}

// Shared by HTTP admission and dormant MCP. Never discover or supply a caller's
// credential on their behalf; a disabled owner remains inaccessible.
fn check_credential(token: Option<&str>, given: &str) -> Result<(), DebugFailure> {
    let Some(token) = token else {
        return Err(DebugFailure::new(
            StatusCode::NOT_FOUND,
            "runtimeDebug.disabled",
        ));
    };
    if given.len() != token.len()
        || given
            .bytes()
            .zip(token.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            != 0
    {
        return Err(DebugFailure::new(
            StatusCode::UNAUTHORIZED,
            "runtimeDebug.unauthorized",
        ));
    }
    Ok(())
}

#[cfg(feature = "native-mcp")]
pub(crate) fn native_workers(credential: &str) -> serde_json::Value {
    match check_credential(TOKEN.get().map(|token| token.as_ref()), credential) {
        Ok(()) => workers_data(),
        Err(failure) => failure.data(),
    }
}

#[cfg(feature = "native-mcp")]
pub(crate) async fn native_dispatch(
    credential: &str,
    target: DebugTarget,
    code: Option<String>,
    timeout_seconds: u64,
    eval: bool,
) -> serde_json::Value {
    if let Err(failure) = check_credential(TOKEN.get().map(|token| token.as_ref()), credential) {
        return failure.data();
    }
    match dispatch_data(
        DebugRequest {
            target,
            code,
            timeout_seconds,
        },
        eval,
    )
    .await
    {
        Ok(data) => data,
        Err(failure) => failure.data(),
    }
}

#[cfg(feature = "native-mcp")]
pub(crate) async fn native_operation(
    state: &crate::AppState,
    credential: &str,
    target: DebugTarget,
    capability: &str,
    params: serde_json::Value,
    timeout_seconds: u64,
) -> serde_json::Value {
    if let Err(failure) = check_credential(TOKEN.get().map(|token| token.as_ref()), credential) {
        return failure.data();
    }
    let result = async {
        anyhow::ensure!(
            (1..=30).contains(&timeout_seconds),
            "runtimeDebug.invalidTimeout"
        );
        let registry = state.app_registry_snapshot();
        let app = registry
            .get_app(&target.app_id)
            .filter(|app| app.enabled && app.app_id == target.app_id)
            .ok_or_else(|| anyhow::anyhow!("appCapability.targetUnavailable"))?;
        let policy = crate::app_policy::AppPolicy::read(app)?;
        let method = policy
            .capabilities
            .get(capability)
            .ok_or_else(|| anyhow::anyhow!("appCapability.notDeclared"))?;
        crate::runtime_debug_pipe::operation(
            &target,
            method,
            params,
            Duration::from_secs(timeout_seconds),
        )
        .await
    }
    .await;
    match result {
        Ok(frame) => json!({"ok":frame.error.is_none(), "data":frame.result, "error":frame.error}),
        Err(error) => json!({"ok":false, "error":{"code":error.to_string()}}),
    }
}

async fn authorize(
    State(token): State<Option<Arc<str>>>,
    request: Request,
    next: Next,
) -> Response {
    let Some(token) = token else {
        return error(StatusCode::NOT_FOUND, "runtimeDebug.disabled");
    };
    if !authorized(request.headers(), &token) {
        return error(StatusCode::UNAUTHORIZED, "runtimeDebug.unauthorized");
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert("cache-control", "no-store".parse().unwrap());
    response
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let Some(given) = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    check_credential(Some(token), given).is_ok()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DebugRequest {
    target: DebugTarget,
    timeout_seconds: u64,
    code: Option<String>,
}

async fn workers() -> Json<serde_json::Value> {
    Json(workers_data())
}

fn workers_data() -> serde_json::Value {
    json!({"ok": true, "data": runtime_debug_pipe::targets()})
}

async fn status(Json(request): Json<DebugRequest>) -> Response {
    dispatch(request, false).await
}
async fn evaluate(Json(request): Json<DebugRequest>) -> Response {
    dispatch(request, true).await
}
async fn dispatch(request: DebugRequest, eval: bool) -> Response {
    match dispatch_data(request, eval).await {
        Ok(data) => Json(data).into_response(),
        Err(failure) => error(failure.status, &failure.code),
    }
}

async fn dispatch_data(
    request: DebugRequest,
    eval: bool,
) -> Result<serde_json::Value, DebugFailure> {
    if request.timeout_seconds == 0 || request.timeout_seconds > 30 {
        return Err(DebugFailure::new(
            StatusCode::BAD_REQUEST,
            "runtimeDebug.invalidTimeout",
        ));
    }
    let wait = Duration::from_secs(request.timeout_seconds);
    let result = if eval {
        let Some(code) = request.code else {
            return Err(DebugFailure::new(
                StatusCode::BAD_REQUEST,
                "runtimeDebug.invalidCode",
            ));
        };
        runtime_debug_pipe::evaluate(&request.target, code, wait).await
    } else {
        runtime_debug_pipe::status(&request.target, wait).await
    };
    match result {
        Ok(frame) => {
            Ok(json!({"ok": frame.error.is_none(), "data": frame.result, "error": frame.error}))
        }
        Err(failure) => Err(DebugFailure::new(
            StatusCode::CONFLICT,
            &failure.to_string(),
        )),
    }
}

fn routes(token: Option<Arc<str>>) -> Router {
    Router::new()
        .route("/api/runtime-debug/workers", get(workers))
        .route("/api/runtime-debug/status", post(status))
        .route("/api/runtime-debug/eval", post(evaluate))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .route_layer(middleware::from_fn_with_state(token, authorize))
}

pub(crate) fn router() -> Router<crate::AppState> {
    routes(TOKEN.get().cloned()).with_state(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;

    #[test]
    fn shared_credential_gate_never_promotes_implicit_credentials() {
        assert_eq!(
            check_credential(None, "secret").err().unwrap().data()["error"]["code"],
            "runtimeDebug.disabled"
        );
        for given in ["", "wrong!", "secre", "secret "] {
            assert_eq!(
                check_credential(Some("secret"), given)
                    .err()
                    .unwrap()
                    .data()["error"]["code"],
                "runtimeDebug.unauthorized"
            );
        }
        assert!(check_credential(Some("secret"), "secret").is_ok());
    }

    #[tokio::test]
    async fn shared_dispatch_bounds_and_missing_target_fail_without_retry() {
        let target = DebugTarget {
            app_id: "fixture".into(),
            shell_id: "missing".into(),
            instance_id: "missing".into(),
        };
        for (timeout_seconds, code, expected) in [
            (0, Some("1".to_owned()), "runtimeDebug.invalidTimeout"),
            (31, Some("1".to_owned()), "runtimeDebug.invalidTimeout"),
            (20, None, "runtimeDebug.invalidCode"),
            (20, Some(" ".into()), "runtimeDebug.invalidCode"),
            (20, Some("é".repeat(16385)), "runtimeDebug.invalidCode"),
        ] {
            let result = dispatch_data(
                DebugRequest {
                    target: target.clone(),
                    timeout_seconds,
                    code,
                },
                true,
            )
            .await;
            assert_eq!(result.err().unwrap().data()["error"]["code"], expected);
        }
        let result = dispatch_data(
            DebugRequest {
                target,
                timeout_seconds: 20,
                code: None,
            },
            false,
        )
        .await;
        assert!(result.is_err()); // No registered fixture identity; never a fallback target.
    }
    #[tokio::test]
    async fn disabled_and_missing_credentials_fail_closed() {
        for (token, expected) in [
            (None, StatusCode::NOT_FOUND),
            (Some(Arc::from("secret")), StatusCode::UNAUTHORIZED),
        ] {
            let response = routes(token)
                .oneshot(
                    Request::builder()
                        .uri("/api/runtime-debug/workers")
                        .body(axum::body::Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
    }
    #[tokio::test]
    async fn valid_credentials_allow_discovery() {
        let response = routes(Some(Arc::from("secret")))
            .oneshot(
                Request::builder()
                    .uri("/api/runtime-debug/workers")
                    .header("authorization", "Bearer secret")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn wrong_token_and_invalid_bounds_are_rejected() {
        for (token, body, expected) in [
            ("wrong", "not json".to_owned(), StatusCode::UNAUTHORIZED),
            ("secret", json!({"target": {"appId":"a", "shellId":"s", "instanceId":"i"}, "timeoutSeconds":0}).to_string(), StatusCode::BAD_REQUEST),
            ("secret", " ".repeat(256 * 1024 + 1), StatusCode::PAYLOAD_TOO_LARGE),
        ] {
            let response = routes(Some(Arc::from("secret"))).oneshot(Request::builder().method("POST").uri("/api/runtime-debug/eval").header("authorization", format!("Bearer {token}")).header("content-type", "application/json").body(axum::body::Body::from(body)).unwrap()).await.unwrap();
            assert_eq!(response.status(), expected);
        }
    }
}
