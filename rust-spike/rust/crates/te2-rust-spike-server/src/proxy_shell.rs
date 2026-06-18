use crate::registry::AppDefinition;
use anyhow::{Context, Result, bail};
use regex::Regex;
use serde_json::{Map, Value};

#[derive(Clone, Debug)]
pub struct ProxyShellConfig {
    pub start_path: String,
    pub health_path: String,
    pub rewrite: ProxyShellRewriteConfig,
    pub socketio: ProxyShellSocketIoConfig,
}

#[derive(Clone, Debug, Default)]
pub struct ProxyShellRewriteConfig {
    pub enabled: bool,
    pub path_prefixes: Vec<String>,
    pub content_types: Vec<String>,
    pub absolute_root_paths: Vec<String>,
    pub css_root_paths: Vec<String>,
    pub ws_template_marker: Option<String>,
    pub ws_template_replacement: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct ProxyShellSocketIoConfig {
    pub enabled: bool,
    pub inject_path: bool,
    pub namespace_marker: Option<String>,
}

pub fn parse_proxy_shell(app: &AppDefinition) -> Result<Option<ProxyShellConfig>> {
    let Some(raw) = app.proxy_shell.as_ref() else {
        return Ok(None);
    };
    if raw.get("enabled").and_then(Value::as_bool) == Some(false) {
        return Ok(None);
    }

    let start_path = normalize_required_path(raw, "start_path")
        .context("proxy_shell.start_path is required and must be a non-empty string")?;
    let health_path = normalize_required_path(raw, "health_path")
        .context("proxy_shell.health_path is required and must be a non-empty string")?;
    let rewrite = parse_rewrite_config(raw.get("rewrite"))?;
    let socketio = parse_socketio_config(raw.get("socketio"))?;

    Ok(Some(ProxyShellConfig {
        start_path,
        health_path,
        rewrite,
        socketio,
    }))
}

pub fn proxy_shell_urls(app_id: &str, config: &ProxyShellConfig) -> Map<String, Value> {
    let proxy_prefix = proxy_prefix(app_id);
    let mut payload = Map::new();
    payload.insert(
        "proxy_prefix".to_owned(),
        Value::String(proxy_prefix.clone()),
    );
    payload.insert(
        "start_path".to_owned(),
        Value::String(config.start_path.clone()),
    );
    payload.insert(
        "health_path".to_owned(),
        Value::String(config.health_path.clone()),
    );
    payload.insert(
        "start_url".to_owned(),
        Value::String(format!("{proxy_prefix}{}", config.start_path)),
    );
    payload.insert(
        "health_url".to_owned(),
        Value::String(format!("{proxy_prefix}{}", config.health_path)),
    );
    payload
}

pub fn proxy_prefix(app_id: &str) -> String {
    format!("/api/app/{app_id}/proxy")
}

pub fn proxy_shell_upstream_path(rest: &str) -> String {
    if rest.trim().is_empty() {
        "/".to_owned()
    } else {
        format!("/{}", rest.trim_start_matches('/'))
    }
}

pub fn should_rewrite(upstream_path: &str, content_type: &str, config: &ProxyShellConfig) -> bool {
    if !config.rewrite.enabled {
        return false;
    }
    if config.rewrite.content_types.is_empty() {
        return false;
    }

    let lowered_content_type = content_type.to_ascii_lowercase();
    if !config
        .rewrite
        .content_types
        .iter()
        .any(|value| lowered_content_type.contains(value))
    {
        return false;
    }

    if config.rewrite.path_prefixes.is_empty() {
        return true;
    }
    config
        .rewrite
        .path_prefixes
        .iter()
        .any(|prefix| upstream_path.starts_with(prefix))
}

pub fn rewrite_payload(text: &str, app_id: &str, config: &ProxyShellConfig) -> String {
    let proxy_prefix = proxy_prefix(app_id);
    let mut out = text.to_owned();

    for root in ordered_absolute_roots(&config.rewrite.absolute_root_paths) {
        out = replace_quoted_root(&out, &root, &format!("{proxy_prefix}{root}"));
    }

    for root in &config.rewrite.css_root_paths {
        out = replace_css_root(&out, root, &format!("{proxy_prefix}{root}"));
    }

    if let (Some(marker), Some(replacement)) = (
        config.rewrite.ws_template_marker.as_deref(),
        config.rewrite.ws_template_replacement.as_deref(),
    ) {
        out = out.replace(
            marker,
            &replacement.replace("{proxy_prefix}", &proxy_prefix),
        );
    }

    if config.socketio.enabled && config.socketio.inject_path {
        if let Some(marker) = config.socketio.namespace_marker.as_deref() {
            let injected_path = format!("path: '{proxy_prefix}/socket.io'");
            if !out.contains(&injected_path) {
                let replacement = format!("{marker}\n      {injected_path},");
                out = out.replacen(marker, &replacement, 1);
            }
        }
    }

    out
}

fn parse_rewrite_config(value: Option<&Value>) -> Result<ProxyShellRewriteConfig> {
    let Some(value) = value else {
        return Ok(ProxyShellRewriteConfig::default());
    };
    let Some(raw) = value.as_object() else {
        bail!("proxy_shell.rewrite must be an object");
    };

    Ok(ProxyShellRewriteConfig {
        enabled: raw.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        path_prefixes: path_list(raw.get("path_prefixes"))?,
        content_types: string_list(raw.get("content_types"))
            .into_iter()
            .map(|value| value.to_ascii_lowercase())
            .collect(),
        absolute_root_paths: path_list(raw.get("absolute_root_paths"))?,
        css_root_paths: path_list(raw.get("css_root_paths"))?,
        ws_template_marker: nonempty_string(raw, "ws_template_marker"),
        ws_template_replacement: nonempty_string(raw, "ws_template_replacement"),
    })
}

fn parse_socketio_config(value: Option<&Value>) -> Result<ProxyShellSocketIoConfig> {
    let Some(value) = value else {
        return Ok(ProxyShellSocketIoConfig::default());
    };
    let Some(raw) = value.as_object() else {
        bail!("proxy_shell.socketio must be an object");
    };

    Ok(ProxyShellSocketIoConfig {
        enabled: raw.get("enabled").and_then(Value::as_bool).unwrap_or(false),
        inject_path: raw
            .get("inject_path")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        namespace_marker: nonempty_string(raw, "namespace_marker"),
    })
}

fn normalize_required_path(map: &Map<String, Value>, key: &str) -> Result<String> {
    let Some(value) = map.get(key).and_then(Value::as_str) else {
        bail!("missing path");
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("path is empty");
    }
    Ok(if trimmed.starts_with('/') {
        trimmed.to_owned()
    } else {
        format!("/{trimmed}")
    })
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn path_list(value: Option<&Value>) -> Result<Vec<String>> {
    let mut paths = Vec::new();
    for path in string_list(value) {
        if !path.starts_with('/') {
            bail!("path list entries must start with '/'");
        }
        paths.push(path);
    }
    Ok(paths)
}

fn nonempty_string(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn ordered_absolute_roots(roots: &[String]) -> Vec<String> {
    let mut ordered = Vec::new();
    for fixed in ["/api/", "/ws/"] {
        if roots.iter().any(|root| root == fixed) {
            ordered.push(fixed.to_owned());
        }
    }
    for root in roots {
        if !ordered.iter().any(|seen| seen == root) {
            ordered.push(root.clone());
        }
    }
    ordered
}

fn replace_quoted_root(text: &str, root: &str, replacement: &str) -> String {
    let pattern = if root == "/api/" {
        r#"(?P<q>['"`])/api/(?!app/)"#.to_owned()
    } else {
        format!(r#"(?P<q>['"`]){}"#, regex::escape(root))
    };
    match Regex::new(&pattern) {
        Ok(regex) => regex
            .replace_all(text, format!("${{q}}{replacement}"))
            .into_owned(),
        Err(_) => text.to_owned(),
    }
}

fn replace_css_root(text: &str, root: &str, replacement: &str) -> String {
    let pattern = format!(r#"url\(\s*(['"]?){}"#, regex::escape(root));
    match Regex::new(&pattern) {
        Ok(regex) => regex
            .replace_all(text, format!("url($1{replacement}"))
            .into_owned(),
        Err(_) => text.to_owned(),
    }
}
