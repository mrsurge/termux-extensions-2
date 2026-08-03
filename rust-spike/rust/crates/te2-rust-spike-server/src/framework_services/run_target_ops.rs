use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};
use tokio::sync::Mutex;

const ROUTE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_ADDITIONAL_PORTS: usize = 8;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunTargetRegisterRequest {
    pub(crate) owner_id: String,
    pub(crate) shell_id: String,
    pub(crate) port: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunTargetRouteSetRegisterRequest {
    pub(crate) owner_id: String,
    pub(crate) shell_id: String,
    pub(crate) primary_port: u16,
    #[serde(default)]
    pub(crate) additional_ports: Vec<RunTargetAdditionalPortRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunTargetAdditionalPortRequest {
    pub(crate) port: u16,
    pub(crate) label: String,
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
pub(crate) struct RunTargetAdditionalRouteResult {
    pub(crate) label: String,
    #[serde(flatten)]
    pub(crate) route: RunTargetRouteResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunTargetRouteSetResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) primary: RunTargetRouteResult,
    pub(crate) additional: Vec<RunTargetAdditionalRouteResult>,
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
    label: Option<String>,
    primary: bool,
    expires_at: tokio::time::Instant,
    expires_at_epoch_ms: u64,
}

#[derive(Clone)]
struct RouteSpec {
    port: u16,
    label: Option<String>,
    primary: bool,
}

impl RunTargetRegistry {
    pub(crate) async fn register(
        &self,
        request: RunTargetRegisterRequest,
    ) -> Result<RunTargetRouteResult, String> {
        validate_identity(&request.owner_id, &request.shell_id)?;
        if request.port == 0 {
            return Err("port must be between 1 and 65535".to_owned());
        }
        let result = self
            .register_specs(
                request.owner_id,
                request.shell_id,
                vec![RouteSpec {
                    port: request.port,
                    label: None,
                    primary: true,
                }],
            )
            .await?;
        Ok(result.primary)
    }

    pub(crate) async fn register_set(
        &self,
        request: RunTargetRouteSetRegisterRequest,
    ) -> Result<RunTargetRouteSetResult, String> {
        let specs = validate_route_set(&request)?;
        self.register_specs(request.owner_id, request.shell_id, specs)
            .await
    }

    async fn register_specs(
        &self,
        owner_id: String,
        shell_id: String,
        specs: Vec<RouteSpec>,
    ) -> Result<RunTargetRouteSetResult, String> {
        let mut routes = self.inner.lock().await;
        purge_expired(&mut routes);

        let existing = routes
            .values()
            .filter(|route| route.owner_id == owner_id)
            .cloned()
            .collect::<Vec<_>>();
        if route_set_matches(&existing, &shell_id, &specs) {
            for route in routes
                .values_mut()
                .filter(|route| route.owner_id == owner_id)
            {
                renew(route);
            }
            return route_set_result(
                routes.values().filter(|route| route.owner_id == owner_id),
                &specs,
            );
        }

        // Generate the complete replacement before mutating the live set. A
        // ticket-generation failure therefore cannot leave a partial route group.
        let mut replacement = Vec::with_capacity(specs.len());
        let mut generated = HashSet::with_capacity(specs.len());
        for spec in &specs {
            let ticket = loop {
                let candidate = random_ticket()?;
                if !routes.contains_key(&candidate) && generated.insert(candidate.clone()) {
                    break candidate;
                }
            };
            let mut route = RegisteredRoute {
                ticket,
                owner_id: owner_id.clone(),
                shell_id: shell_id.clone(),
                port: spec.port,
                label: spec.label.clone(),
                primary: spec.primary,
                expires_at: tokio::time::Instant::now() + ROUTE_TTL,
                expires_at_epoch_ms: expires_at_epoch_ms(),
            };
            renew(&mut route);
            replacement.push(route);
        }

        routes.retain(|_, route| route.owner_id != owner_id);
        for route in replacement {
            routes.insert(route.ticket.clone(), route);
        }
        route_set_result(
            routes.values().filter(|route| route.owner_id == owner_id),
            &specs,
        )
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
        if let Some(expected_ticket) = request.ticket.as_deref() {
            let ticket_matches_group = routes.get(expected_ticket).is_some_and(|route| {
                route.owner_id == request.owner_id
                    && request
                        .shell_id
                        .as_deref()
                        .is_none_or(|expected_shell| route.shell_id == expected_shell)
            });
            if !ticket_matches_group {
                return Ok(RunTargetReleaseResult {
                    dto: "RunTargetReleaseResult",
                    version: 1,
                    released: false,
                });
            }
        }
        let before = routes.len();
        routes.retain(|_, route| {
            if route.owner_id != request.owner_id {
                return true;
            }
            if let Some(expected) = request.shell_id.as_deref()
                && route.shell_id != expected
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

fn validate_identity(owner_id: &str, shell_id: &str) -> Result<(), String> {
    if owner_id.trim().is_empty() {
        return Err("ownerId is required".to_owned());
    }
    if shell_id.trim().is_empty() {
        return Err("shellId is required".to_owned());
    }
    Ok(())
}

fn validate_route_set(
    request: &RunTargetRouteSetRegisterRequest,
) -> Result<Vec<RouteSpec>, String> {
    validate_identity(&request.owner_id, &request.shell_id)?;
    if request.primary_port == 0 {
        return Err("primaryPort must be between 1 and 65535".to_owned());
    }
    if request.additional_ports.len() > MAX_ADDITIONAL_PORTS {
        return Err(format!(
            "additionalPorts supports at most {MAX_ADDITIONAL_PORTS} entries"
        ));
    }
    let mut seen = HashSet::with_capacity(request.additional_ports.len() + 1);
    seen.insert(request.primary_port);
    let mut specs = vec![RouteSpec {
        port: request.primary_port,
        label: None,
        primary: true,
    }];
    for additional in &request.additional_ports {
        let label = additional.label.trim();
        if additional.port == 0 {
            return Err("additional port must be between 1 and 65535".to_owned());
        }
        if label.is_empty() {
            return Err("additional port label is required".to_owned());
        }
        if !seen.insert(additional.port) {
            return Err(format!("duplicate run-target port {}", additional.port));
        }
        specs.push(RouteSpec {
            port: additional.port,
            label: Some(label.to_owned()),
            primary: false,
        });
    }
    Ok(specs)
}

fn route_set_matches(existing: &[RegisteredRoute], shell_id: &str, specs: &[RouteSpec]) -> bool {
    existing.len() == specs.len()
        && existing.iter().all(|route| route.shell_id == shell_id)
        && specs.iter().all(|spec| {
            existing.iter().any(|route| {
                route.port == spec.port
                    && route.label == spec.label
                    && route.primary == spec.primary
            })
        })
}

fn route_set_result<'a>(
    routes: impl Iterator<Item = &'a RegisteredRoute>,
    specs: &[RouteSpec],
) -> Result<RunTargetRouteSetResult, String> {
    let by_port = routes
        .map(|route| (route.port, route))
        .collect::<HashMap<_, _>>();
    let primary_spec = specs
        .first()
        .ok_or_else(|| "run-target route set has no primary port".to_owned())?;
    let primary = by_port
        .get(&primary_spec.port)
        .ok_or_else(|| "run-target primary route was not registered".to_owned())?;
    let mut additional = Vec::with_capacity(specs.len().saturating_sub(1));
    for spec in specs.iter().skip(1) {
        let route = by_port
            .get(&spec.port)
            .ok_or_else(|| format!("run-target route {} was not registered", spec.port))?;
        additional.push(RunTargetAdditionalRouteResult {
            label: spec.label.clone().unwrap_or_default(),
            route: route_result(route),
        });
    }
    Ok(RunTargetRouteSetResult {
        dto: "RunTargetRouteSet",
        version: 1,
        primary: route_result(primary),
        additional,
    })
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

    fn route_set(shell_id: &str, additional_port: u16) -> RunTargetRouteSetRegisterRequest {
        RunTargetRouteSetRegisterRequest {
            owner_id: "project:profile".to_owned(),
            shell_id: shell_id.to_owned(),
            primary_port: 4173,
            additional_ports: vec![RunTargetAdditionalPortRequest {
                port: additional_port,
                label: "Vite / HMR".to_owned(),
            }],
        }
    }

    #[tokio::test]
    async fn route_set_registration_is_idempotent_for_one_running_shell() {
        let registry = RunTargetRegistry::default();
        let first = registry
            .register_set(route_set("shell-1", 5173))
            .await
            .expect("first route set");
        let second = registry
            .register_set(route_set("shell-1", 5173))
            .await
            .expect("second route set");
        assert_eq!(first.primary.ticket, second.primary.ticket);
        assert_eq!(
            first.additional[0].route.ticket,
            second.additional[0].route.ticket
        );
        assert_eq!(first.additional[0].label, "Vite / HMR");
    }

    #[tokio::test]
    async fn relaunch_invalidates_every_previous_ticket() {
        let registry = RunTargetRegistry::default();
        let first = registry
            .register_set(route_set("shell-1", 5173))
            .await
            .expect("first route set");
        let second = registry
            .register_set(route_set("shell-2", 5173))
            .await
            .expect("replacement route set");
        assert_ne!(first.primary.ticket, second.primary.ticket);
        assert!(registry.resolve(&first.primary.ticket).await.is_none());
        assert!(
            registry
                .resolve(&first.additional[0].route.ticket)
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn release_removes_the_complete_route_set() {
        let registry = RunTargetRegistry::default();
        let set = registry
            .register_set(route_set("shell-1", 5173))
            .await
            .expect("route set");
        let released = registry
            .release(RunTargetReleaseRequest {
                owner_id: "project:profile".to_owned(),
                shell_id: Some("shell-1".to_owned()),
                ticket: None,
            })
            .await
            .expect("release");
        assert!(released.released);
        assert!(registry.resolve(&set.primary.ticket).await.is_none());
        assert!(
            registry
                .resolve(&set.additional[0].route.ticket)
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn ticket_release_selects_and_removes_the_complete_route_set() {
        let registry = RunTargetRegistry::default();
        let registered = registry
            .register_set(route_set("shell-a", 5173))
            .await
            .unwrap();

        let released = registry
            .release(RunTargetReleaseRequest {
                owner_id: "project:profile".to_owned(),
                shell_id: Some("shell-a".to_owned()),
                ticket: Some(registered.primary.ticket),
            })
            .await
            .unwrap();

        assert!(released.released);
        assert!(registry.inner.lock().await.is_empty());
    }

    #[tokio::test]
    async fn duplicate_route_set_ports_are_rejected_without_replacing_live_routes() {
        let registry = RunTargetRegistry::default();
        let existing = registry
            .register_set(route_set("shell-1", 5173))
            .await
            .expect("existing route set");
        let error = registry
            .register_set(route_set("shell-2", 4173))
            .await
            .expect_err("duplicate port");
        assert!(error.contains("duplicate run-target port"));
        assert!(registry.resolve(&existing.primary.ticket).await.is_some());
    }
}
