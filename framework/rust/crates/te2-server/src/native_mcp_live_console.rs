//! Explicit service-owner bridge, never a Python/FastMCP tool forwarder.
use serde_json::Value;
use std::{net::IpAddr, sync::OnceLock, time::Duration};

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
const MAX_RESPONSE: usize = 16 * 1024 * 1024;

pub(crate) async fn request(
    base: &str,
    key: &str,
    payload: Option<Value>,
    timeout: f64,
) -> Result<Value, String> {
    request_owner(
        base,
        key,
        if payload.is_some() {
            "/internal/console/eval"
        } else {
            "/internal/console/workers"
        },
        payload,
        timeout,
    )
    .await
}

pub(crate) async fn request_owner(
    base: &str,
    key: &str,
    path: &str,
    payload: Option<Value>,
    timeout: f64,
) -> Result<Value, String> {
    if !matches!(
        path,
        "/internal/console/workers"
            | "/internal/console/eval"
            | "/internal/scaffold/templates"
            | "/internal/scaffold/validate"
            | "/internal/scaffold/create"
            | "/internal/fws-log/project"
    ) {
        return Err("Unsupported private owner operation".into());
    }
    let base = url::Url::parse(base).map_err(|_| "Invalid console owner URL")?;
    if base.scheme() != "http"
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
        || !base
            .host_str()
            .and_then(|host| host.trim_matches(['[', ']']).parse::<IpAddr>().ok())
            .is_some_and(|ip| ip.is_loopback())
        || key.is_empty()
    {
        return Err("Console owner requires loopback URL and private capability".into());
    }
    let client = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .expect("static console client configuration")
    });
    let endpoint = base
        .join(path)
        .map_err(|_| "Invalid console owner endpoint")?;
    let request = match payload {
        Some(payload) => client
            .post(endpoint)
            .header("content-type", "application/json")
            .body(payload.to_string()),
        None => client.get(endpoint),
    }
    .header("x-te2-owner-key", key);
    let wait = Duration::try_from_secs_f64(timeout.max(0.0) + 5.0)
        .map_err(|_| "Invalid console timeout")?;
    // Exactly one submission. A timeout/disconnect is not permission to replay JS.
    let mut response = request
        .timeout(wait)
        .send()
        .await
        .map_err(|error| format!("Console owner request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Console owner rejected request ({})",
            response.status()
        ));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Console owner response failed: {error}"))?
    {
        if body.len() + chunk.len() > MAX_RESPONSE {
            return Err("Console owner response exceeds bound".into());
        }
        body.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&body).map_err(|_| "Invalid console owner response")?;
    if !value.is_object() {
        return Err("Console owner response must be an object".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    #[tokio::test]
    async fn owner_wire_uses_private_capability_exact_payload_and_single_submission() {
        use axum::{
            Json, Router,
            extract::State,
            http::{HeaderMap, StatusCode},
            response::IntoResponse,
            routing::post,
        };
        async fn endpoint(
            State(count): State<Arc<AtomicUsize>>,
            headers: HeaderMap,
            Json(body): Json<Value>,
        ) -> axum::response::Response {
            count.fetch_add(1, Ordering::SeqCst);
            if headers.get("x-te2-owner-key").and_then(|v| v.to_str().ok()) != Some("fixture-key") {
                return StatusCode::UNAUTHORIZED.into_response();
            }
            Json(body).into_response()
        }
        let count = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/internal/console/eval", post(endpoint))
            .with_state(count.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let body = serde_json::json!({"target_worker_id":"fixture","code":"'\\\"\né","timeout_seconds":20});
        assert_eq!(
            request(&base, "fixture-key", Some(body.clone()), 20.0)
                .await
                .unwrap(),
            body
        );
        assert!(request(&base, "wrong", Some(body), 20.0).await.is_err());
        assert_eq!(count.load(Ordering::SeqCst), 2);
        server.abort();
        let _ = server.await;
    }
    #[tokio::test]
    async fn rejects_nonlocal_or_implicit_authority_before_connecting() {
        for base in [
            "https://127.0.0.1:1",
            "http://example.com",
            "http://user:password@127.0.0.1",
            "http://127.0.0.1?token=x",
        ] {
            assert!(request(base, "key", None, 20.0).await.is_err());
        }
        assert!(request("http://127.0.0.1:1", "", None, 20.0).await.is_err());
    }
}
