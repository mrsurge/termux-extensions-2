#[cfg(feature = "ferrous-framework-native")]
use ferrous_framework::{
    FerrousNativeLifecycleEventKind, FerrousNativeManager, FerrousNativeShellRecord,
    FerrousNativeShellStatus,
};

use axum::{
    Json, Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Path, Query, State},
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
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::broadcast;
use tokio::time::Duration;
use tracing::warn;
use url::form_urlencoded;

#[cfg(feature = "ferrous-framework-native")]
use crate::app_worker_pipe_bridge;
use crate::{
    ApiResponse, AppState,
    framework_services::{
        settings_ops::{self, SettingsStore},
        state_ops::{self, StateReadRequest, StateStore},
    },
    json_error,
    launcher::{launch_app, launch_supported},
    proxy_transport::absolute_upstream_url,
    registry::{self, AppRegistry},
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

// App-scoped SSE clients receive every frontend boot fact in the initial snapshot.
#[derive(Debug, Default, Deserialize)]
struct AppsEventsQuery {
    app_id: Option<String>,
}

const CODE_TE2_APP_ID: &str = "code_te2";
const LEGACY_CODE_TE2_APP_STATE_KEY: &str = "app_state:file_editor_cm6";

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
    let registry = state.app_registry_snapshot();
    Json(ApiResponse {
        ok: true,
        data: registry.list_payloads(),
    })
}

async fn apps_catalog(State(state): State<AppState>) -> Json<ApiResponse<Vec<Value>>> {
    let registry = state.app_registry_snapshot();
    let running_ids = running_app_ids(&state);
    let readiness = state.readiness_store().read().await;
    Json(ApiResponse {
        ok: true,
        data: catalog_payloads_with_running_and_readiness(&registry, &running_ids, &readiness),
    })
}

async fn running_apps(State(state): State<AppState>) -> Json<ApiResponse<Vec<Value>>> {
    let registry = state.app_registry_snapshot();
    let readiness = state.readiness_store().read().await;
    Json(ApiResponse {
        ok: true,
        data: running_app_payloads(&state, &registry, &readiness),
    })
}

async fn start_app(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    match start_app_inner(&state, &app_id).await {
        Ok((canonical_app_id, data)) => {
            publish_app_running_changed(&state, &canonical_app_id, "start", Some(&data), None)
                .await;
            Json(ApiResponse { ok: true, data }).into_response()
        }
        Err(response) => response,
    }
}

