#[cfg(feature = "ferrous-framework-native")]
use ferrous_framework::{FerrousNativeLifecycleEventKind, FerrousNativeManager};

use axum::{
    Json, Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Path, State},
    http::{HeaderValue, StatusCode, header},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{get, post},
};
use futures_util::{StreamExt, stream};
use serde::Deserialize;
use serde_json::{Map as JsonMap, Value, json};
use std::{
    collections::{HashMap, HashSet},
    convert::Infallible,
    path::PathBuf,
};
use tokio::sync::broadcast;
use tokio::time::Duration;
use tracing::warn;
use url::form_urlencoded;

use crate::{
    ApiResponse, AppState, json_error,
    launcher::{launch_app, launch_supported},
    proxy_transport::absolute_upstream_url,
    registry::{self, AppRegistry, AppRoot},
    runtime::{FwsDiscovery, RunningApp},
};

#[derive(Clone, Debug)]
pub(crate) struct AppsEvent {
    event_type: String,
    payload: Value,
}

impl AppsEvent {
    fn new(event_type: impl Into<String>, payload: Value) -> Self {
        Self {
            event_type: event_type.into(),
            payload,
        }
    }

    fn ws_message(&self) -> Value {
        json!({
            "type": self.event_type,
            "payload": self.payload,
        })
    }

    fn sse_event(&self) -> Event {
        Event::default()
            .event(self.event_type.clone())
            .data(self.payload.to_string())
    }
}

#[derive(Debug, Default, Deserialize)]
struct OpenAppRequest {
    #[serde(default)]
    params: JsonMap<String, Value>,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        // Apps extension/app registry read model.
        .route("/api/apps", get(list_apps))
        .route("/api/apps/catalog", get(apps_catalog))
        .route("/api/apps/running", get(running_apps))
        .route("/api/apps/events", get(apps_events_sse))
        .route("/api/apps/{app_id}/start", post(start_app))
        .route("/api/apps/{app_id}/open", post(open_app))
        .route("/api/apps/{app_id}/quit", post(quit_app))
        .route(
            "/api/apps/{app_id}/readiness",
            get(get_app_readiness)
                .post(set_app_readiness)
                .put(set_app_readiness),
        )
        .route("/api/apps/reload", post(reload_apps))
        // App launcher event bridge. WebSocket and SSE share the same app
        // lifecycle broadcast channel so launchers and app shells do not poll.
        .route("/ws/apps", get(apps_ws))
}

async fn list_apps(State(state): State<AppState>) -> Json<ApiResponse<Vec<Value>>> {
    let registry = AppRegistry::load(state.app_roots());
    Json(ApiResponse {
        ok: true,
        data: registry.list_payloads(),
    })
}

async fn apps_catalog(State(state): State<AppState>) -> Json<ApiResponse<Vec<Value>>> {
    let registry = AppRegistry::load(state.app_roots());
    let running_ids = running_app_ids(&registry);
    let readiness = state.readiness_store().read().await;
    Json(ApiResponse {
        ok: true,
        data: catalog_payloads_with_running_and_readiness(&registry, &running_ids, &readiness),
    })
}

async fn running_apps(State(state): State<AppState>) -> Json<ApiResponse<Vec<Value>>> {
    let registry = AppRegistry::load(state.app_roots());
    let readiness = state.readiness_store().read().await;
    Json(ApiResponse {
        ok: true,
        data: running_app_payloads(&registry, &readiness),
    })
}

async fn start_app(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    match start_app_inner(&state, &app_id).await {
        Ok(data) => {
            publish_app_running_changed(&state, &app_id, "start", Some(&data), None).await;
            Json(ApiResponse { ok: true, data }).into_response()
        }
        Err(response) => response,
    }
}

