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
use tokio::sync::{Semaphore, oneshot, watch};

const MAX_PENDING: usize = 16;
const MAX_PARAMS: usize = 64 * 1024;
const WAIT: Duration = Duration::from_secs(15);
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
}

impl Route {
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
        forwarded.method = Some("app.intent.deliver".into());
        forwarded.result = None;
        forwarded.error = None;
        forwarded.params = Some(json!({
            "intent": body.intent, "context": body.context, "payload": body.payload,
            "source": {"appId": source.app, "shellId": source.shell}
        }));
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

/// None means an existing framework service owns this method.
pub(crate) async fn dispatch(
    state: &crate::AppState,
    source: &Arc<Route>,
    request: &PipeEnvelope,
) -> Option<PipeEnvelope> {
    let method = request.method.as_deref()?;
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
    fn unavailable_and_noncurrent_workers_are_rejected() {
        let (route, _) = fixture("file_explorer");
        assert!(resolve(&crate::new_instance_id().unwrap(), "code_te2").is_err());
        assert!(validate_current(&route, None).is_err());
        assert!(validate_current(&route, Some("different-shell")).is_err());
        assert!(validate_current(&route, Some(&route.shell)).is_ok());
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
