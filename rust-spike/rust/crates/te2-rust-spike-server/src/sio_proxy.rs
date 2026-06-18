use crate::registry::{AppDefinition, AppRegistry};
use anyhow::{Context, Result, bail};
use serde_json::{Map, Value};
use std::{collections::HashSet, fs};
use tracing::warn;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SioTarget {
    AppWorker,
    Static,
}

#[derive(Clone, Debug)]
pub struct SioProxyRoute {
    pub app_id: String,
    pub route_id: String,
    pub target: SioTarget,
    pub public_path: String,
    pub upstream_path: String,
    pub aliases: Vec<String>,
    pub host: String,
    pub port: Option<u16>,
}

#[derive(Clone, Debug)]
pub struct MatchedSioRoute {
    pub route: SioProxyRoute,
    pub rest: String,
}

#[derive(Clone, Debug, Default)]
pub struct SioRouteIndex {
    routes: Vec<SioProxyRoute>,
    mounts: Vec<(String, usize)>,
}

impl SioRouteIndex {
    pub fn from_registry(registry: &AppRegistry) -> Self {
        let mut routes = Vec::new();
        for app in registry.apps() {
            match parse_app_routes(app) {
                Ok(app_routes) => routes.extend(app_routes),
                Err(error) => {
                    warn!(app_id = %app.app_id, %error, "failed to parse sio_service config")
                }
            }
        }

        // Manifest aliases are concrete physical routes. Sorting longest-first
        // lets one handler recover route/rest without relying on Axum route data.
        let mut seen = HashSet::new();
        let mut mounts = Vec::new();
        for (index, route) in routes.iter().enumerate() {
            for mount in route.mount_paths() {
                if seen.insert(mount.clone()) {
                    mounts.push((mount, index));
                }
            }
        }
        mounts.sort_by(|(left, _), (right, _)| right.len().cmp(&left.len()).then(left.cmp(right)));

        Self { routes, mounts }
    }

    pub fn mount_paths(&self) -> Vec<String> {
        self.mounts.iter().map(|(mount, _)| mount.clone()).collect()
    }

    pub fn route_count(&self) -> usize {
        self.routes.len()
    }

    pub fn match_path(&self, path: &str) -> Option<MatchedSioRoute> {
        for (mount, index) in &self.mounts {
            if path == mount {
                return Some(MatchedSioRoute {
                    route: self.routes.get(*index)?.clone(),
                    rest: String::new(),
                });
            }
            let prefix = format!("{mount}/");
            if let Some(rest) = path.strip_prefix(&prefix) {
                return Some(MatchedSioRoute {
                    route: self.routes.get(*index)?.clone(),
                    rest: rest.to_owned(),
                });
            }
        }
        None
    }
}

impl SioProxyRoute {
    fn mount_paths(&self) -> Vec<String> {
        let mut paths = Vec::with_capacity(1 + self.aliases.len());
        paths.push(self.public_path.clone());
        paths.extend(self.aliases.iter().cloned());
        paths
    }
}

pub fn join_upstream_path(base_path: &str, rest: &str) -> String {
    if rest.is_empty() {
        return base_path.to_owned();
    }
    format!(
        "{}/{}",
        base_path.trim_end_matches('/'),
        rest.trim_start_matches('/')
    )
}