async fn start_app_inner(state: &AppState, app_id: &str) -> Result<Value, Response> {
    let registry = AppRegistry::load(state.app_roots());
    let Some(app) = registry.get_app(app_id).cloned() else {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            &format!("App '{app_id}' not found"),
        ));
    };
    if !app.enabled {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("App '{app_id}' is disabled"),
        ));
    }
    ensure_starting_readiness_if_supported(state, &app).await;
    if let Some(running) = running_app_for_id(&registry, app_id) {
        let readiness = state.readiness_store().read().await;
        return Ok(running_app_to_value(&registry, running, &readiness));
    }
    if app.backend_module().is_none() && app.shells.is_empty() {
        return Ok(json!({
            "app_id": app.app_id,
            "message": "No backend to start",
        }));
    }
    if !launch_supported() {
        return Err(json_error(
            StatusCode::NOT_IMPLEMENTED,
            "Rust spike was built without the ferrous-framework-native feature.",
        ));
    }

    let project_root = PathBuf::from(state.project_root());
    let framework_url = state.framework_url();
    let framework_shells_env = state.fws_child_env().clone();
    let launch_store = state.launch_store().clone();
    let launch_result = match tokio::task::spawn_blocking(move || {
        launch_app(
            &launch_store,
            &app,
            &project_root,
            &framework_url,
            &framework_shells_env,
        )
    })
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            warn!(%error, %app_id, "failed to launch app worker");
            return Err(json_error(StatusCode::BAD_GATEWAY, &error.to_string()));
        }
        Err(error) => {
            warn!(%error, %app_id, "launch task failed");
            return Err(json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("launch task failed for '{app_id}'"),
            ));
        }
    };

    if let Some(running) =
        wait_for_running_app(state.app_roots(), app_id, &launch_result.shell_id).await
    {
        let readiness = state.readiness_store().read().await;
        return Ok(running_app_to_value(&registry, running, &readiness));
    }

    Ok(serde_json::to_value(launch_result).unwrap_or_else(|_| json!({ "app_id": app_id })))
}

async fn open_app(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    payload: Option<Json<OpenAppRequest>>,
) -> Response {
    let params = payload.map(|Json(body)| body.params).unwrap_or_default();
    let app_info = match start_app_inner(&state, &app_id).await {
        Ok(data) => data,
        Err(response) => return response,
    };
    publish_app_running_changed(&state, &app_id, "open", Some(&app_info), None).await;

    let mut url = format!("/app/{app_id}");
    if !params.is_empty() {
        let mut serializer = form_urlencoded::Serializer::new(String::new());
        for (key, value) in params {
            match value {
                Value::Null => {}
                Value::String(raw) => {
                    serializer.append_pair(&key, &raw);
                }
                other => {
                    serializer.append_pair(&key, &other.to_string());
                }
            }
        }
        let query = serializer.finish();
        if !query.is_empty() {
            url.push('?');
            url.push_str(&query);
        }
    }

    Json(ApiResponse {
        ok: true,
        data: json!({
            "url": url,
            "app_info": app_info,
        }),
    })
    .into_response()
}

async fn quit_app(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    let registry = AppRegistry::load(state.app_roots());
    if registry.get_app(&app_id).is_none() {
        return json_error(StatusCode::NOT_FOUND, &format!("App '{app_id}' not found"));
    }

    let root_pids = FwsDiscovery::from_env().root_pids_for_app(&app_id);
    if root_pids.is_empty() {
        return json_error(
            StatusCode::NOT_FOUND,
            "App is not running or already terminated.",
        );
    }

    let Some(upstream) = absolute_upstream_url(
        state.fws_upstream_base_url(),
        &format!("/api/framework_shells/app/{app_id}/shutdown"),
        None,
        false,
    ) else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "FWS bridge runtime is not available.",
        );
    };

    let response = match state
        .http_client()
        .post(upstream.clone())
        .header("x-fws-ajax", "1")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            warn!(%error, %app_id, %upstream, "failed to reach FWS app shutdown action");
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to terminate app group for '{app_id}'."),
            );
        }
    };
    if !response.status().is_success() {
        warn!(
            status = %response.status(),
            %app_id,
            %upstream,
            "FWS app shutdown action returned non-success"
        );
        return json_error(
            StatusCode::BAD_GATEWAY,
            &format!("Failed to terminate app group for '{app_id}'."),
        );
    }

    state.readiness_store().write().await.remove(&app_id);
    publish_app_running_changed(&state, &app_id, "quit", None, Some(false)).await;
    Json(ApiResponse {
        ok: true,
        data: json!({
            "message": format!("App {app_id} terminated."),
            "root_pids": root_pids,
            "stats": {},
        }),
    })
    .into_response()
}

