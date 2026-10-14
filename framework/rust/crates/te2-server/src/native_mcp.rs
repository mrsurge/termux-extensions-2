//! Dormant native app tools. No public routes or console/worker state copies.
#![allow(dead_code)] // Activated only after the later explicit route cutover.
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
use std::{future::Future, pin::Pin};

type OwnerFuture<'a> = Pin<Box<dyn Future<Output = Result<Value, String>> + Send + 'a>>;

pub(crate) trait AppToolOwner: Clone + Send + Sync + 'static {
    fn reload(&self) -> OwnerFuture<'_>;
    fn start(&self, app_id: String) -> OwnerFuture<'_>;
    fn open(&self, app_id: String) -> OwnerFuture<'_>;
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
    fn reload(&self) -> OwnerFuture<'_> {
        Box::pin(async {
            Ok(Value::Object(
                apps_lifecycle::reload_apps_data(&self.0).await,
            ))
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

#[derive(Clone)]
pub(crate) struct NativeAppTools<O: AppToolOwner> {
    owner: O,
    tools: Vec<Tool>,
}

impl<O: AppToolOwner> NativeAppTools<O> {
    pub(crate) fn new(owner: O) -> Result<Self, serde_json::Error> {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../mcp_probe/fixtures/python_tools.json"
        ))?;
        let mut tools = Vec::new();
        for tool in fixture["tools"].as_array().expect("verified catalog array") {
            if matches!(
                tool["name"].as_str(),
                Some("te2_apps_reload" | "te2_app_start" | "te2_app_open")
            ) {
                tools.push(serde_json::from_value(tool.clone())?);
            }
        }
        assert_eq!(
            tools.len(),
            3,
            "native app catalog must contain all three tools"
        );
        Ok(Self { owner, tools })
    }

    async fn dispatch(&self, name: &str, arguments: Value) -> Result<CallToolResult, ErrorData> {
        let invalid = |error: serde_json::Error| ErrorData::invalid_params(error.to_string(), None);
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
    fn exact_three_tool_discovery_schema() {
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
}
