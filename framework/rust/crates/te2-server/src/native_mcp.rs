//! Native framework MCP tools using existing runtime owners, never copied state.
use crate::{AppState, apps_lifecycle};
use rmcp::{
    ErrorData, RoleServer, ServerHandler,
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
    },
    service::RequestContext,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{future::Future, path::PathBuf, pin::Pin};

type OwnerFuture<'a> = Pin<Box<dyn Future<Output = Result<Value, String>> + Send + 'a>>;

pub(crate) fn router(
    state: AppState,
    cancellation: tokio_util::sync::CancellationToken,
) -> axum::Router<AppState> {
    let mut hosts = vec![
        "localhost".to_owned(),
        "127.0.0.1".to_owned(),
        "::1".to_owned(),
    ];
    hosts.extend(
        state
            .config
            .bind_hosts
            .iter()
            .filter(|ip| !ip.is_unspecified())
            .map(ToString::to_string),
    );
    if state
        .config
        .host
        .parse::<std::net::IpAddr>()
        .is_ok_and(|ip| !ip.is_unspecified())
    {
        hosts.push(state.config.host.clone());
    }
    let tools = NativeAppTools::new(FrameworkAppOwner(state)).expect("verified native MCP catalog");
    http_router_with_hosts(tools, cancellation, hosts).with_state(())
}

#[cfg(test)]
fn http_router<O: AppToolOwner>(
    tools: NativeAppTools<O>,
    cancellation: tokio_util::sync::CancellationToken,
) -> axum::Router {
    http_router_with_hosts(
        tools,
        cancellation,
        vec!["localhost".into(), "127.0.0.1".into(), "::1".into()],
    )
}

fn http_router_with_hosts<O: AppToolOwner>(
    tools: NativeAppTools<O>,
    cancellation: tokio_util::sync::CancellationToken,
    hosts: Vec<String>,
) -> axum::Router {
    use rmcp::transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    };
    let config = StreamableHttpServerConfig::default()
        .with_allowed_hosts(hosts)
        .with_json_response(true)
        .with_max_request_body_bytes(crate::native_mcp_http_compat::MAX_REQUEST_BYTES)
        .with_cancellation_token(cancellation);
    let service = StreamableHttpService::new(
        move || Ok(tools.clone()),
        LocalSessionManager::default().into(),
        config,
    );
    // Exact root and trailing slash share one session manager. No proxy fallback
    // and no wildcard aliases to accidental private owner routes.
    axum::Router::new()
        .route_service("/te2_mcp_http", service.clone())
        .route_service("/te2_mcp_http/", service)
        .layer(axum::middleware::from_fn(
            crate::native_mcp_http_compat::compatibility,
        ))
}

pub(crate) trait AppToolOwner: Clone + Send + Sync + 'static {
    fn reload(&self) -> OwnerFuture<'_>;
    fn start(&self, app_id: String) -> OwnerFuture<'_>;
    fn open(&self, app_id: String) -> OwnerFuture<'_>;
    fn console(&self, payload: Option<Value>, timeout: f64) -> OwnerFuture<'_>;
    fn scaffold(&self, call: crate::native_mcp_scaffold::ScaffoldCall) -> OwnerFuture<'_>;
    #[cfg(feature = "ferrous-framework-native")]
    fn debug(&self, call: DebugCall) -> OwnerFuture<'_>;
    #[cfg(feature = "ferrous-framework-native")]
    fn fws(&self, call: crate::native_mcp_fws::FwsCall) -> OwnerFuture<'_>;
    #[cfg(feature = "ferrous-framework-native")]
    fn shortcut(&self, input: crate::native_mcp_sidebar::ShortcutInput) -> OwnerFuture<'_>;
}

#[cfg(feature = "ferrous-framework-native")]
pub(crate) enum DebugCall {
    Capability {
        credential: String,
        target: crate::runtime_debug_pipe::DebugTarget,
        capability: String,
        params: Value,
        timeout_seconds: u64,
    },
    Workers {
        credential: String,
    },
    Target {
        credential: String,
        target: crate::runtime_debug_pipe::DebugTarget,
        code: Option<String>,
        timeout_seconds: u64,
        eval: bool,
    },
}

#[derive(Clone)]
pub(crate) struct FrameworkAppOwner(pub(crate) AppState);

async fn failure(response: axum::response::Response) -> String {
    let status = response.status();
    // Only inspect bounded local error responses, never replay a mutation.
    match axum::body::to_bytes(response.into_body(), 64 * 1024).await {
        Ok(bytes) => format!(
            "Framework app action failed ({status}): {}",
            String::from_utf8_lossy(&bytes)
        ),
        Err(_) => format!("Framework app action failed ({status})"),
    }
}

