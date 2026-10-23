//! Private read-only selector client used by atomic app catalog refresh.

use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::Duration,
};

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SelectionStatus {
    Ready,
    BuildRequired,
    PreparationRequired,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WorkerSelection {
    pub app_id: String,
    pub environment_key: String,
    pub declaration: String,
    pub status: SelectionStatus,
    pub executable: Option<String>,
    pub fingerprint: Option<String>,
    pub environment: HashMap<String, String>,
    pub remove_environment: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SelectionSnapshot {
    pub schema_version: u8,
    pub profile: String,
    pub packaged: bool,
    pub generation: String,
    pub workers: Vec<WorkerSelection>,
}

fn digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn environment_key(value: &str) -> bool {
    value
        .bytes()
        .next()
        .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

pub(crate) fn decode(data: &[u8]) -> Result<SelectionSnapshot> {
    ensure!(
        data.len() <= MAX_RESPONSE_BYTES,
        "native selection response exceeds limit"
    );
    let snapshot: SelectionSnapshot = serde_json::from_slice(data)?;
    ensure!(
        snapshot.schema_version == 1,
        "unsupported native selection schema"
    );
    ensure!(
        ["release", "debug", "memory"].contains(&snapshot.profile.as_str()),
        "invalid native profile"
    );
    ensure!(digest(&snapshot.generation), "invalid native generation");
    let mut ids = HashSet::new();
    let mut keys = HashSet::new();
    for worker in &snapshot.workers {
        ensure!(
            !worker.app_id.is_empty()
                && worker
                    .app_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
            "invalid native app identity"
        );
        ensure!(
            ids.insert(&worker.app_id) && keys.insert(&worker.environment_key),
            "duplicate native selection identity/export"
        );
        ensure!(
            environment_key(&worker.environment_key) && digest(&worker.declaration),
            "invalid native declaration/export"
        );
        ensure!(
            worker
                .fingerprint
                .as_deref()
                .is_none_or(|v| v.len() == 24 && v.bytes().all(|b| b.is_ascii_hexdigit())),
            "invalid native fingerprint"
        );
        if worker.status == SelectionStatus::Ready {
            ensure!(
                worker
                    .executable
                    .as_ref()
                    .is_some_and(|p| Path::new(p).is_absolute()),
                "ready native selection lacks absolute executable"
            );
        }
        ensure!(
            worker
                .environment
                .iter()
                .all(|(key, value)| environment_key(key) && !value.contains('\0'))
                && worker
                    .remove_environment
                    .iter()
                    .all(|key| environment_key(key)),
            "invalid native environment"
        );
    }
    Ok(snapshot)
}

pub(crate) struct NativeSelectionClient {
    client: reqwest::Client,
    endpoint: url::Url,
    key: String,
}

impl NativeSelectionClient {
    pub fn new(base: &str, key: &str) -> Result<Self> {
        let mut endpoint = url::Url::parse(base)?;
        ensure!(
            endpoint.scheme() == "http"
                && endpoint.username().is_empty()
                && endpoint.password().is_none()
                && endpoint.query().is_none()
                && endpoint.fragment().is_none()
                && endpoint.path() == "/",
            "invalid private native owner URL"
        );
        ensure!(
            matches!(endpoint.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
                || matches!(endpoint.host(), Some(url::Host::Ipv6(ip)) if ip.is_loopback()),
            "native owner must be numeric loopback"
        );
        ensure!(!key.is_empty(), "native owner capability is missing");
        endpoint.set_path("/internal/native-runtime/select");
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            client,
            endpoint,
            key: key.into(),
        })
    }

    pub async fn select(&self) -> Result<SelectionSnapshot> {
        let mut response = self
            .client
            .post(self.endpoint.clone())
            .header("x-te2-owner-key", &self.key)
            .header("content-type", "application/json")
            .body(r#"{"schema_version":1}"#)
            .send()
            .await
            .context("native selection owner unavailable")?;
        ensure!(
            response.status() == reqwest::StatusCode::OK,
            "native selection owner rejected request ({})",
            response.status()
        );
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                bail!("native selection response exceeds limit");
            }
            body.extend_from_slice(&chunk);
        }
        decode(&body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn owner_admission_is_private_and_explicit() {
        for url in [
            "https://127.0.0.1",
            "http://localhost",
            "http://192.0.2.1",
            "http://user@127.0.0.1",
            "http://127.0.0.1/path",
        ] {
            assert!(NativeSelectionClient::new(url, "key").is_err());
        }
        assert!(NativeSelectionClient::new("http://127.0.0.1:1234", "").is_err());
        assert!(NativeSelectionClient::new("http://[::1]:1234", "key").is_ok());
    }

    #[test]
    fn selection_schema_rejects_ambiguity_and_malformed_ready() {
        let worker = json!({"app_id":"alpha","environment_key":"ALPHA_BIN", "declaration":"a".repeat(64),
            "status":"ready", "executable":"/cache/alpha", "fingerprint":"b".repeat(24), "environment":{}, "remove_environment":[]});
        let mut snapshot = json!({"schema_version":1,"profile":"release","packaged":false,
            "generation":"c".repeat(64),"workers":[worker.clone()]});
        assert!(decode(&serde_json::to_vec(&snapshot).unwrap()).is_ok());
        snapshot["workers"][0]["executable"] = json!("relative/path");
        assert!(decode(&serde_json::to_vec(&snapshot).unwrap()).is_err());
        snapshot["workers"] = json!([worker.clone(), worker]);
        assert!(decode(&serde_json::to_vec(&snapshot).unwrap()).is_err());
        snapshot["workers"] = json!([]);
        snapshot["schema_version"] = json!(2);
        assert!(decode(&serde_json::to_vec(&snapshot).unwrap()).is_err());
    }

    #[tokio::test]
    async fn private_http_exchange_does_not_follow_redirects() {
        use axum::{
            Router,
            http::{HeaderMap, StatusCode},
            routing::post,
        };
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let app = Router::new().route(
            "/internal/native-runtime/select",
            post(move |headers: HeaderMap, body: String| async move {
                assert_eq!(headers["x-te2-owner-key"], "test-capability");
                assert_eq!(
                    serde_json::from_str::<serde_json::Value>(&body).unwrap(),
                    json!({"schema_version":1})
                );
                observed.fetch_add(1, Ordering::SeqCst);
                (
                    StatusCode::TEMPORARY_REDIRECT,
                    [("location", "/must-not-follow")],
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = NativeSelectionClient::new(&base, "test-capability").unwrap();
        assert!(client.select().await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        server.abort();
    }
}
