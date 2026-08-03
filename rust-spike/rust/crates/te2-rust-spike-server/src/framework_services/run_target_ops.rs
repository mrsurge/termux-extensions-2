use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::Mutex;

const ROUTE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunTargetRegisterRequest {
    pub(crate) owner_id: String,
    pub(crate) shell_id: String,
    pub(crate) port: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunTargetReleaseRequest {
    pub(crate) owner_id: String,
    #[serde(default)]
    pub(crate) shell_id: Option<String>,
    #[serde(default)]
    pub(crate) ticket: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunTargetRouteResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) ticket: String,
    pub(crate) tunnel_path: String,
    pub(crate) preferred_port: u16,
    pub(crate) expires_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunTargetReleaseResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) released: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct RunTargetRoute {
    pub(crate) port: u16,
}

#[derive(Clone, Default)]
pub(crate) struct RunTargetRegistry {
    inner: Arc<Mutex<HashMap<String, RegisteredRoute>>>,
}

#[derive(Clone)]
struct RegisteredRoute {
    ticket: String,
    owner_id: String,
    shell_id: String,
    port: u16,
    expires_at: tokio::time::Instant,
    expires_at_epoch_ms: u64,
}

impl RunTargetRegistry {
    pub(crate) async fn register(
        &self,
        request: RunTargetRegisterRequest,
    ) -> Result<RunTargetRouteResult, String> {
        validate_registration(&request)?;
        let mut routes = self.inner.lock().await;
        purge_expired(&mut routes);

        if let Some(existing) = routes.values_mut().find(|route| {
            route.owner_id == request.owner_id
                && route.shell_id == request.shell_id
                && route.port == request.port
        }) {
            renew(existing);
            return Ok(route_result(existing));
        }

        // One profile owner has one live route. Relaunching atomically invalidates
        // the previous ticket before the new Sidebar projection is published.
        routes.retain(|_, route| route.owner_id != request.owner_id);
        let ticket = random_ticket()?;
        let mut route = RegisteredRoute {
            ticket: ticket.clone(),
            owner_id: request.owner_id,
            shell_id: request.shell_id,
            port: request.port,
            expires_at: tokio::time::Instant::now() + ROUTE_TTL,
            expires_at_epoch_ms: expires_at_epoch_ms(),
        };
        renew(&mut route);
        let result = route_result(&route);
        routes.insert(ticket, route);
        Ok(result)
    }

    pub(crate) async fn release(
        &self,
        request: RunTargetReleaseRequest,
    ) -> Result<RunTargetReleaseResult, String> {
        if request.owner_id.trim().is_empty() {
            return Err("ownerId is required".to_owned());
        }
        let mut routes = self.inner.lock().await;
        purge_expired(&mut routes);
        let before = routes.len();
        routes.retain(|ticket, route| {
            if route.owner_id != request.owner_id {
                return true;
            }
            if let Some(expected) = request.shell_id.as_deref()
                && route.shell_id != expected
            {
                return true;
            }
            if let Some(expected) = request.ticket.as_deref()
                && ticket != expected
            {
                return true;
            }
            false
        });
        Ok(RunTargetReleaseResult {
            dto: "RunTargetReleaseResult",
            version: 1,
            released: routes.len() != before,
        })
    }

    pub(crate) async fn resolve(&self, ticket: &str) -> Option<RunTargetRoute> {
        let mut routes = self.inner.lock().await;
        purge_expired(&mut routes);
        let route = routes.get_mut(ticket)?;
        renew(route);
        Some(RunTargetRoute { port: route.port })
    }
}

fn validate_registration(request: &RunTargetRegisterRequest) -> Result<(), String> {
    if request.owner_id.trim().is_empty() {
        return Err("ownerId is required".to_owned());
    }
    if request.shell_id.trim().is_empty() {
        return Err("shellId is required".to_owned());
    }
    if request.port == 0 {
        return Err("port must be between 1 and 65535".to_owned());
    }
    Ok(())
}

fn renew(route: &mut RegisteredRoute) {
    route.expires_at = tokio::time::Instant::now() + ROUTE_TTL;
    route.expires_at_epoch_ms = expires_at_epoch_ms();
}

fn purge_expired(routes: &mut HashMap<String, RegisteredRoute>) {
    let now = tokio::time::Instant::now();
    routes.retain(|_, route| route.expires_at > now);
}

fn route_result(route: &RegisteredRoute) -> RunTargetRouteResult {
    RunTargetRouteResult {
        dto: "RunTargetRoute",
        version: 1,
        ticket: route.ticket.clone(),
        tunnel_path: format!("/api/run-targets/{}/tunnel", route.ticket),
        preferred_port: route.port,
        expires_at: route.expires_at_epoch_ms,
    }
}

fn expires_at_epoch_ms() -> u64 {
    let expiry = std::time::SystemTime::now() + ROUTE_TTL;
    expiry
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn random_ticket() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("secure ticket generation failed: {error}"))?;
    let mut ticket = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(ticket, "{byte:02x}");
    }
    Ok(ticket)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn registration_is_idempotent_for_one_running_shell() {
        let registry = RunTargetRegistry::default();
        let request = RunTargetRegisterRequest {
            owner_id: "project:profile".to_owned(),
            shell_id: "shell-1".to_owned(),
            port: 4173,
        };
        let first = registry
            .register(request.clone())
            .await
            .expect("first route");
        let second = registry.register(request).await.expect("second route");
        assert_eq!(first.ticket, second.ticket);
        assert_eq!(
            registry.resolve(&first.ticket).await.expect("route").port,
            4173
        );
    }

    #[tokio::test]
    async fn relaunch_invalidates_the_previous_ticket() {
        let registry = RunTargetRegistry::default();
        let first = registry
            .register(RunTargetRegisterRequest {
                owner_id: "project:profile".to_owned(),
                shell_id: "shell-1".to_owned(),
                port: 4173,
            })
            .await
            .expect("first route");
        let second = registry
            .register(RunTargetRegisterRequest {
                owner_id: "project:profile".to_owned(),
                shell_id: "shell-2".to_owned(),
                port: 4173,
            })
            .await
            .expect("replacement route");
        assert_ne!(first.ticket, second.ticket);
        assert!(registry.resolve(&first.ticket).await.is_none());
    }
}
