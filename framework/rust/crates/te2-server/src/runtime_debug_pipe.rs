//! Internal diagnostic routing. No public HTTP or evaluation surface lives here.
use crate::framework_services::pipe::{
    PipeEventSink,
    protocol::{JSONRPC_VERSION, PROTOCOL_VERSION, PipeEnvelope, PipeMessageKind},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::sync::oneshot;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugTarget {
    pub app_id: String,
    pub shell_id: String,
    pub instance_id: String,
}

struct Pending {
    id: String,
    sender: oneshot::Sender<PipeEnvelope>,
}

#[derive(Default)]
struct RouteState {
    closed: bool,
    pending: Option<Pending>,
}

pub(crate) struct DebugRoute {
    target: DebugTarget,
    sink: Arc<dyn PipeEventSink>,
    state: Mutex<RouteState>,
}

impl DebugRoute {
    pub(crate) fn close(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.closed = true;
        // Dropping the sender wakes the waiter; no retry or implied rollback.
        state.pending = None;
    }

    pub(crate) fn accept(&self, response: PipeEnvelope) -> bool {
        if !matches!(
            response.kind,
            PipeMessageKind::Response | PipeMessageKind::Error
        ) {
            return false;
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let Some(pending) = state.pending.as_ref() else {
            return false;
        };
        if response.id.as_ref() != Some(&pending.id)
            || response.correlation_id.as_ref() != Some(&pending.id)
            || response.target_nid != Some(1)
            || response.target_name.as_deref() != Some("framework.rust")
        {
            return false;
        }
        if let Some(pending) = state.pending.take() {
            let _ = pending.sender.send(response);
        }
        true
    }

    async fn status(self: &Arc<Self>, wait: Duration) -> anyhow::Result<PipeEnvelope> {
        self.request("runtime.debug.status", None, wait).await
    }

    async fn request(
        self: &Arc<Self>,
        method: &str,
        params: Option<serde_json::Value>,
        wait: Duration,
    ) -> anyhow::Result<PipeEnvelope> {
        if wait.is_zero() || wait > Duration::from_secs(30) {
            anyhow::bail!("runtimeDebug.invalidTimeout");
        }
        let id = crate::new_instance_id()?;
        let (sender, receiver) = oneshot::channel();
        {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            if state.closed {
                anyhow::bail!("runtimeDebug.disconnected");
            }
            if state.pending.is_some() {
                anyhow::bail!("runtimeDebug.busy");
            }
            state.pending = Some(Pending {
                id: id.clone(),
                sender,
            });
        }
        // Drop clears admission on timeout, enqueue failure, or caller cancellation.
        // Clearing a waiter does not cancel already-accepted worker execution.
        let _pending = PendingGuard {
            route: self.clone(),
            id: id.clone(),
        };
        let request = PipeEnvelope {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            protocol_version: PROTOCOL_VERSION,
            kind: PipeMessageKind::Request,
            id: Some(id.clone()),
            method: Some(method.to_owned()),
            origin_nid: 1,
            origin_name: "framework.rust".to_owned(),
            target_nid: None,
            target_name: None,
            project_generation: None,
            workspace_root: None,
            correlation_id: Some(id),
            op_id: None,
            sequence: None,
            params,
            result: None,
            error: None,
            reason: None,
        };
        // Exact routing is the captured shell/bridge, not a guessed worker NID.
        self.sink.send(request)?;
        match tokio::time::timeout(wait, receiver).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => anyhow::bail!("runtimeDebug.disconnected"),
            Err(_) => anyhow::bail!("runtimeDebug.timeout: execution outcome may be unknown"),
        }
    }
}

struct PendingGuard {
    route: Arc<DebugRoute>,
    id: String,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        let mut state = self
            .route
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state
            .pending
            .as_ref()
            .is_some_and(|pending| pending.id == self.id)
        {
            state.pending = None;
        }
    }
}

#[derive(Default)]
struct Routes {
    entries: Mutex<HashMap<String, Arc<DebugRoute>>>,
}
static ROUTES: OnceLock<Arc<Routes>> = OnceLock::new();