impl AppToolOwner for FrameworkAppOwner {
    #[cfg(feature = "ferrous-framework-native")]
    fn shortcut(&self, input: crate::native_mcp_sidebar::ShortcutInput) -> OwnerFuture<'_> {
        Box::pin(async move {
            let app_id = input.app_id.trim();
            if app_id.is_empty() {
                return Ok(json!({"ok":false,"error":"app_id is required"}));
            }
            let registry = self.0.app_registry_snapshot();
            let Some(manifest) = registry.apps().iter().find(|app| app.app_id == app_id) else {
                return Ok(
                    json!({"ok":false,"error":format!("App not found in framework catalog: {app_id}")}),
                );
            };
            let params = crate::native_mcp_sidebar::project(input, &manifest.name);
            crate::app_intent_pipe::add_mcp_shortcut(&self.0, params)
                .await
                .map_err(|e| e.to_string())
        })
    }
    fn scaffold(&self, call: crate::native_mcp_scaffold::ScaffoldCall) -> OwnerFuture<'_> {
        Box::pin(async move {
            let key = std::env::var("TE2_RUNTIME_OWNER_KEY").unwrap_or_default();
            crate::native_mcp_scaffold::dispatch(self.0.te2_runtime_upstream_base_url(), &key, call)
                .await
        })
    }
    #[cfg(feature = "ferrous-framework-native")]
    fn fws(&self, call: crate::native_mcp_fws::FwsCall) -> OwnerFuture<'_> {
        Box::pin(async move {
            let manager = self
                .0
                .launch_store
                .manager()
                .ok_or("Framework native manager unavailable")?;
            if let crate::native_mcp_fws::FwsCall::Log {
                shell_id,
                operation,
                options,
            } = call
            {
                let payload = tokio::task::spawn_blocking(move || {
                    crate::native_mcp_fws::prepare_log_request(
                        &manager, &shell_id, operation, options,
                    )
                })
                .await
                .map_err(|e| e.to_string())??;
                let key = std::env::var("TE2_RUNTIME_OWNER_KEY").unwrap_or_default();
                return crate::native_mcp_live_console::request_owner(
                    self.0.te2_runtime_upstream_base_url(),
                    &key,
                    "/internal/fws-log/project",
                    Some(payload),
                    30.0,
                )
                .await;
            }
            tokio::task::spawn_blocking(move || crate::native_mcp_fws::dispatch(&manager, call))
                .await
                .map_err(|e| e.to_string())?
        })
    }
    fn console(&self, payload: Option<Value>, timeout: f64) -> OwnerFuture<'_> {
        Box::pin(async move {
            let key = std::env::var("TE2_RUNTIME_OWNER_KEY").unwrap_or_default();
            crate::native_mcp_live_console::request(
                self.0.te2_runtime_upstream_base_url(),
                &key,
                payload,
                timeout,
            )
            .await
        })
    }
    #[cfg(feature = "ferrous-framework-native")]
    fn debug(&self, call: DebugCall) -> OwnerFuture<'_> {
        Box::pin(async move {
            Ok(match call {
                DebugCall::Capability {
                    credential,
                    target,
                    capability,
                    params,
                    timeout_seconds,
                } => {
                    crate::runtime_debug_http::native_operation(
                        &self.0,
                        &credential,
                        target,
                        &capability,
                        params,
                        timeout_seconds,
                    )
                    .await
                }
                DebugCall::Workers { credential } => {
                    crate::runtime_debug_http::native_workers(&credential)
                }
                DebugCall::Target {
                    credential,
                    target,
                    code,
                    timeout_seconds,
                    eval,
                } => {
                    crate::runtime_debug_http::native_dispatch(
                        &credential,
                        target,
                        code,
                        timeout_seconds,
                        eval,
                    )
                    .await
                }
            })
        })
    }
    fn reload(&self) -> OwnerFuture<'_> {
        Box::pin(async {
            apps_lifecycle::reload_apps_data(&self.0)
                .await
                .map(Value::Object)
        })
    }
    fn start(&self, app_id: String) -> OwnerFuture<'_> {
        Box::pin(async move {
            match apps_lifecycle::start_app_data(&self.0, &app_id).await {
                Ok(value) => Ok(value),
                Err(response) => Err(failure(response).await),
            }
        })
    }
    fn open(&self, app_id: String) -> OwnerFuture<'_> {
        Box::pin(async move {
            match apps_lifecycle::open_app_data(&self.0, &app_id, Default::default()).await {
                Ok(value) => Ok(value),
                Err(response) => Err(failure(response).await),
            }
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AppId {
    app_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}

#[cfg(feature = "ferrous-framework-native")]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ShellId {
    shell_id: String,
}
#[cfg(feature = "ferrous-framework-native")]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ShellWrite {
    shell_id: String,
    #[serde(default)]
    data: String,
    #[serde(default)]
    append_newline: bool,
    #[serde(default)]
    eof: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConsoleFilter {
    #[serde(default = "default_console_limit")]
    limit: i64,
    worker_id: Option<String>,
    level: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConsoleSearch {
    query: String,
    #[serde(default = "default_console_limit")]
    limit: i64,
    worker_id: Option<String>,
    level: Option<String>,
}

fn default_console_limit() -> i64 {
    100
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConsoleEval {
    target_worker_id: String,
    code: String,
    #[serde(default = "default_console_timeout")]
    timeout_seconds: f64,
}
fn default_console_timeout() -> f64 {
    20.0
}

#[cfg(feature = "ferrous-framework-native")]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Credential {
    credential: String,
}

#[cfg(feature = "ferrous-framework-native")]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DebugStatus {
    credential: String,
    app_id: String,
    shell_id: String,
    instance_id: String,
}

#[cfg(feature = "ferrous-framework-native")]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DebugEval {
    credential: String,
    app_id: String,
    shell_id: String,
    instance_id: String,
    code: String,
    #[serde(default = "default_debug_timeout")]
    timeout_seconds: u64,
}

#[cfg(feature = "ferrous-framework-native")]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WbaEval {
    credential: String,
    app_id: String,
    shell_id: String,
    instance_id: String,
    wba_shell_id: String,
    wba_instance_id: String,
    code: String,
    #[serde(default = "default_debug_timeout")]
    timeout_seconds: u64,
}

