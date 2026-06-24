#[cfg(feature = "ferrous-framework-native")]
mod native {
    use crate::framework_services::{
        pipe::{
            PipeEventSink, dispatch_request,
            protocol::{PipeEnvelope, PipeIdentity, PipeMessageKind, decode_line, encode_line},
        },
        scheduler::FrameworkServiceScheduler,
    };
    use ferrous_framework::{FerrousNativeManager, FerrousNativeShellStatus};
    use std::{
        collections::HashSet,
        sync::{Arc, Mutex, OnceLock},
        time::Duration,
    };
    use tokio::runtime::Handle;
    use tracing::{debug, warn};

    static ACTIVE_BRIDGES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

    pub(crate) fn ensure_bridge(
        manager: Option<FerrousNativeManager>,
        shell_id: impl Into<String>,
        app_id: impl Into<String>,
        scheduler: FrameworkServiceScheduler,
    ) {
        let Some(manager) = manager else {
            return;
        };
        let shell_id = shell_id.into();
        let app_id = app_id.into();
        let active = ACTIVE_BRIDGES.get_or_init(|| Mutex::new(HashSet::new()));
        {
            let Ok(mut active) = active.lock() else {
                return;
            };
            if !active.insert(shell_id.clone()) {
                return;
            }
        }
        let handle = Handle::current();
        tokio::task::spawn_blocking(move || {
            if let Err(error) = run_bridge(manager, &shell_id, &app_id, scheduler, handle) {
                warn!(%error, %shell_id, %app_id, "app-worker pipe bridge stopped with error");
            }
            if let Some(active) = ACTIVE_BRIDGES.get() {
                if let Ok(mut active) = active.lock() {
                    active.remove(&shell_id);
                }
            }
        });
    }

    fn run_bridge(
        manager: FerrousNativeManager,
        shell_id: &str,
        app_id: &str,
        scheduler: FrameworkServiceScheduler,
        handle: Handle,
    ) -> anyhow::Result<()> {
        let mut buffer = Vec::<u8>::new();
        loop {
            match manager.read_stdout_chunk_blocking(shell_id, Duration::from_millis(250))? {
                Some(chunk) => {
                    buffer.extend_from_slice(&chunk);
                    while let Some(line) = take_line(&mut buffer) {
                        handle_stdout_line(
                            &manager,
                            shell_id,
                            app_id,
                            &line,
                            scheduler.clone(),
                            handle.clone(),
                        );
                    }
                }
                None => {
                    if !pipe_is_live(&manager, shell_id)? {
                        break;
                    }
                }
            }
        }
        Ok(())
    }

    fn handle_stdout_line(
        manager: &FerrousNativeManager,
        shell_id: &str,
        app_id: &str,
        line: &[u8],
        scheduler: FrameworkServiceScheduler,
        handle: Handle,
    ) {
        let text = String::from_utf8_lossy(line);
        let request = match decode_line(text.as_ref()) {
            Ok(envelope) => envelope,
            Err(error) => {
                warn!(%error, %shell_id, %app_id, "invalid app-worker pipe frame");
                return;
            }
        };
        if !matches!(&request.kind, PipeMessageKind::Request) {
            debug!(
                kind = ?&request.kind,
                id = ?request.id,
                %shell_id,
                %app_id,
                "ignoring app-worker non-request pipe frame"
            );
            return;
        }

        let responder = PipeIdentity {
            nid: request.target_nid.unwrap_or(1),
            name: request
                .target_name
                .clone()
                .unwrap_or_else(|| "framework.rust".to_owned()),
        };
        let sink: Arc<dyn PipeEventSink> = Arc::new(FerrousPipeSink {
            manager: manager.clone(),
            shell_id: shell_id.to_owned(),
            app_id: app_id.to_owned(),
        });
        let response_sink = Arc::clone(&sink);
        handle.spawn(async move {
            let response = dispatch_request(request, &responder, &scheduler, Some(sink)).await;
            if let Err(error) = response_sink.send(response) {
                warn!(%error, "failed to write pipe response to app-worker");
            }
        });
    }

    struct FerrousPipeSink {
        manager: FerrousNativeManager,
        shell_id: String,
        app_id: String,
    }

    impl PipeEventSink for FerrousPipeSink {
        fn send(&self, envelope: PipeEnvelope) -> anyhow::Result<()> {
            let encoded = encode_line(&envelope)?;
            self.manager
                .write_to_pipe_blocking(&self.shell_id, encoded.as_bytes())?;
            debug!(shell_id = %self.shell_id, app_id = %self.app_id, "wrote app-worker pipe frame");
            Ok(())
        }
    }

    fn take_line(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
        let pos = buffer.iter().position(|byte| *byte == b'\n')?;
        let mut line = buffer.drain(..=pos).collect::<Vec<_>>();
        while matches!(line.last(), Some(b'\n' | b'\r')) {
            line.pop();
        }
        if line.is_empty() { None } else { Some(line) }
    }

    fn pipe_is_live(manager: &FerrousNativeManager, shell_id: &str) -> anyhow::Result<bool> {
        let Some(state) = manager.get_pipe_state(shell_id)? else {
            return Ok(false);
        };
        Ok(state.status == FerrousNativeShellStatus::Running)
    }
}

#[cfg(feature = "ferrous-framework-native")]
pub(crate) use native::ensure_bridge;

#[cfg(not(feature = "ferrous-framework-native"))]
#[allow(dead_code)]
pub(crate) fn ensure_bridge(
    _: Option<()>,
    _: impl Into<String>,
    _: impl Into<String>,
    _: crate::framework_services::scheduler::FrameworkServiceScheduler,
) {
}