fn parse_app_routes(app: &AppDefinition) -> Result<Vec<SioProxyRoute>> {
    let Some(config) = load_config(app)? else {
        return Ok(Vec::new());
    };
    let routes_raw = config
        .get("routes")
        .and_then(Value::as_array)
        .context("sio_service.routes must be a list")?;
    let mut routes = Vec::new();

    for (index, raw_route) in routes_raw.iter().enumerate() {
        let route = raw_route
            .as_object()
            .with_context(|| format!("sio_service.routes[{index}] must be an object"))?;
        let route_id = string_field(route, "id")
            .with_context(|| format!("sio_service.routes[{index}].id is required"))?;
        let target = match string_field(route, "target")
            .unwrap_or_else(|| "app_worker".to_owned())
            .as_str()
        {
            "app_worker" => SioTarget::AppWorker,
            "static" => SioTarget::Static,
            other => bail!("sio_service route '{route_id}' target is invalid: {other}"),
        };
        let public_path = normalize_path(
            route
                .get("public_path")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| default_public_path(&app.app_id, &route_id, &target)),
            &format!("sio_service route '{route_id}' public_path"),
        )?;
        let upstream_path = normalize_upstream_path(
            route
                .get("upstream_path")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| "/socket.io/".to_owned()),
            &format!("sio_service route '{route_id}' upstream_path"),
        )?;
        let host = string_field(route, "host").unwrap_or_else(|| "127.0.0.1".to_owned());
        let port = if target == SioTarget::Static {
            Some(coerce_port(
                route.get("port"),
                &format!("sio_service route '{route_id}' port"),
            )?)
        } else {
            None
        };

        routes.push(SioProxyRoute {
            app_id: app.app_id.clone(),
            route_id,
            target,
            public_path,
            upstream_path,
            aliases: string_list(route.get("aliases"))?,
            host,
            port,
        });
    }

    Ok(routes)
}

fn load_config(app: &AppDefinition) -> Result<Option<Map<String, Value>>> {
    let Some(raw) = app.raw_manifest.get("sio_service") else {
        return Ok(None);
    };
    if let Some(config) = raw.as_object() {
        return Ok(Some(config.clone()));
    }
    let Some(path) = raw
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        bail!("sio_service must be a path string or object");
    };
    let config_path = app.root_dir.join(path);
    let text = fs::read_to_string(&config_path)
        .with_context(|| format!("sio_service file read failed: {}", config_path.display()))?;
    let value = serde_json::from_str::<Value>(&text)
        .with_context(|| format!("sio_service parse failed: {}", config_path.display()))?;
    let Some(config) = value.as_object() else {
        bail!("sio_service root must be a JSON object");
    };
    Ok(Some(config.clone()))
}

fn default_public_path(app_id: &str, route_id: &str, target: &SioTarget) -> String {
    match target {
        SioTarget::AppWorker => format!("/api/app/{app_id}/socket.io"),
        SioTarget::Static => format!("/api/app/{app_id}/services/{route_id}/socket.io"),
    }
}

fn normalize_path(raw: String, field_name: &str) -> Result<String> {
    normalize_path_inner(raw, field_name, false)
}

fn normalize_upstream_path(raw: String, field_name: &str) -> Result<String> {
    normalize_path_inner(raw, field_name, true)
}

fn normalize_path_inner(raw: String, field_name: &str, keep_trailing: bool) -> Result<String> {
    let mut path = raw.trim().to_owned();
    if path.is_empty() {
        bail!("{field_name} must be a non-empty path string");
    }
    if !path.starts_with('/') {
        bail!("{field_name} must start with '/'");
    }
    if !keep_trailing && path.len() > 1 {
        path = path.trim_end_matches('/').to_owned();
    }
    Ok(path)
}

fn string_field(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn string_list(value: Option<&Value>) -> Result<Vec<String>> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Ok(Vec::new());
    };
    let mut paths = Vec::new();
    for item in items {
        if let Some(path) = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            paths.push(normalize_path(path.to_owned(), "sio_service aliases[]")?);
        }
    }
    paths.dedup();
    Ok(paths)
}

fn coerce_port(value: Option<&Value>, field_name: &str) -> Result<u16> {
    match value {
        Some(Value::Number(number)) => number
            .as_u64()
            .and_then(|port| u16::try_from(port).ok())
            .with_context(|| format!("{field_name} must be between 1 and 65535")),
        Some(Value::String(value)) => value
            .trim()
            .parse::<u16>()
            .with_context(|| format!("{field_name} must be between 1 and 65535")),
        _ => bail!("{field_name} must be an integer"),
    }
}
