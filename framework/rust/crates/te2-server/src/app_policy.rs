//! App-owned integration policy; absence grants nothing.
use crate::registry::{AppDefinition, AppRegistry};
use anyhow::{Result, ensure};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AppPolicy {
    pub intents: HashMap<String, Vec<String>>,
    pub capabilities: HashMap<String, String>,
    pub proxy_cors: Vec<CorsRule>,
    pub state_migration_from: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CorsRule {
    pub path_prefix: String,
    pub origins: Vec<String>,
    pub methods: Vec<String>,
    pub headers: Vec<String>,
    pub max_age: u16,
}

impl AppPolicy {
    pub fn read(app: &AppDefinition) -> Result<Self> {
        let policy: Self = match app.raw_manifest.get("framework_integration") {
            Some(value) => serde_json::from_value(value.clone())?,
            None => Self::default(),
        };
        ensure!(
            policy.intents.len() <= 64
                && policy.capabilities.len() <= 32
                && policy.proxy_cors.len() <= 16,
            "app policy exceeds limit"
        );
        for (intent, callers) in &policy.intents {
            ensure!(
                !intent.is_empty()
                    && intent.len() <= 128
                    && callers.len() <= 64
                    && callers
                        .iter()
                        .all(|id| !id.is_empty() && id.len() <= 128 && id != "*"),
                "invalid intent policy"
            );
        }
        for (capability, method) in &policy.capabilities {
            ensure!(
                !capability.is_empty()
                    && capability.len() <= 128
                    && method.len() <= 128
                    && (method.starts_with("runtime.debug.") || method.starts_with("app.mcp."))
                    && method
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')),
                "invalid capability operation"
            );
        }
        if let Some(alias) = &policy.state_migration_from {
            ensure!(
                app.id_aliases.contains(alias) && alias != &app.app_id,
                "state migration must name an explicit owned alias"
            );
        }
        for rule in &policy.proxy_cors {
            ensure!(
                !rule.path_prefix.is_empty()
                    && !rule.path_prefix.starts_with('/')
                    && rule.path_prefix.ends_with('/')
                    && !rule.path_prefix.contains(['%', '?', '#', '*', '\\'])
                    && !rule.path_prefix.split('/').any(|p| p == "." || p == "..")
                    && rule.origins.len() <= 16
                    && !rule.origins.is_empty()
                    && rule.methods.len() <= 8
                    && rule.headers.len() <= 16
                    && rule.max_age <= 3600,
                "invalid proxy CORS rule"
            );
            for origin in &rule.origins {
                let url = reqwest::Url::parse(origin)?;
                ensure!(
                    matches!(url.scheme(), "http" | "https")
                        && url.host_str().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                        && url.query().is_none()
                        && url.fragment().is_none()
                        && url.origin().ascii_serialization() == *origin,
                    "invalid exact CORS origin"
                );
            }
            ensure!(
                rule.methods.iter().all(|m| matches!(
                    m.as_str(),
                    "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS"
                )) && rule
                    .headers
                    .iter()
                    .all(|h| !h.is_empty()
                        && h.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')),
                "invalid CORS headers/methods"
            );
        }
        Ok(policy)
    }

    pub fn permits(&self, source: &str, intent: &str) -> bool {
        self.intents
            .get(intent)
            .is_some_and(|callers| callers.iter().any(|id| id == source))
    }
}

pub(crate) fn provider(registry: &AppRegistry, capability: &str) -> Result<(String, String)> {
    let mut selected = None;
    for app in registry.apps().iter().filter(|app| app.enabled) {
        if let Some(method) = AppPolicy::read(app)?.capabilities.get(capability) {
            ensure!(selected.is_none(), "appCapability.ambiguousProvider");
            selected = Some((app.app_id.clone(), method.clone()));
        }
    }
    selected.ok_or_else(|| anyhow::anyhow!("appCapability.providerUnavailable"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::AppRoot;
    use serde_json::{Value, json};

    fn registry(policies: &[(&str, Value)]) -> (tempfile::TempDir, AppRegistry) {
        let root = tempfile::tempdir().unwrap();
        for (id, policy) in policies {
            let app = root.path().join(id);
            std::fs::create_dir(&app).unwrap();
            std::fs::write(
                app.join("manifest.json"),
                json!({"id":id,"name":id,
                "id_aliases":[format!("old-{id}")], "framework_integration":policy})
                .to_string(),
            )
            .unwrap();
        }
        let registry = AppRegistry::load(&[AppRoot {
            source_kind: "test".into(),
            path: root.path().into(),
        }]);
        (root, registry)
    }

    #[test]
    fn explicit_receiver_policy_and_unique_provider() {
        let (root, catalog) = registry(&[(
            "receiver",
            json!({"intents":{"document.open":["sender"]},
            "capabilities":{"sidebarShortcut.add":"app.mcp.add"},"stateMigrationFrom":"old-receiver"}),
        )]);
        let policy = AppPolicy::read(catalog.get_app("receiver").unwrap()).unwrap();
        assert!(policy.permits("sender", "document.open"));
        assert!(!policy.permits("other", "document.open"));
        assert!(!policy.permits("sender", "other"));
        assert_eq!(policy.state_migration_from.as_deref(), Some("old-receiver"));
        assert_eq!(
            provider(&catalog, "sidebarShortcut.add").unwrap(),
            ("receiver".into(), "app.mcp.add".into())
        );
        assert!(provider(&catalog, "missing").is_err());
        drop(root);
        let (_root, catalog) = registry(&[
            ("first", json!({"capabilities":{"sample":"app.mcp.add"}})),
            ("second", json!({"capabilities":{"sample":"app.mcp.other"}})),
        ]);
        assert!(
            provider(&catalog, "sample")
                .unwrap_err()
                .to_string()
                .contains("ambiguous")
        );
    }

    #[test]
    fn malformed_policy_never_grants_permissions() {
        for policy in [
            json!({"unknown":true}),
            json!({"intents":{"open":["*"]}}),
            json!({"capabilities":{"sample":"import os"}}),
            json!({"stateMigrationFrom":"unrelated"}),
            json!({"proxyCors":[{"pathPrefix":"../", "origins":["*"], "methods":["GET"], "headers":[],"maxAge":600}]}),
        ] {
            let (_root, catalog) = registry(&[("receiver", policy)]);
            assert!(AppPolicy::read(catalog.get_app("receiver").unwrap()).is_err());
        }
    }
}