async fn start_app_inner(state: &AppState, app_id: &str) -> Result<(String, Value), Response> {
    let registry = state.app_registry_snapshot();
    let Some(app) = registry.get_app(app_id).cloned() else {
        return Err(json_error(
            StatusCode::NOT_FOUND,
            &format!("App '{app_id}' not found"),
        ));
    };
    let canonical_app_id = app.app_id.clone();
    if !app.enabled {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("App '{app_id}' is disabled"),
        ));
    }
    ensure_starting_readiness_if_supported(state, &app).await;
    if let Some(running) = state.running_app_for_id(&canonical_app_id) {
        ensure_pipe_bridge_for_running_app(state, &running);
        let readiness = state.readiness_store().read().await;
        return Ok((
            canonical_app_id,
            running_app_to_value(&registry, running, &readiness),
        ));
    }
    if app.backend_module().is_none() && app.shells.is_empty() {
        return Ok((
            canonical_app_id.clone(),
            json!({
                "app_id": canonical_app_id,
                "message": "No backend to start",
            }),
        ));
    }
    if !launch_supported() {
        return Err(json_error(
            StatusCode::NOT_IMPLEMENTED,
            "TE2 server was built without the ferrous-framework-native feature.",
        ));
    }

    let project_root = PathBuf::from(state.project_root());
    let framework_url = state.framework_url();
    let framework_port = state.framework_port();
    let framework_shells_env = state.fws_child_env().clone();
    let launch_store = state.launch_store().clone();
    let launch_result = match tokio::task::spawn_blocking(move || {
        launch_app(
            &launch_store,
            &app,
            &project_root,
            &framework_url,
            framework_port,
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
        wait_for_running_app(state, &canonical_app_id, &launch_result.shell_id).await
    {
        ensure_pipe_bridge_for_running_app(state, &running);
        let readiness = state.readiness_store().read().await;
        return Ok((
            canonical_app_id,
            running_app_to_value(&registry, running, &readiness),
        ));
    }

    Ok((
        canonical_app_id.clone(),
        serde_json::to_value(launch_result)
            .unwrap_or_else(|_| json!({ "app_id": canonical_app_id })),
    ))
}

async fn open_app(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    payload: Option<Json<OpenAppRequest>>,
) -> Response {
    let params = payload.map(|Json(body)| body.params).unwrap_or_default();
    let (canonical_app_id, app_info) = match start_app_inner(&state, &app_id).await {
        Ok(result) => result,
        Err(response) => return response,
    };
    publish_app_running_changed(&state, &canonical_app_id, "open", Some(&app_info), None).await;

    let mut url = format!("/app/{canonical_app_id}");
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
    let registry = state.app_registry_snapshot();
    let Some(canonical_app_id) = registry.canonical_app_id(&app_id).map(str::to_owned) else {
        return json_error(StatusCode::NOT_FOUND, &format!("App '{app_id}' not found"));
    };

    let root_pids = FwsDiscovery::from_env().root_pids_for_app(&canonical_app_id);
    if root_pids.is_empty() {
        return json_error(
            StatusCode::NOT_FOUND,
            "App is not running or already terminated.",
        );
    }

    let Some(upstream) = absolute_upstream_url(
        state.fws_upstream_base_url(),
        &format!("/api/framework_shells/app/{canonical_app_id}/shutdown"),
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
            warn!(%error, app_id = %canonical_app_id, %upstream, "failed to reach FWS app shutdown action");
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to terminate app group for '{canonical_app_id}'."),
            );
        }
    };
    if !response.status().is_success() {
        warn!(
            status = %response.status(),
            app_id = %canonical_app_id,
            %upstream,
            "FWS app shutdown action returned non-success"
        );
        return json_error(
            StatusCode::BAD_GATEWAY,
            &format!("Failed to terminate app group for '{canonical_app_id}'."),
        );
    }

    state
        .readiness_store()
        .write()
        .await
        .remove(&canonical_app_id);
    state.remove_running_app(&canonical_app_id, None);
    publish_app_running_changed(&state, &canonical_app_id, "quit", None, Some(false)).await;
    Json(ApiResponse {
        ok: true,
        data: json!({
            "message": format!("App {canonical_app_id} terminated."),
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
    let registry = state.app_registry_snapshot();
    let app = match readiness_manifest_or_error(&registry, &app_id) {
        Ok(app) => app,
        Err(response) => return response,
    };
    let canonical_app_id = app.app_id.clone();
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
        .insert(canonical_app_id.clone(), readiness.clone());
    publish_apps_event(
        &state,
        AppsEvent::new(
            "app_readiness_changed",
            json!({ "app_id": canonical_app_id, "readiness": readiness.clone() }),
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
    let registry = state.app_registry_snapshot();
    let canonical_app_id = match readiness_manifest_or_error(&registry, &app_id) {
        Ok(app) => app.app_id.clone(),
        Err(response) => return response,
    };
    if let Some(readiness) = state
        .readiness_store()
        .read()
        .await
        .get(&canonical_app_id)
        .cloned()
    {
        return Json(ApiResponse {
            ok: true,
            data: Value::Object(readiness),
        })
        .into_response();
    }
    let data = if state.running_app_for_id(&canonical_app_id).is_some() {
        json!({ "app_id": canonical_app_id, "status": "starting" })
    } else {
        json!({ "app_id": canonical_app_id, "status": "stopped" })
    };
    Json(ApiResponse { ok: true, data }).into_response()
}

async fn reload_apps(
    State(state): State<AppState>,
) -> Json<ApiResponse<serde_json::Map<String, Value>>> {
    let registry = AppRegistry::load(state.app_roots());
    state.replace_app_registry(registry.clone());
    state.replace_running_apps(discover_running_apps(&registry));
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
        AppsEvent::new("apps_snapshot", apps_snapshot_payload(&state, None).await),
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
                        let event = AppsEvent::new(
                            "catalog_snapshot",
                            apps_snapshot_payload(&state, None).await,
                        );
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

async fn apps_events_sse(
    State(state): State<AppState>,
    Query(query): Query<AppsEventsQuery>,
) -> Response {
    // SSE mirrors the same event names as the Python apps extension while also
    // emitting an initial snapshot so new clients can hydrate without a GET.
    let initial_state = state.clone();
    let app_id = normalized_app_id(query.app_id);
    let initial_app_id = app_id.clone();
    let initial = stream::once(async move {
        Ok::<Event, Infallible>(
            AppsEvent::new(
                "apps_snapshot",
                apps_snapshot_payload(&initial_state, initial_app_id.as_deref()).await,
            )
            .sse_event(),
        )
    });
    let update_state = state.clone();
    let updates = stream::unfold(
        (state.apps_events().subscribe(), update_state, app_id),
        |(mut events, state, app_id)| async move {
            loop {
                match events.recv().await {
                    Ok(event) => {
                        return Some((
                            Ok::<Event, Infallible>(event.sse_event()),
                            (events, state, app_id),
                        ));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let event = AppsEvent::new(
                            "catalog_snapshot",
                            apps_snapshot_payload(&state, app_id.as_deref()).await,
                        )
                        .sse_event();
                        return Some((Ok::<Event, Infallible>(event), (events, state, app_id)));
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

async fn apps_snapshot_payload(state: &AppState, app_id: Option<&str>) -> Value {
    let registry = state.app_registry_snapshot();
    let running_ids = running_app_ids(state);
    let mut catalog = {
        let readiness = state.readiness_store().read().await;
        catalog_payloads_with_running_and_readiness(&registry, &running_ids, &readiness)
    };
    let mut sorted_running_ids = running_ids.iter().cloned().collect::<Vec<_>>();
    let canonical_app_id = app_id.and_then(|app_id| registry.canonical_app_id(app_id));
    if app_id.is_some() {
        catalog.retain(|app| app.get("id").and_then(Value::as_str) == canonical_app_id);
        sorted_running_ids.retain(|running_id| Some(running_id.as_str()) == canonical_app_id);
    }
    sorted_running_ids.sort();

    let mut payload = json!({
        "catalog": catalog,
        "running_ids": sorted_running_ids,
    });
    if let Some((app_id, app)) = canonical_app_id.and_then(|app_id| {
        registry
            .app_payload(app_id)
            .map(|app| (app_id.to_owned(), app))
    }) {
        payload["app_bootstrap"] = app_bootstrap_payload(app_id, app).await;
    }
    payload
}

fn normalized_app_id(app_id: Option<String>) -> Option<String> {
    app_id
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

async fn app_bootstrap_payload(app_id: String, app: Value) -> Value {
    let fallback_app_id = app_id.clone();
    let fallback_app = app.clone();
    match tokio::task::spawn_blocking(move || {
        let state_key = format!("app_state:{app_id}");
        let store = StateStore::default();
        let state = if app_id == CODE_TE2_APP_ID {
            state_ops::move_state_key_if_present(&store, LEGACY_CODE_TE2_APP_STATE_KEY, &state_key)
                .unwrap_or_else(|_| {
                    state_ops::get_state(
                        &store,
                        StateReadRequest {
                            keys: vec![state_key.clone()],
                        },
                    )
                    .ok()
                    .and_then(|mut values| values.remove(&state_key))
                    .unwrap_or(Value::Null)
                })
        } else {
            state_ops::get_state(
                &store,
                StateReadRequest {
                    keys: vec![state_key.clone()],
                },
            )
            .ok()
            .and_then(|mut values| values.remove(&state_key))
            .unwrap_or(Value::Null)
        };
        let settings = settings_ops::load_settings(&SettingsStore::default());
        let debug_full_stack = settings
            .get("debugFullStack")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        build_app_bootstrap_payload(&app_id, app, state, debug_full_stack)
    })
    .await
    {
        Ok(payload) => payload,
        Err(error) => {
            warn!(%error, app_id = %fallback_app_id, "app bootstrap snapshot task failed");
            build_app_bootstrap_payload(&fallback_app_id, fallback_app, Value::Null, false)
        }
    }
}

fn build_app_bootstrap_payload(
    app_id: &str,
    app: Value,
    state: Value,
    debug_full_stack: bool,
) -> Value {
    let state_key = format!("app_state:{app_id}");
    json!({
        "app_id": app_id,
        "app": app,
        "state_key": state_key,
        "state": state,
        "debug_full_stack": debug_full_stack,
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
                    if event.shell.backend == "pipe"
                        && event.shell.status == FerrousNativeShellStatus::Running
                    {
                        app_worker_pipe_bridge::ensure_bridge(
                            Some(manager.clone()),
                            event.shell_id.clone(),
                            app_id.clone(),
                            state.service_scheduler().clone(),
                        );
                    }
                    let (trigger, running_override) = match event.kind {
                        FerrousNativeLifecycleEventKind::Spawned => {
                            let indexed = if let Some(running) =
                                running_app_from_native_shell(&event.shell)
                            {
                                state.upsert_running_app(running);
                                true
                            } else {
                                false
                            };
                            ("fws_shell_spawned", Some(indexed))
                        }
                        FerrousNativeLifecycleEventKind::Updated => {
                            if let Some(running) = running_app_from_native_shell(&event.shell) {
                                state.upsert_running_app(running);
                            } else {
                                state.remove_running_app(&app_id, Some(&event.shell_id));
                            }
                            ("fws_shell_updated", None)
                        }
                        FerrousNativeLifecycleEventKind::Exited => {
                            state.remove_running_app(&app_id, Some(&event.shell_id));
                            ("fws_shell_exited", Some(false))
                        }
                    };
                    publish_app_running_changed(&state, &app_id, trigger, None, running_override)
                        .await;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let registry = state.app_registry_snapshot();
                    state.replace_running_apps(discover_running_apps(&registry));
                    publish_catalog_snapshot(&state).await;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

#[cfg(feature = "ferrous-framework-native")]
fn ensure_pipe_bridge_for_running_app(state: &AppState, running: &RunningApp) {
    app_worker_pipe_bridge::ensure_bridge(
        state.launch_store().manager(),
        running.shell_id.clone(),
        running.app_id.clone(),
        state.service_scheduler().clone(),
    );
}

#[cfg(not(feature = "ferrous-framework-native"))]
fn ensure_pipe_bridge_for_running_app(_state: &AppState, _running: &RunningApp) {}

async fn publish_catalog_snapshot(state: &AppState) {
    publish_apps_event(
        state,
        AppsEvent::new("catalog_snapshot", apps_snapshot_payload(state, None).await),
    );
}

async fn publish_app_running_changed(
    state: &AppState,
    app_id: &str,
    trigger: &str,
    app_info: Option<&Value>,
    running_override: Option<bool>,
) {
    let registry = state.app_registry_snapshot();
    let Some(canonical_app_id) = registry.canonical_app_id(app_id) else {
        return;
    };
    let running = state.running_app_for_id(canonical_app_id);
    let running_flag = running.is_some() || running_override == Some(true);
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
                "app_id": canonical_app_id,
                "running": running_flag,
                "event_type": trigger,
                "shell_id": shell_id,
            }),
        ),
    );
}

fn running_app_ids(state: &AppState) -> HashSet<String> {
    state
        .running_apps_snapshot()
        .into_iter()
        .map(|app| app.app_id)
        .collect()
}

fn running_app_payloads(
    state: &AppState,
    registry: &AppRegistry,
    readiness_store: &HashMap<String, JsonMap<String, Value>>,
) -> Vec<Value> {
    state
        .running_apps_snapshot()
        .into_iter()
        .map(|app| running_app_to_value(registry, app, readiness_store))
        .collect()
}

pub(crate) fn discover_running_apps(registry: &AppRegistry) -> Vec<RunningApp> {
    // Discovery is a startup/reconciliation operation only. Request-time proxy
    // lookup reads AppState's lifecycle-maintained running-app index.
    let mut apps_by_id: HashMap<String, RunningApp> = HashMap::new();
    for mut app in FwsDiscovery::from_env().list_running_apps().into_iter() {
        let Some(canonical_app_id) = registry.canonical_app_id(&app.app_id) else {
            continue;
        };
        app.app_id = canonical_app_id.to_owned();
        match apps_by_id.get(canonical_app_id) {
            Some(existing) if existing.updated_at >= app.updated_at => {}
            _ => {
                apps_by_id.insert(canonical_app_id.to_owned(), app);
            }
        }
    }
    let mut apps = apps_by_id.into_values().collect::<Vec<_>>();
    apps.sort_by(|left, right| left.app_id.cmp(&right.app_id));
    apps
}

fn running_app_to_value(
    registry: &AppRegistry,
    mut app: RunningApp,
    readiness_store: &HashMap<String, JsonMap<String, Value>>,
) -> Value {
    app.uptime = (current_unix_seconds() - app.created_at).max(0.0);
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
    state: &AppState,
    app_id: &str,
    shell_id: &str,
) -> Option<RunningApp> {
    let mut events = state.apps_events().subscribe();
    let wait = async {
        loop {
            if let Some(running) = state.running_app_for_id(app_id) {
                if running.shell_id == shell_id {
                    return Some(running);
                }
            }
            match events.recv().await {
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(3), wait)
        .await
        .ok()
        .flatten()
}

#[cfg(feature = "ferrous-framework-native")]
fn running_app_from_native_shell(shell: &FerrousNativeShellRecord) -> Option<RunningApp> {
    if shell.status != FerrousNativeShellStatus::Running || !shell.is_app_worker {
        return None;
    }
    let app_id = shell.app_id.clone()?;
    let port = shell
        .env_overrides
        .get("TE_APP_WORKER_PORT")
        .or_else(|| shell.env.get("TE_APP_WORKER_PORT"))?
        .trim()
        .parse::<u16>()
        .ok()?;
    let created_at = shell.created_at_ms as f64 / 1000.0;
    let updated_at = shell.updated_at_ms as f64 / 1000.0;
    let now = current_unix_seconds();
    Some(RunningApp {
        app_id,
        port,
        shell_id: shell.id.clone(),
        label: (!shell.label.is_empty()).then(|| shell.label.clone()),
        source: "ferrous_framework_native",
        created_at,
        updated_at,
        locked: false,
        uptime: (now - created_at).max(0.0),
        cpu: 0.0,
        ram: 0,
        readiness: JsonMap::new(),
    })
}

fn current_unix_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .unwrap_or_default()
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

#[cfg(test)]
mod tests {
    use super::{build_app_bootstrap_payload, normalized_app_id};
    use serde_json::json;

    #[test]
    fn apps_events_app_id_is_trimmed_and_empty_values_are_ignored() {
        assert_eq!(
            normalized_app_id(Some("  code_te2  ".to_owned())),
            Some("code_te2".to_owned())
        );
        assert_eq!(normalized_app_id(Some("   ".to_owned())), None);
        assert_eq!(normalized_app_id(None), None);
    }

    #[test]
    fn app_bootstrap_snapshot_carries_state_and_debug_contract() {
        let payload = build_app_bootstrap_payload(
            "code_te2",
            json!({
                "id": "code_te2",
                "entrypoints": { "frontend_template": "template.html" },
            }),
            json!({ "activeProject": "/workspace" }),
            true,
        );

        assert_eq!(payload["app_id"], "code_te2");
        assert_eq!(
            payload["app"]["entrypoints"]["frontend_template"],
            "template.html"
        );
        assert_eq!(payload["state_key"], "app_state:code_te2");
        assert_eq!(payload["state"]["activeProject"], "/workspace");
        assert_eq!(payload["debug_full_stack"], true);
    }
}