async fn set_app_readiness(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    payload: Option<Json<JsonMap<String, Value>>>,
) -> Response {
    let registry = AppRegistry::load(state.app_roots());
    let app = match readiness_manifest_or_error(&registry, &app_id) {
        Ok(app) => app,
        Err(response) => return response,
    };
    let body = payload.map(|Json(body)| body).unwrap_or_default();
    let status = body
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if status.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "status is required");
    }
    let status_normalized = normalize_readiness_status(status);
    if !matches!(
        status_normalized.as_str(),
        "starting" | "ready" | "error" | "stopped"
    ) {
        return json_error(StatusCode::BAD_REQUEST, "invalid readiness status");
    }

    let mut readiness = body;
    readiness.insert("app_id".to_owned(), Value::String(app.app_id.clone()));
    readiness.insert("status".to_owned(), Value::String(status_normalized));
    state
        .readiness_store()
        .write()
        .await
        .insert(app_id.clone(), readiness.clone());
    publish_apps_event(
        &state,
        AppsEvent::new(
            "app_readiness_changed",
            json!({ "app_id": app_id, "readiness": readiness.clone() }),
        ),
    );
    publish_catalog_snapshot(&state).await;
    Json(ApiResponse {
        ok: true,
        data: Value::Object(readiness),
    })
    .into_response()
}

async fn get_app_readiness(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    let registry = AppRegistry::load(state.app_roots());
    if let Err(response) = readiness_manifest_or_error(&registry, &app_id) {
        return response;
    }
    if let Some(readiness) = state.readiness_store().read().await.get(&app_id).cloned() {
        return Json(ApiResponse {
            ok: true,
            data: Value::Object(readiness),
        })
        .into_response();
    }
    let data = if running_app_for_id(&registry, &app_id).is_some() {
        json!({ "app_id": app_id, "status": "starting" })
    } else {
        json!({ "app_id": app_id, "status": "stopped" })
    };
    Json(ApiResponse { ok: true, data }).into_response()
}

async fn reload_apps(
    State(state): State<AppState>,
) -> Json<ApiResponse<serde_json::Map<String, Value>>> {
    let registry = AppRegistry::load(state.app_roots());
    let mut data = serde_json::Map::new();
    data.insert(
        "count".to_owned(),
        Value::from(registry.list_payloads().len()),
    );
    publish_apps_event(
        &state,
        AppsEvent::new("registry_reloaded", Value::Object(data.clone())),
    );
    publish_catalog_snapshot(&state).await;
    Json(ApiResponse { ok: true, data })
}

async fn apps_ws(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    // `/ws/apps` is the launcher/app-shell live state lane. Every client gets
    // the current snapshot first, then compatible lifecycle update messages.
    ws.on_upgrade(move |socket| handle_apps_ws(socket, state))
        .into_response()
}

async fn handle_apps_ws(mut socket: WebSocket, state: AppState) {
    if send_apps_ws_event(
        &mut socket,
        AppsEvent::new("apps_snapshot", apps_snapshot_payload(&state).await),
    )
    .await
    .is_err()
    {
        return;
    }

    let mut events = state.apps_events().subscribe();
    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    _ => {}
                }
            }
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        if send_apps_ws_event(&mut socket, event).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let event = AppsEvent::new("catalog_snapshot", apps_snapshot_payload(&state).await);
                        if send_apps_ws_event(&mut socket, event).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn send_apps_ws_event(socket: &mut WebSocket, event: AppsEvent) -> Result<(), axum::Error> {
    socket
        .send(Message::Text(event.ws_message().to_string().into()))
        .await
}

