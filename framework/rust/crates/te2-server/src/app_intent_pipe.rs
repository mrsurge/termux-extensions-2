//! Production app intents use owned worker pipes, never diagnostic routing.
use crate::framework_services::pipe::{
    PipeEventSink,
    protocol::{PipeEnvelope, PipeError, PipeIdentity, PipeMessageKind},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::sync::{Semaphore, SemaphorePermit, oneshot, watch};

const MAX_PENDING: usize = 16;
const MAX_PARAMS: usize = 64 * 1024;
const WAIT: Duration = Duration::from_secs(15);
const MAX_RPC_BYTES: usize = 8 * 1024 * 1024;
const RPC_ROUTE_BYTES: usize = 32 * 1024 * 1024;
type Registry = Mutex<HashMap<(String, String), Arc<Route>>>;
static ROUTES: OnceLock<Registry> = OnceLock::new();

pub(crate) struct Route {
    instance: String,
    app: String,
    shell: String,
    sink: Arc<dyn PipeEventSink>,
    pending: Mutex<HashMap<String, oneshot::Sender<PipeEnvelope>>>,
    closed: watch::Sender<bool>,
    admission: Semaphore,
    rpc_bytes: Semaphore,
}

impl Route {
    #[cfg(all(feature = "native-mcp", feature = "ferrous-framework-native"))]
    async fn admin_shortcut(
        self: &Arc<Self>,
        params: Value,
        wait: Duration,
    ) -> anyhow::Result<Value> {
        let _permit = self
            .admission
            .try_acquire()
            .map_err(|_| anyhow::anyhow!("appIntent.busy"))?;
        let id = crate::new_instance_id()?;
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
            anyhow::ensure!(!*self.closed.borrow(), "appIntent.disconnected");
            anyhow::ensure!(pending.len() < MAX_PENDING, "appIntent.busy");
            pending.insert(id.clone(), sender);
        }
        let _guard = PendingGuard {
            route: self.clone(),
            id: id.clone(),
        };
        let request: PipeEnvelope = serde_json::from_value(
            json!({"jsonrpc":"2.0","protocolVersion":1,"kind":"request",
            "id":id,"correlationId":id,"opId":id,"method":"app.mcp.sidebarShortcut.add","originNid":1,"originName":"framework.rust","params":params}),
        )?;
        self.sink.send(request)?;
        let reply = tokio::time::timeout(wait, receiver)
            .await
            .map_err(|_| anyhow::anyhow!("appIntent.timeout: execution outcome may be unknown"))?
            .map_err(|_| {
                anyhow::anyhow!("appIntent.disconnected: execution outcome may be unknown")
            })?;
        if let Some(error) = reply.error {
            anyhow::bail!("{}: {}", error.code, error.message);
        }
        Ok(reply.result.unwrap_or(Value::Null))
    }
    pub(crate) fn close(&self) {
        self.closed.send_replace(true);
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    pub(crate) fn accept(&self, response: PipeEnvelope) -> bool {
        if !matches!(
            response.kind,
            PipeMessageKind::Response | PipeMessageKind::Error
        ) || response.target_nid != Some(1)
            || response.target_name.as_deref() != Some("framework.rust")
            || response.id != response.correlation_id
        {
            return false;
        }
        let Some(id) = response.id.as_ref() else {
            return false;
        };
        let sender = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
        if let Some(sender) = sender {
            let _ = sender.send(response);
            true
        } else {
            false
        }
    }

    async fn deliver(
        self: &Arc<Self>,
        source: &Arc<Route>,
        request: &PipeEnvelope,
        body: IntentRequest,
        wait: Duration,
    ) -> anyhow::Result<PipeEnvelope> {
        self.deliver_message(
            source,
            request,
            "app.intent.deliver",
            json!({
                "intent": body.intent, "context": body.context, "payload": body.payload,
                "source": {"appId": source.app, "shellId": source.shell}
            }),
            wait,
        )
        .await
    }

    async fn deliver_message(
        self: &Arc<Self>,
        source: &Arc<Route>,
        request: &PipeEnvelope,
        method: &str,
        params: Value,
        wait: Duration,
    ) -> anyhow::Result<PipeEnvelope> {
        let id = crate::new_instance_id()?;
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
            if *self.closed.borrow() {
                anyhow::bail!("appIntent.disconnected");
            }
            if pending.len() >= MAX_PENDING {
                anyhow::bail!("appIntent.busy");
            }
            pending.insert(id.clone(), sender);
        }
        let _guard = PendingGuard {
            route: self.clone(),
            id: id.clone(),
        };
        let mut disconnected = source.closed.subscribe();
        if *disconnected.borrow() {
            anyhow::bail!("appIntent.callerDisconnected");
        }
        let mut forwarded = request.clone();
        forwarded.id = Some(id.clone());
        forwarded.correlation_id = Some(id);
        forwarded.origin_nid = 1;
        forwarded.origin_name = "framework.rust".into();
        forwarded.target_nid = None;
        forwarded.target_name = None;
        forwarded.method = Some(method.into());
        forwarded.result = None;
        forwarded.error = None;
        forwarded.params = Some(params);
        self.sink.send(forwarded)?;
        tokio::select! {
            reply = tokio::time::timeout(wait, receiver) => match reply {
                Ok(Ok(reply)) => Ok(reply),
                Ok(Err(_)) => anyhow::bail!("appIntent.disconnected: execution outcome may be unknown"),
                Err(_) => anyhow::bail!("appIntent.timeout: execution outcome may be unknown"),
            },
            _ = disconnected.changed() => anyhow::bail!("appIntent.callerDisconnected: execution outcome may be unknown"),
        }
    }
}