impl Routes {
    fn resolve(&self, target: &DebugTarget) -> anyhow::Result<Arc<DebugRoute>> {
        let entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let route = entries
            .get(&target.shell_id)
            .filter(|route| route.target == *target)
            .ok_or_else(|| anyhow::anyhow!("runtimeDebug.staleTarget"))?;
        Ok(route.clone())
    }
}

// Registration is scoped to the bridge stack, including error/panic unwinding.
pub(crate) struct Registration {
    routes: Arc<Routes>,
    pub route: Arc<DebugRoute>,
}
impl Drop for Registration {
    fn drop(&mut self) {
        self.route.close();
        let mut entries = self
            .routes
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if entries
            .get(&self.route.target.shell_id)
            .is_some_and(|route| Arc::ptr_eq(route, &self.route))
        {
            entries.remove(&self.route.target.shell_id);
        }
    }
}

pub(crate) fn register(
    app_id: &str,
    shell_id: &str,
    sink: Arc<dyn PipeEventSink>,
) -> anyhow::Result<Option<Registration>> {
    // Capture enablement at bridge creation. Neither a request nor a manifest can
    // enable a route in a framework that was started with diagnostics disabled.
    let enabled = std::env::var("TE2_RUNTIME_DEBUG").is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    });
    if !enabled {
        return Ok(None);
    }
    let routes = ROUTES.get_or_init(|| Arc::new(Routes::default())).clone();
    let route = Arc::new(DebugRoute {
        target: DebugTarget {
            app_id: app_id.to_owned(),
            shell_id: shell_id.to_owned(),
            instance_id: crate::new_instance_id()?,
        },
        sink,
        state: Mutex::new(RouteState::default()),
    });
    {
        let mut entries = routes
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if entries.contains_key(shell_id) {
            anyhow::bail!("runtimeDebug.duplicateBridge");
        }
        entries.insert(shell_id.to_owned(), route.clone());
    }
    Ok(Some(Registration { routes, route }))
}

// The authenticated HTTP facade uses this registry; disabled frameworks never
// register routes, and each request must retain the exact live bridge identity.
pub(crate) fn targets() -> Vec<DebugTarget> {
    let Some(routes) = ROUTES.get() else {
        return Vec::new();
    };
    routes
        .entries
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .values()
        .filter(|route| {
            !route
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .closed
        })
        .map(|route| route.target.clone())
        .collect()
}

pub(crate) async fn status(target: &DebugTarget, wait: Duration) -> anyhow::Result<PipeEnvelope> {
    let routes = ROUTES
        .get()
        .ok_or_else(|| anyhow::anyhow!("runtimeDebug.unavailable"))?;
    routes.resolve(target)?.status(wait).await
}