async fn apps_events_sse(State(state): State<AppState>) -> Response {
    // SSE mirrors the same event names as the Python apps extension while also
    // emitting an initial snapshot so new clients can hydrate without a GET.
    let initial_state = state.clone();
    let initial = stream::once(async move {
        Ok::<Event, Infallible>(
            AppsEvent::new("apps_snapshot", apps_snapshot_payload(&initial_state).await)
                .sse_event(),
        )
    });
    let update_state = state.clone();
    let updates = stream::unfold(
        (state.apps_events().subscribe(), update_state),
        |(mut events, state)| async move {
            loop {
                match events.recv().await {
                    Ok(event) => {
                        return Some((Ok::<Event, Infallible>(event.sse_event()), (events, state)));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let event =
                            AppsEvent::new("catalog_snapshot", apps_snapshot_payload(&state).await)
                                .sse_event();
                        return Some((Ok::<Event, Infallible>(event), (events, state)));
                    }
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        },
    );
    let mut response = Sse::new(initial.chain(updates))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(25))
                .text("ping"),
        )
        .into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
    response
}

async fn apps_snapshot_payload(state: &AppState) -> Value {
    // Launcher snapshots combine the manifest registry with read-only FWS
    // discovery so running markers work before lifecycle mutation is ported.
    let registry = AppRegistry::load(state.app_roots());
    let running_ids = running_app_ids(&registry);
    let readiness = state.readiness_store().read().await;
    let mut sorted_running_ids = running_ids.iter().cloned().collect::<Vec<_>>();
    sorted_running_ids.sort();

    json!({
        "catalog": catalog_payloads_with_running_and_readiness(&registry, &running_ids, &readiness),
        "running_ids": sorted_running_ids,
    })
}

fn publish_apps_event(state: &AppState, event: AppsEvent) {
    let _ = state.apps_events().send(event);
}