#[cfg(feature = "ferrous-framework-native")]
fn default_debug_timeout() -> u64 {
    20
}

fn supported_tool(name: &str) -> bool {
    if matches!(
        name,
        "te2_apps_reload"
            | "te2_app_start"
            | "te2_app_open"
            | "te2_console_workers"
            | "te2_console_tail"
            | "te2_console_search"
            | "te2_mcp_status"
            | "te2_console_workers_live"
            | "te2_console_eval"
            | "te2_apps_templates"
            | "te2_validate_proxy_wrapper"
            | "te2_scaffold_proxy_wrapper"
    ) {
        return true;
    }
    #[cfg(feature = "ferrous-framework-native")]
    if matches!(
        name,
        "te2_framework_workers"
            | "te2_framework_status"
            | "te2_framework_eval"
            | "te2_wba_status"
            | "te2_wba_eval"
            | "te2_fws_running"
            | "te2_fws_shell_get"
            | "te2_fws_shell_write"
            | "te2_fws_log_tail"
            | "te2_fws_log_search"
            | "te2_fws_log_inspect"
            | "te2_sidebar_add_app_shortcut"
    ) {
        return true;
    }
    false
}

#[derive(Clone)]
pub(crate) struct NativeAppTools<O: AppToolOwner> {
    owner: O,
    tools: Vec<Tool>,
    console_path: PathBuf,
}