struct PendingGuard {
    route: Arc<Route>,
    id: String,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.route
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
    }
}

pub(crate) struct Registration {
    pub route: Arc<Route>,
}
impl Drop for Registration {
    fn drop(&mut self) {
        self.route.close();
        let mut routes = ROUTES
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let key = (self.route.instance.clone(), self.route.app.clone());
        if routes
            .get(&key)
            .is_some_and(|r| Arc::ptr_eq(r, &self.route))
        {
            routes.remove(&key);
        }
    }
}

pub(crate) fn register(
    instance: &str,
    app: &str,
    shell: &str,
    sink: Arc<dyn PipeEventSink>,
) -> Registration {
    let (closed, _) = watch::channel(false);
    let route = Arc::new(Route {
        instance: instance.into(),
        app: app.into(),
        shell: shell.into(),
        sink,
        pending: Mutex::default(),
        closed,
        admission: Semaphore::new(MAX_PENDING),
        rpc_bytes: Semaphore::new(RPC_ROUTE_BYTES),
    });
    let mut routes = ROUTES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(old) = routes.insert((instance.into(), app.into()), route.clone()) {
        old.close();
    }
    Registration { route }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenRequest {
    app_id: String,
    #[serde(default)]
    params: Map<String, Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IntentRequest {
    target_app: String,
    intent: String,
    context: Value,
    #[serde(default)]
    payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AppRpcRequest {
    target_app: String,
    service: String,
    version: u32,
    method: String,
    #[serde(default)]
    context: Value,
    payload: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AppRpcExport {
    version: u32,
    callers: Vec<String>,
    methods: Vec<String>,
    #[serde(default)]
    limits: HashMap<String, RpcLimits>,
}

/// Receiver-owned policy, never an untrusted caller-selected timeout/size.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct RpcLimits {
    request_bytes: usize,
    reply_bytes: usize,
    timeout_ms: u64,
}

impl Default for RpcLimits {
    fn default() -> Self {
        Self {
            request_bytes: MAX_PARAMS,
            reply_bytes: 1024 * 1024,
            timeout_ms: WAIT.as_millis() as u64,
        }
    }
}

impl RpcLimits {
    fn validate(self) -> anyhow::Result<Self> {
        anyhow::ensure!(
            (1..=MAX_RPC_BYTES).contains(&self.request_bytes)
                && (1..=MAX_RPC_BYTES).contains(&self.reply_bytes)
                && (1..=180_000).contains(&self.timeout_ms),
            "appRpc.invalidLimits"
        );
        Ok(self)
    }

    fn reservation(self, request_bytes: usize) -> anyhow::Result<u32> {
        anyhow::ensure!(
            request_bytes <= self.request_bytes,
            "appRpc.payloadTooLarge"
        );
        // This is an in-flight serialized-byte allowance, not an RSS estimate.
        Ok(u32::try_from(request_bytes + self.reply_bytes)?)
    }
}

struct RpcReservation<'a> {
    _source: SemaphorePermit<'a>,
    _target: Option<SemaphorePermit<'a>>,
}

fn reserve_rpc_bytes<'a>(
    source: &'a Arc<Route>,
    target: &'a Arc<Route>,
    limits: RpcLimits,
    request_bytes: usize,
) -> anyhow::Result<RpcReservation<'a>> {
    let bytes = limits.reservation(request_bytes)?;
    let source_permit = source
        .rpc_bytes
        .try_acquire_many(bytes)
        .map_err(|_| anyhow::anyhow!("appRpc.busyBytes"))?;
    // Self-calls must not reserve the same route twice.
    let target_permit = if Arc::ptr_eq(source, target) {
        None
    } else {
        Some(
            target
                .rpc_bytes
                .try_acquire_many(bytes)
                .map_err(|_| anyhow::anyhow!("appRpc.busyBytes"))?,
        )
    };
    Ok(RpcReservation {
        _source: source_permit,
        _target: target_permit,
    })
}

