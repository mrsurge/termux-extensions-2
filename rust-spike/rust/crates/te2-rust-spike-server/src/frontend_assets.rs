use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Redirect, Response},
    routing::get,
};
use serde_json::Value;
use std::{
    fs,
    path::{Path as StdPath, PathBuf},
};

use crate::{
    ApiResponse, AppState, apps_lifecycle::running_app_for_id, json_error, registry::AppRegistry,
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        // Framework host templates and live static assets.
        .route("/", get(index))
        .route("/app/{app_id}", get(app_shell))
        .route("/sw.js", get(service_worker))
        .route("/static/{*filename}", get(serve_static_file))
        // Compatibility routes for the app launcher and manifest-backed app assets.
        .route("/api/extensions", get(list_extensions))
        .route(
            "/extensions/{ext_dir}/{*filename}",
            get(serve_extension_file),
        )
        .route("/apps/{*path}", get(serve_app_file))
}

async fn index(State(state): State<AppState>) -> Response {
    let path = framework_template_path(state.project_root(), "index.html");
    match fs::read(&path) {
        Ok(body) => file_response(&path, body),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn app_shell(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    let registry = AppRegistry::load(state.app_roots());
    let Some(app) = registry.get_app(&app_id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let backend_required = app.backend_module().is_some();
    if backend_required && running_app_for_id(&registry, &app_id).is_none() {
        return Redirect::to("/").into_response();
    }

    let path = framework_template_path(state.project_root(), "app_shell.html");
    let template = match fs::read_to_string(&path) {
        Ok(template) => template,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let content = template
        .replace(
            "{{ app_id|tojson }}",
            &serde_json::to_string(&app_id).unwrap_or_else(|_| "\"\"".to_owned()),
        )
        .replace(
            "{{ url_for('static', filename='js/ws_port.js') }}",
            "/static/js/ws_port.js",
        );
    html_response(content)
}

async fn list_extensions(State(state): State<AppState>) -> Response {
    // Legacy generic extensions are intentionally not ported. This endpoint only
    // fakes the apps extension registration that the existing index page expects.
    match load_apps_extension_payload(state.project_root()) {
        Some(payload) => Json(ApiResponse {
            ok: true,
            data: vec![payload],
        })
        .into_response(),
        None => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Apps extension manifest could not be loaded.",
        ),
    }
}

async fn serve_extension_file(
    State(state): State<AppState>,
    Path((ext_dir, filename)): Path<(String, String)>,
) -> Result<Response, StatusCode> {
    // Only the app launcher extension is served here. Other legacy extension
    // directories are deliberately outside this spike's compatibility target.
    let Some(resolved) = resolve_apps_extension_asset(state.project_root(), &ext_dir, &filename)
    else {
        return Err(StatusCode::NOT_FOUND);
    };
    let body = fs::read(&resolved).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(file_response(&resolved, body))
}

async fn serve_app_file(
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Result<Response, StatusCode> {
    let (resolved_by_id, resolved_by_dir) = if let Some(rest) = path.strip_prefix("by-id/") {
        let Some((app_id, filename)) = rest.split_once('/') else {
            return Err(StatusCode::NOT_FOUND);
        };
        (Some((app_id, filename)), None)
    } else {
        let Some((app_dir, filename)) = path.split_once('/') else {
            return Err(StatusCode::NOT_FOUND);
        };
        (None, Some((app_dir, filename)))
    };

    let registry = AppRegistry::load(state.app_roots());
    // Both `/apps/by-id/{app_id}/...` and legacy `/apps/{dir}/...` resolve
    // through one route to avoid overlapping wildcard route ambiguity.
    let resolved = if let Some((app_id, filename)) = resolved_by_id {
        registry.resolve_asset_path(app_id, filename)
    } else if let Some((app_dir, filename)) = resolved_by_dir {
        registry.resolve_asset_path_by_dir(app_dir, filename)
    } else {
        None
    };
    let Some(resolved) = resolved else {
        return Err(StatusCode::NOT_FOUND);
    };
    let body = fs::read(&resolved).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(file_response(&resolved, body))
}

async fn serve_static_file(
    State(state): State<AppState>,
    Path(filename): Path<String>,
) -> Result<Response, StatusCode> {
    let root = framework_static_root(state.project_root());
    let Some(resolved) = resolve_file_under_root(&root, &filename) else {
        return Err(StatusCode::NOT_FOUND);
    };
    let body = fs::read(&resolved).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(file_response(&resolved, body))
}

async fn service_worker(State(state): State<AppState>) -> Response {
    let sw_path = framework_static_root(state.project_root())
        .join("js")
        .join("sw.js");
    let version_path = PathBuf::from(state.project_root())
        .join("app")
        .join("apps")
        .join("file_editor_cm6")
        .join("static")
        .join("version.txt");
    let version = fs::read_to_string(version_path)
        .ok()
        .map(|raw| raw.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "0".to_owned());
    match fs::read_to_string(&sw_path) {
        Ok(content) => javascript_response(content.replace("__ASSET_VERSION__", &version)),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

fn load_apps_extension_payload(project_root: &str) -> Option<Value> {
    // The frontend still loads an "extension" manifest. Keep that shape, but
    // pin it to app-launcher semantics instead of resurrecting generic extensions.
    let manifest_path = apps_extension_root(project_root).join("manifest.json");
    let text = fs::read_to_string(manifest_path).ok()?;
    let mut manifest = serde_json::from_str::<Value>(&text)
        .ok()?
        .as_object()
        .cloned()?;
    manifest.insert("_ext_dir".to_owned(), Value::String("apps".to_owned()));
    Some(Value::Object(manifest))
}

fn resolve_apps_extension_asset(
    project_root: &str,
    ext_dir: &str,
    filename: &str,
) -> Option<PathBuf> {
    if ext_dir != "apps" {
        return None;
    }
    let root = apps_extension_root(project_root).canonicalize().ok()?;
    let candidate = root.join(filename).canonicalize().ok()?;
    if !candidate.starts_with(&root) {
        return None;
    }
    Some(candidate)
}

fn apps_extension_root(project_root: &str) -> PathBuf {
    PathBuf::from(project_root)
        .join("app")
        .join("extensions")
        .join("apps")
}

fn framework_template_path(project_root: &str, filename: &str) -> PathBuf {
    PathBuf::from(project_root)
        .join("app")
        .join("templates")
        .join(filename)
}

fn framework_static_root(project_root: &str) -> PathBuf {
    PathBuf::from(project_root).join("app").join("static")
}

fn resolve_file_under_root(root: &StdPath, filename: &str) -> Option<PathBuf> {
    let root = root.canonicalize().ok()?;
    let candidate = root.join(filename).canonicalize().ok()?;
    if !candidate.starts_with(&root) {
        return None;
    }
    Some(candidate)
}

fn html_response(content: String) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(content))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn javascript_response(content: String) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, "application/javascript")
        .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
        .header(header::PRAGMA, "no-cache")
        .header(header::EXPIRES, "0")
        .body(Body::from(content))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn file_response(path: &StdPath, body: Vec<u8>) -> Response {
    // Static file serving is intentionally small here: enough content typing and
    // no-cache behavior for live app assets without pulling in a full file server.
    let suffix = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut builder = Response::builder();
    if let Some(content_type) = content_type_for_suffix(&suffix) {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    if matches!(suffix.as_str(), "js" | "mjs" | "ts" | "css") {
        builder = builder
            .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
            .header(header::PRAGMA, "no-cache")
            .header(header::EXPIRES, "0");
    }
    builder
        .body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn content_type_for_suffix(suffix: &str) -> Option<&'static str> {
    match suffix {
        "css" => Some("text/css"),
        "html" | "htm" => Some("text/html; charset=utf-8"),
        "js" | "mjs" | "ts" => Some("application/javascript"),
        "json" => Some("application/json"),
        "webmanifest" => Some("application/manifest+json"),
        "png" => Some("image/png"),
        "svg" => Some("image/svg+xml"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "ico" => Some("image/x-icon"),
        "woff2" => Some("font/woff2"),
        "woff" => Some("font/woff"),
        "ttf" => Some("font/ttf"),
        _ => None,
    }
}