impl<O: AppToolOwner> NativeAppTools<O> {
    pub(crate) fn new(owner: O) -> Result<Self, serde_json::Error> {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../mcp_probe/fixtures/python_tools.json"
        ))?;
        let mut tools = Vec::new();
        for tool in fixture["tools"].as_array().expect("verified catalog array") {
            if tool["name"].as_str().is_some_and(supported_tool) {
                tools.push(serde_json::from_value(tool.clone())?);
            }
        }
        assert_eq!(
            tools.len(),
            if cfg!(feature = "ferrous-framework-native") {
                24
            } else {
                12
            },
            "native catalog must contain all supported tools"
        );
        Ok(Self {
            owner,
            tools,
            console_path: crate::te2_paths::cache_home().join("console/te2_console_log.jsonl"),
        })
    }

    async fn dispatch(&self, name: &str, arguments: Value) -> Result<CallToolResult, ErrorData> {
        let invalid = |error: serde_json::Error| ErrorData::invalid_params(error.to_string(), None);
        #[cfg(feature = "ferrous-framework-native")]
        if name == "te2_sidebar_add_app_shortcut" {
            let input: crate::native_mcp_sidebar::ShortcutInput =
                serde_json::from_value(arguments).map_err(invalid)?;
            return Ok(match self.owner.shortcut(input).await {
                Ok(data) => CallToolResult::structured(data),
                Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
            });
        }
        #[cfg(feature = "ferrous-framework-native")]
        if matches!(
            name,
            "te2_fws_log_tail" | "te2_fws_log_search" | "te2_fws_log_inspect"
        ) {
            let (shell_id, operation, options) = crate::native_mcp_fws::parse_log(name, arguments)
                .map_err(|e| ErrorData::invalid_params(e, None))?;
            return Ok(
                match self
                    .owner
                    .fws(crate::native_mcp_fws::FwsCall::Log {
                        shell_id,
                        operation,
                        options,
                    })
                    .await
                {
                    Ok(data) => CallToolResult::structured(data),
                    Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
                },
            );
        }
        if matches!(
            name,
            "te2_apps_templates" | "te2_validate_proxy_wrapper" | "te2_scaffold_proxy_wrapper"
        ) {
            let call = crate::native_mcp_scaffold::parse(name, arguments)
                .map_err(|e| ErrorData::invalid_params(e, None))?;
            return Ok(match self.owner.scaffold(call).await {
                Ok(data) => CallToolResult::structured(data),
                Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
            });
        }
        #[cfg(feature = "ferrous-framework-native")]
        if matches!(
            name,
            "te2_fws_running" | "te2_fws_shell_get" | "te2_fws_shell_write"
        ) {
            use crate::native_mcp_fws::FwsCall;
            let call = match name {
                "te2_fws_running" => {
                    let _: Empty = serde_json::from_value(arguments).map_err(invalid)?;
                    FwsCall::Running
                }
                "te2_fws_shell_get" => {
                    let input: ShellId = serde_json::from_value(arguments).map_err(invalid)?;
                    FwsCall::Get {
                        shell_id: input.shell_id,
                    }
                }
                _ => {
                    let input: ShellWrite = serde_json::from_value(arguments).map_err(invalid)?;
                    FwsCall::Write {
                        shell_id: input.shell_id,
                        data: input.data,
                        append_newline: input.append_newline,
                        eof: input.eof,
                    }
                }
            };
            return Ok(match self.owner.fws(call).await {
                Ok(data) => CallToolResult::structured(data),
                Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
            });
        }
        if matches!(name, "te2_console_workers_live" | "te2_console_eval") {
            let (payload, timeout) = if name == "te2_console_workers_live" {
                let _: Empty = serde_json::from_value(arguments).map_err(invalid)?;
                (None, 20.0)
            } else {
                let input: ConsoleEval = serde_json::from_value(arguments).map_err(invalid)?;
                if input.target_worker_id.trim().is_empty()
                    || !input.timeout_seconds.is_finite()
                    || input.code.len() > 8 * 1024 * 1024
                {
                    return Err(ErrorData::invalid_params(
                        "Invalid console target/code/timeout",
                        None,
                    ));
                }
                (
                    Some(
                        json!({"target_worker_id":input.target_worker_id,"code":input.code,"timeout_seconds":input.timeout_seconds}),
                    ),
                    input.timeout_seconds,
                )
            };
            return Ok(match self.owner.console(payload, timeout).await {
                Ok(data) => CallToolResult::structured(data),
                Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
            });
        }
        if name == "te2_mcp_status" {
            let _: Empty = serde_json::from_value(arguments).map_err(invalid)?;
            return Ok(CallToolResult::structured(
                json!({"server":"te2-mcp","console_log_path":self.console_path,"framework_shells_enabled":cfg!(feature = "ferrous-framework-native"),"mode":"framework_owned_native"}),
            ));
        }
        #[cfg(feature = "ferrous-framework-native")]
        if matches!(name, "te2_wba_status" | "te2_wba_eval") {
            use crate::runtime_debug_pipe::DebugTarget;
            let (credential, target, params, timeout_seconds) = if name == "te2_wba_status" {
                let input: DebugStatus = serde_json::from_value(arguments).map_err(invalid)?;
                let params = json!({"operation":"status", "timeout_seconds":20});
                (
                    input.credential,
                    DebugTarget {
                        app_id: input.app_id,
                        shell_id: input.shell_id,
                        instance_id: input.instance_id,
                    },
                    params,
                    20,
                )
            } else {
                let input: WbaEval = serde_json::from_value(arguments).map_err(invalid)?;
                if input.wba_shell_id.is_empty()
                    || input.wba_instance_id.is_empty()
                    || input.code.is_empty()
                    || input.code.len() > 32 * 1024
                    || !(1..=30).contains(&input.timeout_seconds)
                {
                    return Err(ErrorData::invalid_params(
                        "WBA eval requires exact identities and bounded code/timeout",
                        None,
                    ));
                }
                let params = json!({"operation":"eval", "shell_id":input.wba_shell_id,
                    "instance_id":input.wba_instance_id,"code":input.code,"timeout_seconds":input.timeout_seconds});
                (
                    input.credential,
                    DebugTarget {
                        app_id: input.app_id,
                        shell_id: input.shell_id,
                        instance_id: input.instance_id,
                    },
                    params,
                    input.timeout_seconds,
                )
            };
            if target.app_id.is_empty()
                || target.shell_id.is_empty()
                || target.instance_id.is_empty()
            {
                return Err(ErrorData::invalid_params(
                    "WBA debug requires an exact parent identity",
                    None,
                ));
            }
            return Ok(
                match self
                    .owner
                    .debug(DebugCall::Capability {
                        credential,
                        target,
                        capability: "workbench.debug".into(),
                        params,
                        timeout_seconds,
                    })
                    .await
                {
                    Ok(data) => CallToolResult::structured(data),
                    Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
                },
            );
        }
        if matches!(
            name,
            "te2_console_workers" | "te2_console_tail" | "te2_console_search"
        ) {
            let path = self.console_path.clone();
            let task = match name {
                "te2_console_workers" => {
                    let _: Empty = serde_json::from_value(arguments).map_err(invalid)?;
                    tokio::task::spawn_blocking(move || crate::native_mcp_console::workers(&path))
                }
                "te2_console_tail" => {
                    let input: ConsoleFilter =
                        serde_json::from_value(arguments).map_err(invalid)?;
                    tokio::task::spawn_blocking(move || {
                        crate::native_mcp_console::tail(
                            &path,
                            input.limit,
                            input.worker_id.as_deref(),
                            input.level.as_deref(),
                        )
                    })
                }
                _ => {
                    let input: ConsoleSearch =
                        serde_json::from_value(arguments).map_err(invalid)?;
                    tokio::task::spawn_blocking(move || {
                        crate::native_mcp_console::search(
                            &path,
                            &input.query,
                            input.limit,
                            input.worker_id.as_deref(),
                            input.level.as_deref(),
                        )
                    })
                }
            };
            return Ok(match task.await {
                Ok(Ok(data)) => CallToolResult::structured(data),
                Ok(Err(error)) => CallToolResult::error(vec![ContentBlock::text(format!(
                    "Console transcript read failed: {error}"
                ))]),
                Err(error) => CallToolResult::error(vec![ContentBlock::text(format!(
                    "Console transcript task failed: {error}"
                ))]),
            });
        }
        #[cfg(feature = "ferrous-framework-native")]
        if matches!(
            name,
            "te2_framework_workers" | "te2_framework_status" | "te2_framework_eval"
        ) {
            use crate::runtime_debug_pipe::DebugTarget;
            let call = match name {
                "te2_framework_workers" => {
                    let input: Credential = serde_json::from_value(arguments).map_err(invalid)?;
                    DebugCall::Workers {
                        credential: input.credential,
                    }
                }
                "te2_framework_status" => {
                    let input: DebugStatus = serde_json::from_value(arguments).map_err(invalid)?;
                    DebugCall::Target {
                        credential: input.credential,
                        target: DebugTarget {
                            app_id: input.app_id,
                            shell_id: input.shell_id,
                            instance_id: input.instance_id,
                        },
                        code: None,
                        timeout_seconds: 20,
                        eval: false,
                    }
                }
                _ => {
                    let input: DebugEval = serde_json::from_value(arguments).map_err(invalid)?;
                    if !(1..=30).contains(&input.timeout_seconds) || input.code.len() > 32 * 1024 {
                        return Err(ErrorData::invalid_params(
                            "Invalid debug timeout or code bound",
                            None,
                        ));
                    }
                    DebugCall::Target {
                        credential: input.credential,
                        target: DebugTarget {
                            app_id: input.app_id,
                            shell_id: input.shell_id,
                            instance_id: input.instance_id,
                        },
                        code: Some(input.code),
                        timeout_seconds: input.timeout_seconds,
                        eval: true,
                    }
                }
            };
            // Debug owner already returns the legacy HTTP-shaped JSON envelope.
            // Do not nest it in another app-action envelope or retry evaluation.
            return Ok(match self.owner.debug(call).await {
                Ok(data) => CallToolResult::structured(data),
                Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
            });
        }
        let result = match name {
            "te2_apps_reload" => {
                let _: Empty = serde_json::from_value(arguments).map_err(invalid)?;
                self.owner.reload().await
            }
            "te2_app_start" | "te2_app_open" => {
                let input: AppId = serde_json::from_value(arguments).map_err(invalid)?;
                let app_id = input.app_id.trim().to_owned();
                if name == "te2_app_start" {
                    self.owner.start(app_id).await
                } else {
                    self.owner.open(app_id).await
                }
            }
            _ => return Err(ErrorData::invalid_params("Unknown native app tool", None)),
        };
        Ok(match result {
            Ok(data) => CallToolResult::structured(json!({"ok": true, "data": data})),
            Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
        })
    }
}