#[cfg(feature = "ferrous-framework-native")]
pub(crate) fn start_fws_lifecycle_app_bridge(
    state: AppState,
    manager: Option<FerrousNativeManager>,
) {
    let Some(manager) = manager else {
        return;
    };
    let mut lifecycle = manager.subscribe_lifecycle();
    tokio::spawn(async move {
        loop {
            match lifecycle.recv().await {
                Ok(event) => {
                    if !event.shell.is_app_worker {
                        continue;
                    }
                    let Some(app_id) = event.shell.app_id.clone() else {
                        continue;
                    };
                    let (trigger, running_override) = match event.kind {
                        FerrousNativeLifecycleEventKind::Spawned => {
                            ("fws_shell_spawned", Some(true))
                        }
                        FerrousNativeLifecycleEventKind::Updated => ("fws_shell_updated", None),
                        FerrousNativeLifecycleEventKind::Exited => {
                            ("fws_shell_exited", Some(false))
                        }
                    };
                    publish_app_running_changed(&state, &app_id, trigger, None, running_override)
                        .await;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

async fn publish_catalog_snapshot(state: &AppState) {
    publish_apps_event(
        state,
        AppsEvent::new("catalog_snapshot", apps_snapshot_payload(state).await),
    );
}

async fn publish_app_running_changed(
    state: &AppState,
    app_id: &str,
    trigger: &str,
    app_info: Option<&Value>,
    running_override: Option<bool>,
) {
    let registry = AppRegistry::load(state.app_roots());
    let running = running_app_for_id(&registry, app_id);
    let running_flag = running_override.unwrap_or_else(|| running.is_some());
    let shell_id = running
        .as_ref()
        .map(|app| app.shell_id.clone())
        .or_else(|| {
            app_info
                .and_then(Value::as_object)
                .and_then(|object| object.get("shell_id"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        });

    publish_catalog_snapshot(state).await;
    publish_apps_event(
        state,
        AppsEvent::new(
            "app_running_changed",
            json!({
                "app_id": app_id,
                "running": running_flag,
                "event_type": trigger,
                "shell_id": shell_id,
            }),
        ),
    );
}

fn running_app_ids(registry: &AppRegistry) -> HashSet<String> {
    discover_running_apps(registry)
        .into_iter()
        .map(|app| app.app_id)
        .collect()
}

fn running_app_payloads(
    registry: &AppRegistry,
    readiness_store: &HashMap<String, JsonMap<String, Value>>,
) -> Vec<Value> {
    discover_running_apps(registry)
        .into_iter()
        .map(|app| running_app_to_value(registry, app, readiness_store))
        .collect()
}

pub(crate) fn running_app_for_id(registry: &AppRegistry, app_id: &str) -> Option<RunningApp> {
    let app_id = app_id.trim();
    if !registry.contains_app(app_id) {
        return None;
    }
    discover_running_apps(registry)
        .into_iter()
        .find(|app| app.app_id == app_id)
}

fn discover_running_apps(registry: &AppRegistry) -> Vec<RunningApp> {
    // FWS remains the authority for already-running app workers in this slice;
    // the Rust server filters that read model to apps known by the registry.
    FwsDiscovery::from_env()
        .list_running_apps()
        .into_iter()
        .filter(|app| registry.contains_app(&app.app_id))
        .collect()
}

fn running_app_to_value(
    registry: &AppRegistry,
    app: RunningApp,
    readiness_store: &HashMap<String, JsonMap<String, Value>>,
) -> Value {
    let app_id = app.app_id.clone();
    let mut payload = serde_json::to_value(app)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if let Some(readiness) = readiness_store.get(&app_id) {
        payload.insert("readiness".to_owned(), Value::Object(readiness.clone()));
    } else if registry
        .get_app(&app_id)
        .is_some_and(|app| app.readiness_support && app.backend_module().is_some())
    {
        payload.insert(
            "readiness".to_owned(),
            json!({ "app_id": app_id, "status": "starting" }),
        );
    }
    registry.augment_running_payload(&app_id, &mut payload);
    Value::Object(payload)
}

async fn wait_for_running_app(
    app_roots: &[AppRoot],
    app_id: &str,
    shell_id: &str,
) -> Option<RunningApp> {
    for _ in 0..30 {
        let registry = AppRegistry::load(app_roots);
        if let Some(running) = running_app_for_id(&registry, app_id) {
            if running.shell_id == shell_id || running.app_id == app_id {
                return Some(running);
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    None
}

fn readiness_manifest_or_error<'a>(
    registry: &'a AppRegistry,
    app_id: &str,
) -> Result<&'a registry::AppDefinition, Response> {
    let Some(app) = registry.get_app(app_id) else {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            &format!("App '{app_id}' not found"),
        ));
    };
    if !app.readiness_support {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            &format!("App '{app_id}' does not support readiness"),
        ));
    }
    Ok(app)
}

fn normalize_readiness_status(status: &str) -> String {
    let lowered = status.trim().to_ascii_lowercase();
    match lowered.as_str() {
        "loading" => "starting".to_owned(),
        "ok" | "up" | "serving" => "ready".to_owned(),
        _ => lowered,
    }
}

async fn ensure_starting_readiness_if_supported(state: &AppState, app: &registry::AppDefinition) {
    if !app.readiness_support || app.backend_module().is_none() {
        return;
    }
    let mut readiness = state.readiness_store().write().await;
    let existing_status = readiness
        .get(&app.app_id)
        .and_then(|value| value.get("status"))
        .and_then(Value::as_str)
        .map(normalize_readiness_status);
    if matches!(existing_status.as_deref(), Some("ready" | "starting")) {
        return;
    }
    let entry = readiness.entry(app.app_id.clone()).or_default();
    entry.insert("app_id".to_owned(), Value::String(app.app_id.clone()));
    entry.insert("status".to_owned(), Value::String("starting".to_owned()));
}

fn catalog_payloads_with_running_and_readiness(
    registry: &AppRegistry,
    running_ids: &HashSet<String>,
    readiness_store: &HashMap<String, JsonMap<String, Value>>,
) -> Vec<Value> {
    registry
        .catalog_payloads_with_running(running_ids)
        .into_iter()
        .map(|payload| {
            let Some(mut object) = payload.as_object().cloned() else {
                return payload;
            };
            let Some(app_id) = object.get("id").and_then(Value::as_str).map(str::to_owned) else {
                return Value::Object(object);
            };
            if let Some(readiness) = readiness_store.get(&app_id) {
                object.insert("readiness".to_owned(), Value::Object(readiness.clone()));
            } else if running_ids.contains(&app_id)
                && registry
                    .get_app(&app_id)
                    .is_some_and(|app| app.readiness_support && app.backend_module().is_some())
            {
                object.insert(
                    "readiness".to_owned(),
                    json!({ "app_id": app_id, "status": "starting" }),
                );
            }
            Value::Object(object)
        })
        .collect()
}
