//! Isolated synthetic MCP server; no TE2 services, credentials or state access.
mod http_compat;
use rmcp::{
    ErrorData, RoleServer, ServerHandler,
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig},
    service::RequestContext,
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};
use serde::Deserialize;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

#[derive(Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct Echo {
    value: serde_json::Value,
}

#[derive(Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct Wait {
    milliseconds: u64,
}

#[derive(Clone)]
struct Probe {
    calls: Arc<AtomicU64>,
    active_waits: Arc<AtomicU64>,
}

struct WaitGuard(Arc<AtomicU64>);
impl Drop for WaitGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

#[tool_router]
impl Probe {
    fn new() -> Self {
        Self {
            calls: Arc::new(AtomicU64::new(0)),
            active_waits: Arc::new(AtomicU64::new(0)),
        }
    }

    #[tool(description = "Synthetic opaque-value echo; no live console evaluation")]
    async fn probe_echo(
        &self,
        Parameters(input): Parameters<Echo>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(CallToolResult::success(vec![ContentBlock::text(
            input.value.to_string(),
        )]))
    }

    #[tool(description = "Synthetic per-session counter; no framework mutations")]
    async fn probe_count(&self) -> Result<CallToolResult, ErrorData> {
        let count = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(CallToolResult::success(vec![ContentBlock::text(
            count.to_string(),
        )]))
    }

    #[tool(description = "Bounded synthetic wait to qualify MCP cancellation")]
    async fn probe_wait(
        &self,
        Parameters(input): Parameters<Wait>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if input.milliseconds > 5_000 {
            return Ok(CallToolResult::error(vec![ContentBlock::text(
                "wait exceeds probe limit",
            )]));
        }
        self.active_waits.fetch_add(1, Ordering::SeqCst);
        let _guard = WaitGuard(self.active_waits.clone());
        tokio::select! {
            _ = context.ct.cancelled() => Ok(CallToolResult::error(vec![ContentBlock::text("cancelled")])),
            _ = tokio::time::sleep(std::time::Duration::from_millis(input.milliseconds)) =>
                Ok(CallToolResult::success(vec![ContentBlock::text("completed")])),
        }
    }

    #[tool(description = "Synthetic wait ownership count for cancellation tests")]
    fn probe_active_waits(&self) -> Result<CallToolResult, ErrorData> {
        Ok(CallToolResult::success(vec![ContentBlock::text(
            self.active_waits.load(Ordering::SeqCst).to_string(),
        )]))
    }
}

#[tool_handler]
impl ServerHandler for Probe {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::from_build_env())
            .with_instructions(
                "Isolated synthetic TE2 MCP qualification server. No live tools.".to_owned(),
            )
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cancellation = tokio_util::sync::CancellationToken::new();
    let config = StreamableHttpServerConfig::default()
        .with_json_response(true)
        .with_max_request_body_bytes(64 * 1024)
        .with_cancellation_token(cancellation.child_token());
    let service = StreamableHttpService::new(
        || Ok(Probe::new()),
        LocalSessionManager::default().into(),
        config,
    );
    let router = axum::Router::new()
        .nest_service("/mcp", service)
        .layer(axum::middleware::from_fn(http_compat::compatibility));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    println!("{}", listener.local_addr()?);
    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            cancellation.cancel();
        })
        .await?;
    Ok(())
}
