use anyhow::{Context, Result};
use axum::{
    Json,
    extract::{ConnectInfo, Request, State, connect_info::Connected},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    serve::IncomingStream,
};
use ipnet::IpNet;
use serde::Deserialize;
use serde_json::json;
use std::{env, net::IpAddr, net::SocketAddr};
use tokio::net::TcpListener;
use tracing::warn;

const POLICY_ENV: &str = "TE2_RUST_SPIKE_NETWORK_POLICY";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct NetworkConnectionInfo {
    pub(crate) peer_addr: SocketAddr,
    pub(crate) local_addr: Option<SocketAddr>,
}

impl Connected<IncomingStream<'_, TcpListener>> for NetworkConnectionInfo {
    fn connect_info(target: IncomingStream<'_, TcpListener>) -> Self {
        Self {
            peer_addr: *target.remote_addr(),
            local_addr: target.io().local_addr().ok(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NetworkExposurePolicy {
    allow_all: bool,
    source_networks: Vec<IpNet>,
    local_addresses: Vec<IpAddr>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NetworkExposurePolicyDocument {
    #[serde(default)]
    allow_all: bool,
    #[serde(default)]
    source_networks: Vec<String>,
    #[serde(default)]
    local_addresses: Vec<String>,
}

impl NetworkExposurePolicy {
    pub(crate) fn from_env() -> Result<Self> {
        match env::var(POLICY_ENV) {
            Ok(raw) => Self::from_json(&raw),
            Err(env::VarError::NotPresent) => Ok(Self::loopback_only()),
            Err(error) => Err(error).context(format!("failed to read {POLICY_ENV}")),
        }
    }

    fn from_json(raw: &str) -> Result<Self> {
        let document: NetworkExposurePolicyDocument = serde_json::from_str(raw)
            .with_context(|| format!("{POLICY_ENV} must be a valid network policy object"))?;
        let source_networks = document
            .source_networks
            .into_iter()
            .map(|value| {
                value
                    .parse::<IpNet>()
                    .with_context(|| format!("invalid source network in {POLICY_ENV}: {value}"))
            })
            .collect::<Result<Vec<_>>>()?;
        let local_addresses = document
            .local_addresses
            .into_iter()
            .map(|value| {
                value
                    .parse::<IpAddr>()
                    .with_context(|| format!("invalid local address in {POLICY_ENV}: {value}"))
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            allow_all: document.allow_all,
            source_networks,
            local_addresses,
        })
    }

    fn loopback_only() -> Self {
        Self {
            allow_all: false,
            source_networks: Vec::new(),
            local_addresses: Vec::new(),
        }
    }

    pub(crate) fn allows_connection(&self, connection: NetworkConnectionInfo) -> bool {
        let peer_ip = normalize_ip(connection.peer_addr.ip());
        if peer_ip.is_loopback() || self.allow_all {
            return true;
        }
        if self
            .source_networks
            .iter()
            .any(|network| network.contains(&peer_ip))
        {
            return true;
        }
        let Some(local_addr) = connection.local_addr else {
            return false;
        };
        let local_ip = normalize_ip(local_addr.ip());
        self.local_addresses
            .iter()
            .copied()
            .map(normalize_ip)
            .any(|allowed| allowed == local_ip)
    }
}

fn normalize_ip(address: IpAddr) -> IpAddr {
    match address {
        IpAddr::V6(value) => value
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(value)),
        value => value,
    }
}

pub(crate) async fn enforce_network_exposure(
    State(policy): State<NetworkExposurePolicy>,
    request: Request,
    next: Next,
) -> Response {
    let connection = request
        .extensions()
        .get::<ConnectInfo<NetworkConnectionInfo>>()
        .map(|ConnectInfo(connection)| *connection);
    let Some(connection) = connection else {
        warn!(path = %request.uri(), "blocked framework request without connection metadata");
        return forbidden("Missing client connection information");
    };
    if !policy.allows_connection(connection) {
        warn!(
            peer = %connection.peer_addr,
            local = ?connection.local_addr,
            path = %request.uri(),
            "blocked framework request by network exposure policy"
        );
        return forbidden("Access denied");
    }
    next.run(request).await
}

fn forbidden(error: &'static str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "ok": false, "error": error })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        body::Body,
        http::{Request as HttpRequest, header},
        middleware,
        routing::get,
    };
    use socketioxide::SocketIo;
    use tower::ServiceExt;

    fn connection(peer: &str, local: &str) -> NetworkConnectionInfo {
        NetworkConnectionInfo {
            peer_addr: peer.parse().unwrap(),
            local_addr: Some(local.parse().unwrap()),
        }
    }

    fn filtered_policy() -> NetworkExposurePolicy {
        NetworkExposurePolicy::from_json(
            r#"{
                "allowAll": false,
                "sourceNetworks": ["192.168.50.0/24", "fd7a:115c:a1e0::/48"],
                "localAddresses": ["100.108.128.8", "fd00::8"]
            }"#,
        )
        .unwrap()
    }

    fn request(uri: &str, connection: NetworkConnectionInfo) -> HttpRequest<Body> {
        let mut request = HttpRequest::builder().uri(uri).body(Body::empty()).unwrap();
        request.extensions_mut().insert(ConnectInfo(connection));
        request
    }

    fn protocol_router(policy: NetworkExposurePolicy) -> Router {
        Router::new()
            .route("/http", get(|| async { "http" }))
            .route(
                "/events",
                get(|| async {
                    (
                        [(header::CONTENT_TYPE, "text/event-stream")],
                        "data: ok\n\n",
                    )
                }),
            )
            .route("/ws", get(|| async { "upgrade accepted" }))
            .layer(middleware::from_fn_with_state(
                policy,
                enforce_network_exposure,
            ))
    }

    #[test]
    fn policy_accepts_loopback_source_networks_and_selected_local_interfaces() {
        let policy = filtered_policy();
        assert!(policy.allows_connection(connection("127.0.0.1:41000", "127.0.0.1:8089")));
        assert!(policy.allows_connection(connection("192.168.50.42:41000", "10.0.0.8:8089")));
        assert!(
            policy.allows_connection(connection("[fd7a:115c:a1e0::42]:41000", "[fd00::9]:8089"))
        );
        assert!(policy.allows_connection(connection("203.0.113.9:41000", "100.108.128.8:8089")));
        assert!(!policy.allows_connection(connection("203.0.113.9:41000", "192.168.1.9:8089")));
    }

    #[test]
    fn policy_normalizes_ipv4_mapped_ipv6_addresses() {
        let policy = filtered_policy();
        assert!(policy.allows_connection(connection(
            "[::ffff:192.168.50.42]:41000",
            "[::ffff:10.0.0.8]:8089"
        )));
        assert!(policy.allows_connection(connection(
            "[::ffff:203.0.113.9]:41000",
            "[::ffff:100.108.128.8]:8089"
        )));
    }

    #[tokio::test]
    async fn middleware_applies_the_same_policy_to_http_sse_and_websocket_entry_requests() {
        let allowed = connection("192.168.50.42:41000", "10.0.0.8:8089");
        let blocked = connection("203.0.113.9:41000", "10.0.0.8:8089");
        for uri in ["/http", "/events", "/ws"] {
            let response = protocol_router(filtered_policy())
                .oneshot(request(uri, allowed))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "allowed {uri}");

            let response = protocol_router(filtered_policy())
                .oneshot(request(uri, blocked))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN, "blocked {uri}");
        }
    }

    #[tokio::test]
    async fn network_policy_wraps_socketio_before_the_engineio_handshake() {
        let (socket_layer, io) = SocketIo::new_layer();
        io.ns(
            "/",
            |_socket: socketioxide::extract::SocketRef| async move {},
        );
        let app = Router::new()
            .route("/fallback", get(|| async { "fallback" }))
            .layer(socket_layer)
            .layer(middleware::from_fn_with_state(
                filtered_policy(),
                enforce_network_exposure,
            ));
        let uri = "/socket.io/?EIO=4&transport=polling";

        let allowed = app
            .clone()
            .oneshot(request(
                uri,
                connection("192.168.50.42:41000", "10.0.0.8:8089"),
            ))
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);

        let blocked = app
            .oneshot(request(
                uri,
                connection("203.0.113.9:41000", "10.0.0.8:8089"),
            ))
            .await
            .unwrap();
        assert_eq!(blocked.status(), StatusCode::FORBIDDEN);
    }
}