fn rpc_export_allowed(
    manifest: &Map<String, Value>,
    source: &str,
    request: &AppRpcRequest,
) -> anyhow::Result<RpcLimits> {
    fn name(value: &str) -> bool {
        !value.is_empty()
            && value.len() <= 128
            && value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
    }
    anyhow::ensure!(
        name(&request.service) && name(&request.method) && request.version > 0,
        "appRpc.invalidAddress"
    );
    let exports = manifest
        .get("ipc")
        .and_then(|v| v.get("services"))
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("appRpc.serviceUnavailable"))?;
    anyhow::ensure!(exports.len() <= 64, "appRpc.invalidExports");
    let export: AppRpcExport = serde_json::from_value(
        exports
            .get(&request.service)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("appRpc.serviceUnavailable"))?,
    )?;
    anyhow::ensure!(
        export.callers.len() <= 64
            && export.methods.len() <= 64
            && export
                .callers
                .iter()
                .chain(export.methods.iter())
                .all(|v| name(v)),
        "appRpc.invalidExports"
    );
    anyhow::ensure!(
        export.version == request.version,
        "appRpc.unsupportedVersion"
    );
    anyhow::ensure!(
        export.callers.iter().any(|v| v == source) && export.methods.contains(&request.method),
        "appRpc.forbidden"
    );
    anyhow::ensure!(export.limits.len() <= 64, "appRpc.invalidLimits");
    for (method, limits) in &export.limits {
        anyhow::ensure!(export.methods.contains(method), "appRpc.invalidLimits");
        limits.validate()?;
    }
    export
        .limits
        .get(&request.method)
        .copied()
        .unwrap_or_default()
        .validate()
}

fn rpc_route_available(route: Option<&Route>, running_shell: Option<&str>) -> anyhow::Result<bool> {
    match (route, running_shell) {
        (None, None) => Ok(false),
        (Some(route), Some(shell)) => {
            anyhow::ensure!(!*route.closed.borrow(), "appRpc.routeNotReady");
            validate_current(route, Some(shell))?;
            Ok(true)
        }
        _ => anyhow::bail!("appRpc.routeNotReady"),
    }
}

async fn dispatch_rpc(
    state: &crate::AppState,
    source: &Arc<Route>,
    request: &PipeEnvelope,
) -> PipeEnvelope {
    let responder = PipeIdentity::framework_rust();
    let result: anyhow::Result<PipeEnvelope> = async {
        let _permit = source
            .admission
            .try_acquire()
            .map_err(|_| anyhow::anyhow!("appRpc.busy"))?;
        validate_current(
            source,
            state
                .running_app_for_id(&source.app)
                .as_ref()
                .map(|app| app.shell_id.as_str()),
        )?;
        anyhow::ensure!(!*source.closed.borrow(), "appRpc.callerDisconnected");
        anyhow::ensure!(
            request.op_id.as_deref().is_some_and(|v| !v.is_empty()),
            "appRpc.operationIdRequired"
        );
        let params = request.params.clone().unwrap_or(Value::Null);
        let request_bytes = serde_json::to_vec(&params)?.len();
        anyhow::ensure!(request_bytes <= MAX_RPC_BYTES, "appRpc.payloadTooLarge");
        let body: AppRpcRequest = serde_json::from_value(params)?;
        let registry = state.app_registry_snapshot();
        let app = registry
            .get_app(&body.target_app)
            .ok_or_else(|| anyhow::anyhow!("appRpc.targetUnavailable"))?;
        let limits = rpc_export_allowed(&app.raw_manifest, &source.app, &body)?;
        if request.method.as_deref() == Some("app.rpc.route.get") {
            anyhow::ensure!(
                body.context.is_null() && body.payload.is_null(),
                "appRpc.invalidRouteQuery"
            );
            let running = state.running_app_for_id(&app.app_id);
            let route = resolve(&source.instance, &app.app_id);
            // Only complete absence selects explicit standalone integration.
            // Starting/stale managed workers are errors, not socket fallback.
            let available = rpc_route_available(
                route.as_ref().ok().map(Arc::as_ref),
                running.as_ref().map(|app| app.shell_id.as_str()),
            )?;
            return Ok(PipeEnvelope::success_response(
                request,
                &responder,
                json!({"appId":app.app_id,"available":available}),
            ));
        }
        let target = resolve(&source.instance, &app.app_id)?;
        validate_current(
            &target,
            state
                .running_app_for_id(&target.app)
                .as_ref()
                .map(|app| app.shell_id.as_str()),
        )?;
        let _bytes = reserve_rpc_bytes(source, &target, limits, request_bytes)?;
        let reply = target
            .deliver_message(
                source,
                request,
                "app.rpc.deliver",
                json!({
                    "service":body.service,"version":body.version,"method":body.method,
                    "context":body.context,"payload":body.payload,
                    "source":{"appId":source.app,"shellId":source.shell}
                }),
                Duration::from_millis(limits.timeout_ms),
            )
            .await?;
        anyhow::ensure!(
            serde_json::to_vec(&reply)?.len() <= limits.reply_bytes,
            "appRpc.replyTooLarge: execution outcome may be unknown"
        );
        Ok(reply)
    }
    .await;
    match result {
        Ok(reply) => match reply.error {
            Some(error) => PipeEnvelope::error_response(request, &responder, error),
            None => PipeEnvelope::success_response(
                request,
                &responder,
                reply.result.unwrap_or(Value::Null),
            ),
        },
        Err(error) => PipeEnvelope::error_response(
            request,
            &responder,
            PipeError::new("appRpc.failed", error.to_string(), false, None),
        ),
    }
}