impl<O: AppToolOwner> ServerHandler for NativeAppTools<O> {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(rmcp::model::Implementation::new(
                "te2-mcp",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions("TE2 framework-owned native Streamable HTTP MCP tools.".to_owned())
    }
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(self.tools.clone()))
    }
    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tools.iter().find(|tool| tool.name == name).cloned()
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let arguments = Value::Object(request.arguments.unwrap_or_default());
        self.dispatch(&request.name, arguments)
            .await
            .map(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    async fn rpc_response(response: reqwest::Response) -> Value {
        let sse = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream"));
        let text = response.text().await.unwrap();
        if !sse {
            return serde_json::from_str(&text).unwrap();
        }
        text.lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .filter_map(|data| serde_json::from_str::<Value>(data.trim()).ok())
            .find(|value| value.get("id").is_some())
            .expect("JSON-RPC SSE response")
    }
    #[derive(Clone, Default)]
    struct FakeOwner {
        calls: Arc<Mutex<Vec<(String, String)>>>,
        fail: bool,
    }
    impl FakeOwner {
        fn action(&self, name: &str, app_id: String) -> OwnerFuture<'_> {
            self.calls
                .lock()
                .unwrap()
                .push((name.into(), app_id.clone()));
            let result = if self.fail {
                Err("fixture failure".into())
            } else {
                Ok(json!({"app_id": app_id}))
            };
            Box::pin(std::future::ready(result))
        }
    }
    impl AppToolOwner for FakeOwner {
        #[cfg(feature = "ferrous-framework-native")]
        fn shortcut(&self, _input: crate::native_mcp_sidebar::ShortcutInput) -> OwnerFuture<'_> {
            self.action("shortcut", String::new())
        }
        fn scaffold(&self, _call: crate::native_mcp_scaffold::ScaffoldCall) -> OwnerFuture<'_> {
            self.action("scaffold", String::new())
        }
        #[cfg(feature = "ferrous-framework-native")]
        fn fws(&self, _call: crate::native_mcp_fws::FwsCall) -> OwnerFuture<'_> {
            self.action("fws", String::new())
        }
        fn console(&self, payload: Option<Value>, timeout: f64) -> OwnerFuture<'_> {
            self.calls.lock().unwrap().push((
                "console".into(),
                json!({"payload":payload,"timeout":timeout}).to_string(),
            ));
            Box::pin(std::future::ready(if self.fail {
                Err("fixture failure".into())
            } else {
                Ok(json!({"workers":["fixture"],"source":"te2_console.runtime"}))
            }))
        }
        #[cfg(feature = "ferrous-framework-native")]
        fn debug(&self, call: DebugCall) -> OwnerFuture<'_> {
            let value = match call {
                DebugCall::Capability {
                    credential,
                    target,
                    capability,
                    params,
                    timeout_seconds,
                } => {
                    json!({"credential":credential,"target":target,"capability":capability,"params":params,"timeout":timeout_seconds})
                }
                DebugCall::Workers { credential } => json!({"credential":credential}),
                DebugCall::Target {
                    credential,
                    target,
                    code,
                    timeout_seconds,
                    eval,
                } => {
                    json!({"credential":credential,"target":target,"code":code,"timeout":timeout_seconds,"eval":eval})
                }
            };
            self.calls
                .lock()
                .unwrap()
                .push(("debug".into(), value.to_string()));
            Box::pin(std::future::ready(if self.fail {
                Err("fixture failure".into())
            } else {
                Ok(json!({"ok":true,"data":value}))
            }))
        }
        fn reload(&self) -> OwnerFuture<'_> {
            self.action("reload", String::new())
        }
        fn start(&self, app_id: String) -> OwnerFuture<'_> {
            self.action("start", app_id)
        }
        fn open(&self, app_id: String) -> OwnerFuture<'_> {
            self.action("open", app_id)
        }
    }
    #[tokio::test]
    async fn forwards_once_to_owner_and_preserves_envelope() {
        let owner = FakeOwner::default();
        let tools = NativeAppTools::new(owner.clone()).unwrap();
        for name in ["te2_app_start", "te2_app_open"] {
            let result = tools
                .dispatch(name, json!({"app_id":"  fixture  "}))
                .await
                .unwrap();
            assert_eq!(
                result.structured_content,
                Some(json!({"ok":true,"data":{"app_id":"fixture"}}))
            );
        }
        tools.dispatch("te2_apps_reload", json!({})).await.unwrap();
        assert_eq!(
            *owner.calls.lock().unwrap(),
            vec![
                ("start".into(), "fixture".into()),
                ("open".into(), "fixture".into()),
                ("reload".into(), String::new())
            ]
        );
    }
    #[tokio::test]
    async fn invalid_arguments_never_mutate() {
        let owner = FakeOwner::default();
        let tools = NativeAppTools::new(owner.clone()).unwrap();
        for (name, arguments) in [
            ("te2_app_start", json!({})),
            ("te2_app_start", json!({"app_id":3})),
            ("te2_app_open", json!({"app_id":"x","extra":true})),
            ("te2_apps_reload", json!({"extra":1})),
            ("unknown", json!({})),
        ] {
            assert!(tools.dispatch(name, arguments).await.is_err());
        }
        assert!(owner.calls.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn failed_mutation_is_not_retried() {
        let owner = FakeOwner {
            fail: true,
            ..Default::default()
        };
        let tools = NativeAppTools::new(owner.clone()).unwrap();
        assert_eq!(
            tools
                .dispatch("te2_app_start", json!({"app_id":"x"}))
                .await
                .unwrap()
                .is_error,
            Some(true)
        );
        assert_eq!(owner.calls.lock().unwrap().len(), 1);
    }
    #[test]
    fn exact_supported_tool_discovery_schema() {
        let tools = NativeAppTools::new(FakeOwner::default()).unwrap();
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../mcp_probe/fixtures/python_tools.json"
        ))
        .unwrap();
        for tool in &tools.tools {
            let expected = fixture["tools"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["name"].as_str() == Some(tool.name.as_ref()))
                .unwrap();
            let actual = serde_json::to_value(tool).unwrap();
            for key in [
                "name",
                "description",
                "inputSchema",
                "outputSchema",
                "_meta",
            ] {
                assert_eq!(actual[key], expected[key]);
            }
        }
    }

    #[tokio::test]
    async fn console_tools_use_only_disposable_transcript_and_validate_ingress() {
        use std::io::Write;
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"{\"workerId\":\"historical\",\"args\":[\"message\"]}\n")
            .unwrap();
        let owner = FakeOwner::default();
        let mut tools = NativeAppTools::new(owner.clone()).unwrap();
        tools.console_path = file.path().to_owned();
        for (name, input) in [
            ("te2_console_workers", json!({})),
            ("te2_console_tail", json!({})),
            ("te2_console_search", json!({"query":"message"})),
        ] {
            let result = tools
                .dispatch(name, input)
                .await
                .unwrap()
                .structured_content
                .unwrap();
            assert_eq!(result["log_path"], json!(file.path()));
            assert!(result.get("data").is_none()); // Not an app-action envelope.
        }
        for (name, input) in [
            ("te2_console_workers", json!({"extra":true})),
            ("te2_console_tail", json!({"limit":"10"})),
            ("te2_console_search", json!({})),
            ("te2_console_search", json!({"query":1})),
        ] {
            assert!(tools.dispatch(name, input).await.is_err());
        }
        assert!(owner.calls.lock().unwrap().is_empty());
        let root = tempfile::tempdir().unwrap();
        tools.console_path = root.path().to_owned(); // Read error, not a missing file.
        assert_eq!(
            tools
                .dispatch("te2_console_tail", json!({}))
                .await
                .unwrap()
                .is_error,
            Some(true)
        );
    }

    #[tokio::test]
    async fn status_projection_preserves_existing_contract() {
        let tools = NativeAppTools::new(FakeOwner::default()).unwrap();
        let data = tools
            .dispatch("te2_mcp_status", json!({}))
            .await
            .unwrap()
            .structured_content
            .unwrap();
        assert_eq!(data["server"], "te2-mcp");
        assert_eq!(data["console_log_path"], json!(tools.console_path));
        assert_eq!(data["mode"], "framework_owned_native");
        assert!(
            tools
                .dispatch("te2_mcp_status", json!({"extra":true}))
                .await
                .is_err()
        );
    }

    #[cfg(feature = "ferrous-framework-native")]
    #[tokio::test]
    async fn all_twenty_four_tools_have_real_dispatch_paths_with_fixture_owners() {
        let owner = FakeOwner::default();
        let mut tools = NativeAppTools::new(owner.clone()).unwrap();
        let file = tempfile::NamedTempFile::new().unwrap();
        tools.console_path = file.path().to_owned();
        let target = json!({"credential":"explicit","app_id":"sample_editor","shell_id":"parent","instance_id":"generation"});
        let mut eval = target.clone();
        eval["code"] = json!("1");
        let mut wba_eval = eval.clone();
        wba_eval["wba_shell_id"] = json!("child");
        wba_eval["wba_instance_id"] = json!("child-generation");
        let cases = [
            ("te2_framework_workers", json!({"credential":"explicit"})),
            ("te2_framework_status", target.clone()),
            ("te2_framework_eval", eval),
            ("te2_wba_status", target),
            ("te2_wba_eval", wba_eval),
            ("te2_mcp_status", json!({})),
            ("te2_console_workers", json!({})),
            ("te2_console_tail", json!({})),
            ("te2_console_search", json!({"query":"fixture"})),
            ("te2_console_workers_live", json!({})),
            (
                "te2_console_eval",
                json!({"target_worker_id":"fixture","code":"1"}),
            ),
            ("te2_fws_running", json!({})),
            ("te2_fws_shell_get", json!({"shell_id":"fixture"})),
            (
                "te2_fws_shell_write",
                json!({"shell_id":"fixture","data":"test"}),
            ),
            ("te2_fws_log_tail", json!({"shell_id":"fixture"})),
            (
                "te2_fws_log_search",
                json!({"shell_id":"fixture","query":"test"}),
            ),
            (
                "te2_fws_log_inspect",
                json!({"shell_id":"fixture","include_stdin":true}),
            ),
            ("te2_apps_templates", json!({})),
            ("te2_validate_proxy_wrapper", json!({"app_id":"fixture"})),
            (
                "te2_scaffold_proxy_wrapper",
                json!({"app_id":"fixture","project_root":"/fixture","command":"noop","port":5000}),
            ),
            ("te2_apps_reload", json!({})),
            ("te2_app_start", json!({"app_id":"fixture"})),
            ("te2_app_open", json!({"app_id":"fixture"})),
            ("te2_sidebar_add_app_shortcut", json!({"app_id":"fixture"})),
        ];
        assert_eq!(tools.tools.len(), cases.len());
        let cancellation = tokio_util::sync::CancellationToken::new();
        let app = http_router(tools.clone(), cancellation.clone()).with_state(());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/te2_mcp_http", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::builder()
            .no_proxy()
            .retry(reqwest::retry::never())
            .build()
            .unwrap();
        let init = client.post(&url).header("accept", "application/json, text/event-stream")
            .json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
                "protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"isolated-test","version":"1"}}}))
            .send().await.unwrap();
        assert_eq!(init.status(), 200);
        let session = init.headers()["mcp-session-id"]
            .to_str()
            .unwrap()
            .to_owned();
        let initialized = rpc_response(init).await;
        assert_eq!(initialized["result"]["serverInfo"]["name"], "te2-mcp");
        let request = |method: reqwest::Method, endpoint: &str| {
            client
                .request(method, endpoint)
                .header("accept", "application/json, text/event-stream")
                .header("mcp-protocol-version", "2025-11-25")
                .header("mcp-session-id", &session)
        };
        let notification = request(reqwest::Method::POST, &url)
            .json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .send()
            .await
            .unwrap();
        assert_eq!(notification.status(), 202);
        let catalog = request(reqwest::Method::POST, &format!("{url}/"))
            .json(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            .send()
            .await
            .unwrap();
        let catalog = rpc_response(catalog).await;
        assert_eq!(
            catalog["result"]["tools"],
            serde_json::to_value(&tools.tools).unwrap()
        );
        for (name, args) in cases {
            assert!(tools.get_tool(name).is_some());
            let response = request(reqwest::Method::POST, &url)
                .json(&json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":name,"arguments":args}}))
                .send().await.unwrap();
            assert_eq!(response.status(), 200, "{name}");
            let result = rpc_response(response).await;
            assert!(result.get("error").is_none(), "{name}: {result}");
            assert_ne!(result["result"]["isError"], true, "{name}: {result}");
            assert!(
                result["result"].get("structuredContent").is_some(),
                "{name}: {result}"
            );
        }
        assert_eq!(owner.calls.lock().unwrap().len(), 20);
        let malformed = request(reqwest::Method::POST, &url)
            .header("content-type", "application/json")
            .body("{")
            .send()
            .await
            .unwrap();
        assert_eq!(malformed.status(), 400);
        let malformed: Value = malformed.json().await.unwrap();
        assert_eq!(malformed["error"]["code"], -32700);
        let media = request(reqwest::Method::POST, &url)
            .header("content-type", "text/plain")
            .body("{}")
            .send()
            .await
            .unwrap();
        assert_eq!(media.status(), 415);
        let rejected_host = request(reqwest::Method::POST, &url)
            .header("host", "untrusted.invalid")
            .json(&json!({"jsonrpc":"2.0","id":5,"method":"tools/list"}))
            .send()
            .await
            .unwrap();
        assert_eq!(rejected_host.status(), 403);
        let deleted = request(reqwest::Method::DELETE, &url).send().await.unwrap();
        assert_eq!(deleted.status(), 200);
        let stale = request(reqwest::Method::POST, &url)
            .json(&json!({"jsonrpc":"2.0","id":4,"method":"tools/list"}))
            .send()
            .await
            .unwrap();
        assert_eq!(stale.status(), 404);
        assert_eq!(
            owner.calls.lock().unwrap().len(),
            20,
            "protocol errors never dispatch/retry owners"
        );
        cancellation.cancel();
        server.abort(); // Own isolated listener only, never the shared framework.
        let _ = server.await;
    }

    #[tokio::test]
    async fn live_console_uses_owner_once_and_never_persisted_workers_as_fallback() {
        let owner = FakeOwner::default();
        let tools = NativeAppTools::new(owner.clone()).unwrap();
        tools
            .dispatch("te2_console_workers_live", json!({}))
            .await
            .unwrap();
        let result = tools
            .dispatch(
                "te2_console_eval",
                json!({"target_worker_id":"exact","code":"1"}),
            )
            .await
            .unwrap();
        assert_eq!(
            result.structured_content.unwrap()["source"],
            "te2_console.runtime"
        );
        assert_eq!(owner.calls.lock().unwrap().len(), 2);
        for input in [
            json!({}),
            json!({"target_worker_id":" ","code":"1"}),
            json!({"target_worker_id":"x","code":"1","extra":true}),
        ] {
            assert!(tools.dispatch("te2_console_eval", input).await.is_err());
        }
        let failing = FakeOwner {
            fail: true,
            ..Default::default()
        };
        let tools = NativeAppTools::new(failing.clone()).unwrap();
        assert_eq!(
            tools
                .dispatch(
                    "te2_console_eval",
                    json!({"target_worker_id":"x","code":"1"})
                )
                .await
                .unwrap()
                .is_error,
            Some(true)
        );
        assert_eq!(failing.calls.lock().unwrap().len(), 1);
    }

    #[cfg(feature = "ferrous-framework-native")]
    #[tokio::test]
    async fn wba_uses_exact_parent_once_with_data_only_parameters() {
        let owner = FakeOwner::default();
        let tools = NativeAppTools::new(owner.clone()).unwrap();
        let code = "'\\\"\n\\u0000; globalThis.result = 'é'";
        let input = json!({"credential":"explicit","app_id":"sample_editor","shell_id":"parent","instance_id":"generation","wba_shell_id":"child","wba_instance_id":"child-generation","code":code});
        let data = tools
            .dispatch("te2_wba_eval", input.clone())
            .await
            .unwrap()
            .structured_content
            .unwrap();
        assert_eq!(
            data["data"]["target"],
            json!({"appId":"sample_editor","shellId":"parent","instanceId":"generation"})
        );
        assert!(data["data"].get("code").is_none());
        assert_eq!(data["data"]["capability"], "workbench.debug");
        let params = &data["data"]["params"];
        assert_eq!(
            params,
            &json!({"operation":"eval","shell_id":"child","instance_id":"child-generation","code":code,"timeout_seconds":20})
        );
        assert_eq!(owner.calls.lock().unwrap().len(), 1);
        for (field, value) in [
            ("app_id", json!("")),
            ("wba_instance_id", json!("")),
            ("timeout_seconds", json!(31)),
            ("code", json!("é".repeat(16385))),
        ] {
            let mut invalid = input.clone();
            invalid[field] = value;
            assert!(tools.dispatch("te2_wba_eval", invalid).await.is_err());
        }
        assert_eq!(owner.calls.lock().unwrap().len(), 1);
        let status = tools.dispatch("te2_wba_status",json!({"credential":"explicit","app_id":"sample_editor","shell_id":"parent","instance_id":"generation"})).await.unwrap();
        assert!(status.structured_content.is_some());
        assert_eq!(owner.calls.lock().unwrap().len(), 2);
    }

    #[cfg(feature = "ferrous-framework-native")]
    #[tokio::test]
    async fn debug_preserves_exact_identity_defaults_and_single_envelope() {
        let owner = FakeOwner::default();
        let tools = NativeAppTools::new(owner.clone()).unwrap();
        tools
            .dispatch("te2_framework_workers", json!({"credential":"explicit"}))
            .await
            .unwrap();
        for (name, eval) in [
            ("te2_framework_status", false),
            ("te2_framework_eval", true),
        ] {
            let mut input = json!({"credential":"explicit", "app_id":" a ","shell_id":"shell","instance_id":"generation"});
            if eval {
                input["code"] = json!("1 + 1");
            }
            let result = tools.dispatch(name, input).await.unwrap();
            let data = result.structured_content.unwrap();
            assert_eq!(data["ok"], true);
            assert_eq!(
                data["data"]["target"],
                json!({"appId":" a ","shellId":"shell","instanceId":"generation"})
            );
            assert_eq!(data["data"]["credential"], "explicit");
            assert_eq!(data["data"]["timeout"], 20);
            assert_eq!(data["data"]["eval"], eval);
        }
        assert_eq!(owner.calls.lock().unwrap().len(), 3);
    }

    #[cfg(feature = "ferrous-framework-native")]
    #[tokio::test]
    async fn debug_invalid_ingress_never_dispatches_and_failure_never_retries() {
        let owner = FakeOwner::default();
        let tools = NativeAppTools::new(owner.clone()).unwrap();
        for input in [
            json!({}),
            json!({"credential":"x","app_id":"a","shell_id":"s","code":"1"}),
            json!({"credential":"x","app_id":"a","shell_id":"s","instance_id":"i","code":"1","timeout_seconds":0}),
            json!({"credential":"x","app_id":"a","shell_id":"s","instance_id":"i","code":"1","timeout_seconds":31}),
            json!({"credential":"x","app_id":"a","shell_id":"s","instance_id":"i","code":"1","timeout_seconds":-1}),
            json!({"credential":"x","app_id":"a","shell_id":"s","instance_id":"i","code":"é".repeat(16385)}),
            json!({"credential":"x","app_id":"a","shell_id":"s","instance_id":"i","code":"1","extra":true}),
        ] {
            assert!(tools.dispatch("te2_framework_eval", input).await.is_err());
        }
        assert!(
            tools
                .dispatch("te2_framework_workers", json!({"credential":3}))
                .await
                .is_err()
        );
        assert!(owner.calls.lock().unwrap().is_empty());
        let failing = FakeOwner {
            fail: true,
            ..Default::default()
        };
        let tools = NativeAppTools::new(failing.clone()).unwrap();
        assert_eq!(tools.dispatch("te2_framework_eval", json!({"credential":"x","app_id":"a","shell_id":"s","instance_id":"i","code":"1"})).await.unwrap().is_error, Some(true));
        assert_eq!(failing.calls.lock().unwrap().len(), 1);
    }
}