pub(crate) async fn evaluate(
    target: &DebugTarget,
    code: String,
    wait: Duration,
) -> anyhow::Result<PipeEnvelope> {
    if code.trim().is_empty() || code.len() > 32 * 1024 {
        anyhow::bail!("runtimeDebug.invalidCode");
    }
    let routes = ROUTES
        .get()
        .ok_or_else(|| anyhow::anyhow!("runtimeDebug.unavailable"))?;
    routes
        .resolve(target)?
        .request(
            "runtime.debug.eval",
            Some(serde_json::json!({"code": code})),
            wait,
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework_services::pipe::protocol::PipeIdentity;

    struct Sink {
        sender: tokio::sync::mpsc::UnboundedSender<PipeEnvelope>,
        fail: bool,
    }
    impl PipeEventSink for Sink {
        fn send(&self, frame: PipeEnvelope) -> anyhow::Result<()> {
            if self.fail {
                anyhow::bail!("queue full");
            }
            self.sender.send(frame)?;
            Ok(())
        }
    }
    fn fixture(
        fail: bool,
    ) -> (
        Arc<DebugRoute>,
        tokio::sync::mpsc::UnboundedReceiver<PipeEnvelope>,
    ) {
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        (
            Arc::new(DebugRoute {
                target: DebugTarget {
                    app_id: "app".into(),
                    shell_id: "shell".into(),
                    instance_id: "generation-1".into(),
                },
                sink: Arc::new(Sink { sender, fail }),
                state: Mutex::default(),
            }),
            receiver,
        )
    }
    fn response(request: &PipeEnvelope) -> PipeEnvelope {
        PipeEnvelope::success_response(
            request,
            &PipeIdentity {
                nid: 2100,
                name: "service.app".into(),
            },
            serde_json::json!({"enabled": true}),
        )
    }

    #[tokio::test]
    async fn correlates_once_and_preserves_worker_errors() {
        let (route, mut receiver) = fixture(false);
        let cloned = route.clone();
        let task = tokio::spawn(async move { cloned.status(Duration::from_secs(2)).await });
        let request = receiver.recv().await.unwrap();
        let mut wrong = response(&request);
        wrong.correlation_id = Some("other".into());
        assert!(!route.accept(wrong));
        let mut wrong = response(&request);
        wrong.target_name = Some("other".into());
        assert!(!route.accept(wrong));
        let mut wrong = response(&request);
        wrong.id = Some("stale".into());
        assert!(!route.accept(wrong));
        let mut reply = response(&request);
        reply.kind = PipeMessageKind::Error;
        reply.error = Some(crate::framework_services::pipe::protocol::PipeError::new(
            "runtimeDebug.disabled",
            "disabled",
            false,
            None,
        ));
        assert!(route.accept(reply.clone()));
        assert!(!route.accept(reply));
        assert_eq!(
            task.await.unwrap().unwrap().error.unwrap().code,
            "runtimeDebug.disabled"
        );
    }

    #[tokio::test]
    async fn bounded_admission_and_disconnect_wakeup() {
        let (route, mut receiver) = fixture(false);
        let cloned = route.clone();
        let task = tokio::spawn(async move { cloned.status(Duration::from_secs(2)).await });
        let _ = receiver.recv().await.unwrap();
        assert!(
            route
                .status(Duration::from_secs(1))
                .await
                .unwrap_err()
                .to_string()
                .contains("busy")
        );
        route.close();
        assert!(
            task.await
                .unwrap()
                .unwrap_err()
                .to_string()
                .contains("disconnected")
        );
        assert!(
            route
                .status(Duration::from_secs(1))
                .await
                .unwrap_err()
                .to_string()
                .contains("disconnected")
        );
    }

    #[tokio::test]
    async fn timeout_abort_and_enqueue_failure_release_admission() {
        let (route, mut receiver) = fixture(false);
        assert!(
            route
                .status(Duration::from_millis(1))
                .await
                .unwrap_err()
                .to_string()
                .contains("timeout")
        );
        let late = receiver.recv().await.unwrap();
        assert!(!route.accept(response(&late)));
        assert!(route.state.lock().unwrap().pending.is_none());
        let cloned = route.clone();
        let task = tokio::spawn(async move { cloned.status(Duration::from_secs(2)).await });
        let _ = receiver.recv().await.unwrap();
        task.abort();
        let _ = task.await;
        assert!(route.state.lock().unwrap().pending.is_none());
        let (failed, _) = fixture(true);
        assert!(
            failed
                .status(Duration::from_secs(1))
                .await
                .unwrap_err()
                .to_string()
                .contains("queue full")
        );
        assert!(failed.state.lock().unwrap().pending.is_none());
        assert!(failed.status(Duration::ZERO).await.is_err());
        assert!(failed.status(Duration::from_secs(31)).await.is_err());
    }

    #[test]
    fn identity_and_registration_cleanup_are_instance_scoped() {
        let (old, _) = fixture(false);
        let (new, _) = fixture(false);
        let routes = Arc::new(Routes::default());
        routes
            .entries
            .lock()
            .unwrap()
            .insert("shell".into(), old.clone());
        let mut stale = old.target.clone();
        stale.instance_id = "previous".into();
        assert!(routes.resolve(&stale).is_err());
        stale = old.target.clone();
        stale.app_id = "other".into();
        assert!(routes.resolve(&stale).is_err());
        assert!(routes.resolve(&old.target).is_ok());
        let guard = Registration {
            routes: routes.clone(),
            route: old.clone(),
        };
        routes
            .entries
            .lock()
            .unwrap()
            .insert("shell".into(), new.clone());
        drop(guard);
        assert!(old.state.lock().unwrap().closed);
        assert!(Arc::ptr_eq(&routes.resolve(&new.target).unwrap(), &new));
    }
}