fn allowed(source: &str, target: &str, intent: &str) -> bool {
    target == "code_te2"
        && match intent {
            "sidebar.openApp" | "terminal.createSession" => matches!(
                source,
                "code_te2" | "file_explorer" | "file_editor" | "terminal"
            ),
            "project.openDirectory" | "document.open" => {
                matches!(source, "file_explorer" | "file_editor")
            }
            _ => false,
        }
}

fn resolve(instance: &str, app: &str) -> anyhow::Result<Arc<Route>> {
    ROUTES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&(instance.into(), app.into()))
        .filter(|route| !*route.closed.borrow())
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("appIntent.targetUnavailable"))
}

fn validate_current(route: &Route, shell: Option<&str>) -> anyhow::Result<()> {
    anyhow::ensure!(shell == Some(route.shell.as_str()), "appIntent.staleWorker");
    Ok(())
}

#[cfg(all(feature = "native-mcp", feature = "ferrous-framework-native"))]
pub(crate) async fn add_mcp_shortcut(
    state: &crate::AppState,
    params: Value,
) -> anyhow::Result<Value> {
    anyhow::ensure!(
        serde_json::to_vec(&params)?.len() <= MAX_PARAMS,
        "appIntent.payloadTooLarge"
    );
    let target = resolve(state.instance_id(), "code_te2")?;
    let current = state.running_app_for_id("code_te2");
    validate_current(&target, current.as_ref().map(|app| app.shell_id.as_str()))?;
    target.admin_shortcut(params, WAIT).await
}

/// None means an existing framework service owns this method.
pub(crate) async fn dispatch(
    state: &crate::AppState,
    source: &Arc<Route>,
    request: &PipeEnvelope,
) -> Option<PipeEnvelope> {
    let method = request.method.as_deref()?;
    if method == "app.rpc.call" || method == "app.rpc.route.get" {
        return Some(dispatch_rpc(state, source, request).await);
    }
    if !matches!(method, "app.open" | "app.intent.dispatch") {
        return None;
    }
    let responder = PipeIdentity::framework_rust();
    let result = async {
        let _permit = source
            .admission
            .try_acquire()
            .map_err(|_| anyhow::anyhow!("appIntent.busy"))?;
        if *source.closed.borrow() {
            anyhow::bail!("appIntent.callerDisconnected");
        }
        let current = state.running_app_for_id(&source.app);
        validate_current(source, current.as_ref().map(|app| app.shell_id.as_str()))?;
        if request.op_id.as_deref().is_none_or(str::is_empty) {
            anyhow::bail!("appIntent.operationIdRequired");
        }
        let params = request.params.clone().unwrap_or(Value::Null);
        if serde_json::to_vec(&params)?.len() > MAX_PARAMS {
            anyhow::bail!("appIntent.payloadTooLarge");
        }
        if method == "app.open" {
            let body: OpenRequest = serde_json::from_value(params)?;
            return crate::apps_lifecycle::open_app_data(state, &body.app_id, body.params)
                .await
                .map_err(|response| {
                    anyhow::anyhow!("appOpen.failed: HTTP status {}", response.status())
                });
        }
        let body: IntentRequest = serde_json::from_value(params)?;
        anyhow::ensure!(body.context.is_object(), "appIntent.contextRequired");
        if !allowed(&source.app, &body.target_app, &body.intent) {
            anyhow::bail!("appIntent.notAllowed");
        }
        let target = resolve(&source.instance, &body.target_app)?;
        let current = state.running_app_for_id(&target.app);
        validate_current(&target, current.as_ref().map(|app| app.shell_id.as_str()))?;
        let reply = target.deliver(source, request, body, WAIT).await?;
        if let Some(error) = reply.error {
            anyhow::bail!("{}: {}", error.code, error.message);
        }
        Ok(reply.result.unwrap_or(Value::Null))
    }
    .await;
    Some(match result {
        Ok(result) => PipeEnvelope::success_response(request, &responder, result),
        Err(error) => PipeEnvelope::error_response(
            request,
            &responder,
            PipeError::new("appIntent.failed", error.to_string(), false, None),
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Sink(tokio::sync::mpsc::UnboundedSender<PipeEnvelope>);
    impl PipeEventSink for Sink {
        fn send(&self, value: PipeEnvelope) -> anyhow::Result<()> {
            self.0
                .send(value)
                .map_err(|_| anyhow::anyhow!("closed test sink"))
        }
    }
    fn fixture(
        app: &str,
    ) -> (
        Arc<Route>,
        tokio::sync::mpsc::UnboundedReceiver<PipeEnvelope>,
    ) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let (closed, _) = watch::channel(false);
        (
            Arc::new(Route {
                instance: "test".into(),
                app: app.into(),
                shell: format!("{app}-shell"),
                sink: Arc::new(Sink(tx)),
                pending: Mutex::default(),
                closed,
                admission: Semaphore::new(MAX_PENDING),
                rpc_bytes: Semaphore::new(RPC_ROUTE_BYTES),
            }),
            rx,
        )
    }
    fn request() -> PipeEnvelope {
        serde_json::from_value(json!({"jsonrpc":"2.0", "protocolVersion":1, "kind":"request", "id":"caller-id", "method":"app.intent.dispatch", "originNid":999, "originName":"forged", "opId":"operation"})).unwrap()
    }
    fn body() -> IntentRequest {
        IntentRequest {
            target_app: "code_te2".into(),
            intent: "document.open".into(),
            context: json!({"clientInstanceId":"client"}),
            payload: json!({"path":"/project/file"}),
        }
    }

    #[cfg(all(feature = "native-mcp", feature = "ferrous-framework-native"))]
    #[tokio::test]
    async fn administrative_shortcut_uses_exact_pipe_correlation_and_no_retry() {
        let (target, mut rx) = fixture("code_te2");
        assert!(validate_current(&target, Some("stale-shell")).is_err());
        let t = target.clone();
        let task = tokio::spawn(async move {
            t.admin_shortcut(json!({"shortcut":{"app_id":"fixture"}}), WAIT)
                .await
        });
        let request = rx.recv().await.unwrap();
        assert_eq!(
            request.method.as_deref(),
            Some("app.mcp.sidebarShortcut.add")
        );
        assert_eq!(request.origin_name, "framework.rust");
        assert_eq!(request.origin_nid, 1);
        assert_eq!(request.id, request.correlation_id);
        assert_eq!(request.id, request.op_id);
        let reply = PipeEnvelope::success_response(
            &request,
            &PipeIdentity {
                nid: 9,
                name: "app:code_te2".into(),
            },
            json!({"ok":true}),
        );
        assert!(target.accept(reply));
        assert_eq!(task.await.unwrap().unwrap(), json!({"ok":true}));
        assert!(rx.try_recv().is_err());
        target.close();
        assert!(target.admin_shortcut(json!({}), WAIT).await.is_err());
    }
    #[tokio::test]
    async fn owned_identity_and_correlated_reply() {
        let (source, _) = fixture("file_explorer");
        let (target, mut rx) = fixture("code_te2");
        let t = target.clone();
        let task = tokio::spawn(async move { t.deliver(&source, &request(), body(), WAIT).await });
        let forwarded = rx.recv().await.unwrap();
        assert_eq!(forwarded.origin_name, "framework.rust");
        assert_eq!(
            forwarded.params.as_ref().unwrap()["source"]["appId"],
            "file_explorer"
        );
        assert_ne!(forwarded.id.as_deref(), Some("caller-id"));
        let reply = PipeEnvelope::success_response(
            &forwarded,
            &PipeIdentity {
                nid: 9,
                name: "code_te2".into(),
            },
            json!({"ok":true}),
        );
        let mut forged = reply.clone();
        forged.correlation_id = Some("wrong".into());
        assert!(!target.accept(forged));
        assert!(target.accept(reply.clone()));
        assert!(!target.accept(reply));
        assert_eq!(
            task.await.unwrap().unwrap().result,
            Some(json!({"ok":true}))
        );
        assert!(target.pending.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn timeout_and_late_reply_cleanup() {
        let (source, _) = fixture("file_explorer");
        let (target, mut rx) = fixture("code_te2");
        assert!(
            target
                .deliver(&source, &request(), body(), Duration::from_millis(1))
                .await
                .unwrap_err()
                .to_string()
                .contains("timeout")
        );
        let forwarded = rx.recv().await.unwrap();
        let reply = PipeEnvelope::success_response(
            &forwarded,
            &PipeIdentity::framework_rust(),
            Value::Null,
        );
        assert!(!target.accept(reply));
        assert!(target.pending.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn source_disconnect_clears_target_waiter() {
        let (source, _) = fixture("file_explorer");
        let (target, mut rx) = fixture("code_te2");
        let s = source.clone();
        let t = target.clone();
        let task = tokio::spawn(async move { t.deliver(&s, &request(), body(), WAIT).await });
        rx.recv().await.unwrap();
        source.close();
        assert!(
            task.await
                .unwrap()
                .unwrap_err()
                .to_string()
                .contains("callerDisconnected")
        );
        assert!(target.pending.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn target_disconnect_and_enqueue_failure_cleanup() {
        let (source, _) = fixture("file_explorer");
        let (target, mut rx) = fixture("code_te2");
        let s = source.clone();
        let t = target.clone();
        let task = tokio::spawn(async move { t.deliver(&s, &request(), body(), WAIT).await });
        rx.recv().await.unwrap();
        target.close();
        assert!(task.await.unwrap().is_err());
        assert!(target.pending.lock().unwrap().is_empty());
        let (target, rx) = fixture("code_te2");
        drop(rx);
        assert!(
            target
                .deliver(&source, &request(), body(), WAIT)
                .await
                .is_err()
        );
        assert!(target.pending.lock().unwrap().is_empty());
    }
    #[test]
    fn replacement_does_not_remove_new_registration() {
        let (source, _) = fixture("file_explorer");
        let instance = crate::new_instance_id().unwrap();
        let old = register(&instance, "code_te2", "old", source.sink.clone());
        let new = register(&instance, "code_te2", "new", source.sink.clone());
        assert!(*old.route.closed.borrow());
        drop(old);
        assert!(Arc::ptr_eq(
            ROUTES
                .get()
                .unwrap()
                .lock()
                .unwrap()
                .get(&(instance.clone(), "code_te2".into()))
                .unwrap(),
            &new.route
        ));
        drop(new);
        assert!(
            !ROUTES
                .get()
                .unwrap()
                .lock()
                .unwrap()
                .contains_key(&(instance, "code_te2".into()))
        );
    }
    #[test]
    fn strict_allowlist_and_no_caller_fields() {
        assert!(allowed("file_explorer", "code_te2", "document.open"));
        assert!(!allowed("unknown", "code_te2", "document.open"));
        assert!(!allowed("file_explorer", "terminal", "document.open"));
        assert!(!allowed("file_explorer", "code_te2", "runtime.debug.eval"));
        assert!(serde_json::from_value::<IntentRequest>(json!({"targetApp":"code_te2", "intent":"document.open", "context":{}, "source":{"appId":"forged"}})).is_err());
        assert!(
            serde_json::from_value::<OpenRequest>(
                json!({"appId":"terminal", "callerApp":"forged"})
            )
            .is_err()
        );
    }

    #[test]
    fn generic_service_exports_are_explicit_and_versioned() {
        let manifest = json!({"ipc":{"services":{"sidebar":{
            "version":1,"callers":["file_explorer"],"methods":["cwd.get"]
        }}}});
        let mut body: AppRpcRequest = serde_json::from_value(json!({
            "targetApp":"code_te2","service":"sidebar","version":1,
            "method":"cwd.get","payload":{}
        }))
        .unwrap();
        let policy = manifest.as_object().unwrap();
        assert!(rpc_export_allowed(policy, "file_explorer", &body).is_ok());
        assert!(rpc_export_allowed(policy, "terminal", &body).is_err());
        body.version = 2;
        assert!(rpc_export_allowed(policy, "file_explorer", &body).is_err());
        body.version = 1;
        body.method = "window.activate".into();
        assert!(rpc_export_allowed(policy, "file_explorer", &body).is_err());
        body.method = "cwd.get".into();
        body.service = "other".into();
        assert!(rpc_export_allowed(policy, "file_explorer", &body).is_err());
        assert!(rpc_export_allowed(&Map::new(), "file_explorer", &body).is_err());
        assert!(
            serde_json::from_value::<AppRpcRequest>(json!({
                "targetApp":"code_te2","service":"sidebar","version":1,
                "method":"cwd.get","payload":{},"source":{"appId":"forged"}
            }))
            .is_err()
        );
    }

    #[tokio::test]
    async fn generic_service_keeps_opaque_payload_and_correlated_errors() {
        let (source, _) = fixture("file_explorer");
        let (target, mut rx) = fixture("code_te2");
        let t = target.clone();
        let params = json!({"service":"sample","version":3,"method":"custom",
            "context":{"clientId":"client"},"payload":{"nested":[1,"text",null]},
            "source":{"appId":source.app,"shellId":source.shell}});
        let original = params.clone();
        let task = tokio::spawn(async move {
            t.deliver_message(&source, &request(), "app.rpc.deliver", params, WAIT)
                .await
        });
        let forwarded = rx.recv().await.unwrap();
        assert_eq!(forwarded.method.as_deref(), Some("app.rpc.deliver"));
        assert_eq!(forwarded.params, Some(original));
        assert_eq!(forwarded.origin_name, "framework.rust");
        assert_eq!(forwarded.op_id.as_deref(), Some("operation"));
        assert_eq!(forwarded.id, forwarded.correlation_id);
        assert_ne!(forwarded.id.as_deref(), Some("caller-id"));
        let response = PipeEnvelope::error_response(
            &forwarded,
            &PipeIdentity::framework_rust(),
            PipeError::new(
                "sample.conflict",
                "receiver rejected",
                false,
                Some(json!({"revision":2})),
            ),
        );
        assert!(target.accept(response));
        let reply = task.await.unwrap().unwrap();
        assert_eq!(reply.error.unwrap().code, "sample.conflict");
        assert!(target.pending.lock().unwrap().is_empty());
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn receiver_limits_are_method_scoped_and_cannot_be_selected_by_callers() {
        let mut manifest = json!({"ipc":{"services":{"sample":{
            "version":1,"callers":["source"],"methods":["control", "bulk"],
            "limits":{"bulk":{"requestBytes":MAX_RPC_BYTES,"replyBytes":MAX_RPC_BYTES,"timeoutMs":180000}}
        }}}});
        let mut body: AppRpcRequest = serde_json::from_value(json!({
            "targetApp":"target","service":"sample","version":1,
            "method":"control","payload":{}
        }))
        .unwrap();
        assert_eq!(
            rpc_export_allowed(manifest.as_object().unwrap(), "source", &body).unwrap(),
            RpcLimits::default()
        );
        body.method = "bulk".into();
        let limits = rpc_export_allowed(manifest.as_object().unwrap(), "source", &body).unwrap();
        assert_eq!(limits.request_bytes, MAX_RPC_BYTES);
        assert_eq!(limits.timeout_ms, 180000);
        assert!(limits.reservation(MAX_RPC_BYTES).is_ok());
        assert!(limits.reservation(MAX_RPC_BYTES + 1).is_err());
        assert!(rpc_export_allowed(manifest.as_object().unwrap(), "other", &body).is_err());
        for invalid in [
            json!({"requestBytes":0}),
            json!({"replyBytes":MAX_RPC_BYTES + 1}),
            json!({"timeoutMs":0}),
            json!({"timeoutMs":180001}),
            json!({"timeoutMs":true}),
            json!({"timeoutMs":-1}),
            json!({"unknown":1}),
        ] {
            manifest["ipc"]["services"]["sample"]["limits"]["bulk"] = invalid;
            assert!(rpc_export_allowed(manifest.as_object().unwrap(), "source", &body).is_err());
        }
        manifest["ipc"]["services"]["sample"]["limits"] = json!({"undeclared":{}});
        assert!(rpc_export_allowed(manifest.as_object().unwrap(), "source", &body).is_err());
        assert!(
            serde_json::from_value::<AppRpcRequest>(json!({
                "targetApp":"target","service":"sample","version":1,"method":"bulk",
                "payload":{},"limits":{"requestBytes":MAX_RPC_BYTES}
            }))
            .is_err()
        );
    }

    #[test]
    fn rpc_byte_reservations_are_shared_released_and_do_not_double_count_self_calls() {
        let (source, _) = fixture("source");
        let (target, _) = fixture("target");
        let limits = RpcLimits {
            request_bytes: MAX_RPC_BYTES,
            reply_bytes: MAX_RPC_BYTES,
            timeout_ms: 15000,
        };
        let first = reserve_rpc_bytes(&source, &target, limits, MAX_RPC_BYTES).unwrap();
        let second = reserve_rpc_bytes(&source, &target, limits, MAX_RPC_BYTES).unwrap();
        assert_eq!(source.rpc_bytes.available_permits(), 0);
        assert_eq!(target.rpc_bytes.available_permits(), 0);
        assert!(reserve_rpc_bytes(&source, &target, RpcLimits::default(), 1).is_err());
        drop(first);
        drop(second);
        assert_eq!(source.rpc_bytes.available_permits(), RPC_ROUTE_BYTES);
        // Target rejection must release the already acquired source permit.
        let held = target
            .rpc_bytes
            .try_acquire_many(RPC_ROUTE_BYTES as u32)
            .unwrap();
        assert!(reserve_rpc_bytes(&source, &target, limits, 1).is_err());
        assert_eq!(source.rpc_bytes.available_permits(), RPC_ROUTE_BYTES);
        drop(held);
        let self_call = reserve_rpc_bytes(&source, &source, limits, MAX_RPC_BYTES).unwrap();
        assert_eq!(
            source.rpc_bytes.available_permits(),
            RPC_ROUTE_BYTES - 2 * MAX_RPC_BYTES
        );
        drop(self_call);
        assert!(reserve_rpc_bytes(&source, &target, RpcLimits::default(), MAX_PARAMS + 1).is_err());
        assert_eq!(source.rpc_bytes.available_permits(), RPC_ROUTE_BYTES);
    }

    #[test]
    fn bulk_budget_counts_full_utf8_envelope_without_truncating_models() {
        let content = "😀".repeat(MAX_PARAMS / 4);
        let params = json!({"targetApp":"code_te2", "service":"sample", "version":1,
            "method":"publish", "context":null, "payload":{"content":content}});
        let encoded = serde_json::to_vec(&params).unwrap();
        assert!(encoded.len() > MAX_PARAMS);
        assert!(RpcLimits::default().reservation(encoded.len()).is_err());
        let bulk = RpcLimits {
            request_bytes: 2 * MAX_PARAMS,
            ..RpcLimits::default()
        };
        assert!(bulk.validate().unwrap().reservation(encoded.len()).is_ok());
        let decoded: AppRpcRequest = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(decoded.payload["content"], content);
    }

    #[test]
    fn unavailable_and_noncurrent_workers_are_rejected() {
        let (route, _) = fixture("file_explorer");
        assert!(resolve(&crate::new_instance_id().unwrap(), "code_te2").is_err());
        assert!(validate_current(&route, None).is_err());
        assert!(validate_current(&route, Some("different-shell")).is_err());
        assert!(validate_current(&route, Some(&route.shell)).is_ok());
    }

    #[test]
    fn route_query_only_selects_standalone_for_complete_managed_absence() {
        let (route, _) = fixture("als-rs");
        assert!(!rpc_route_available(None, None).unwrap());
        assert!(rpc_route_available(Some(&route), Some(&route.shell)).unwrap());
        assert!(rpc_route_available(Some(&route), None).is_err());
        assert!(rpc_route_available(None, Some(&route.shell)).is_err());
        assert!(rpc_route_available(Some(&route), Some("old-shell")).is_err());
        route.close();
        assert!(rpc_route_available(Some(&route), Some(&route.shell)).is_err());
    }

    #[tokio::test]
    async fn bounded_pending_and_cancellation_cleanup() {
        let (source, _) = fixture("file_explorer");
        let (target, mut rx) = fixture("code_te2");
        let mut tasks = Vec::new();
        for _ in 0..MAX_PENDING {
            let s = source.clone();
            let t = target.clone();
            tasks.push(tokio::spawn(async move {
                t.deliver(&s, &request(), body(), WAIT).await
            }));
            rx.recv().await.unwrap();
        }
        assert!(
            target
                .deliver(&source, &request(), body(), WAIT)
                .await
                .unwrap_err()
                .to_string()
                .contains("busy")
        );
        for task in tasks {
            task.abort();
            let _ = task.await;
        }
        assert!(target.pending.lock().unwrap().is_empty());
    }
}
