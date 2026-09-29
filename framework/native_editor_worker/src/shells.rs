//! Worker-owned intelligence children. Never constructs a TE2 server/host.
use anyhow::{Context, Result, bail, ensure};
use ferrous_framework::shellspec::{ShellspecRenderInput, render_shellspec_entry};
use ferrous_framework::{
    FerrousNativeManager, FerrousNativeShellRecord, FerrousNativeShellStatus,
    FerrousShellLaunchOverrides,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

struct Reader {
    shell: String,
    cancelled: AtomicBool,
    reading: AtomicBool,
}
struct Owner {
    manager: FerrousNativeManager,
}
pub struct Lifetime(pub Arc<Shells>);
impl Drop for Lifetime {
    fn drop(&mut self) {
        self.0.stop();
    }
}
#[derive(Default)]
pub struct Shells {
    owner: Mutex<Option<Owner>>,
    readers: Mutex<HashMap<u64, Arc<Reader>>>,
    next: std::sync::atomic::AtomicU64,
    stopping: Arc<AtomicBool>,
    drainers: Mutex<HashMap<String, std::thread::JoinHandle<()>>>,
}

fn allowed_label(label: &str) -> bool {
    matches!(
        label,
        "code_server:code_te2:global" | "workbench_adapter:code_te2:global"
    )
}

impl Shells {
    fn manager(&self) -> Result<FerrousNativeManager> {
        ensure!(
            !self.stopping.load(Ordering::Acquire),
            "native shell manager stopping"
        );
        let mut owner = self.owner.lock().unwrap();
        if owner.is_none() {
            let env = std::env::vars().collect();
            let manager = FerrousNativeManager::try_with_env_map(&env)?;
            // Ferrous starts its parent peer from the inherited environment.
            *owner = Some(Owner { manager });
        }
        Ok(owner.as_ref().unwrap().manager.clone())
    }

    pub fn get(&self, id: &str) -> Result<Option<FerrousNativeShellRecord>> {
        Ok(self
            .manager()?
            .get_shell(id)?
            .filter(|r| allowed_label(&r.label)))
    }
    pub fn find(&self, label: &str) -> Result<Option<FerrousNativeShellRecord>> {
        ensure!(
            allowed_label(label),
            "shell label outside intelligence ownership"
        );
        Ok(self
            .manager()?
            .list_shells()?
            .into_iter()
            .filter(|r| r.label == label && r.status == FerrousNativeShellStatus::Running)
            .max_by_key(|r| r.created_at_ms))
    }
    pub fn spawn(
        &self,
        path: PathBuf,
        entry: String,
        ctx: HashMap<String, String>,
        label: String,
        spec_id: String,
    ) -> Result<FerrousNativeShellRecord> {
        ensure!(
            allowed_label(&label),
            "shell label outside intelligence ownership"
        );
        let document = serde_yaml::from_slice(&std::fs::read(path)?)?;
        let mut spec = render_shellspec_entry(
            &document,
            &entry,
            &ShellspecRenderInput {
                ctx,
                env: std::env::vars().collect(),
            },
        )?;
        ensure!(
            spec.backend == "pipe",
            "intelligence children require binary pipes"
        );
        // Domain code owns code-server's listening marker and WBA's protocol ping.
        spec.readiness = None;
        self.manager()?
            .spawn_rendered_shellspec_with_overrides_blocking(
                spec,
                FerrousShellLaunchOverrides {
                    label: Some(label),
                    spec_id: Some(spec_id),
                    ..Default::default()
                },
            )
    }
    pub fn live(&self, id: &str) -> Result<bool> {
        ensure!(self.get(id)?.is_some(), "unknown intelligence shell");
        Ok(self
            .manager()?
            .get_pipe_state(id)?
            .is_some_and(|s| s.stdin_supported))
    }
    pub fn terminate(&self, id: &str) -> Result<()> {
        let record = self.get(id)?.context("unknown intelligence shell")?;
        let manager = self.manager()?;
        if record.status == FerrousNativeShellStatus::Running {
            // Use Ferrous's PID-tree shutdown (TERM/KILL, protected ancestry),
            // not its legacy persisted-record killpg convenience path.
            ensure!(record.pid > 0, "invalid intelligence child PID");
            let result = manager.shutdown_tree_blocking(vec![i64::from(record.pid)])?;
            ensure!(
                result.ok,
                "intelligence shutdown failed: {:?}",
                result.stats.errors
            );
        }
        Ok(())
    }
    pub fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        ensure!(
            self.live(id)?,
            "intelligence pipe is not locally owned/live"
        );
        ensure!(
            data.len() <= crate::protocol::FRAME_LIMIT,
            "intelligence write exceeds frame limit"
        );
        self.manager()?.write_to_pipe_blocking(id, data)?;
        Ok(())
    }
    pub fn subscribe(&self, id: String) -> Result<u64> {
        ensure!(
            self.live(&id)?,
            "intelligence stdout is not locally owned/live"
        );
        let mut readers = self.readers.lock().unwrap();
        let mut drainers = self.drainers.lock().unwrap();
        drainers.retain(|_, thread| !thread.is_finished());
        ensure!(
            !drainers.contains_key(&id),
            "intelligence stdout is logs-only"
        );
        ensure!(readers.len() < 8, "intelligence reader capacity exceeded");
        ensure!(
            !readers.values().any(|r| r.shell == id),
            "intelligence stdout already has a reader"
        );
        let token = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        readers.insert(
            token,
            Arc::new(Reader {
                shell: id,
                cancelled: AtomicBool::new(false),
                reading: AtomicBool::new(false),
            }),
        );
        Ok(token)
    }
    pub fn unsubscribe(&self, token: u64) {
        if let Some(reader) = self.readers.lock().unwrap().get(&token) {
            reader.cancelled.store(true, Ordering::Release);
        }
    }
    pub fn release(&self, token: u64) -> Result<()> {
        let mut readers = self.readers.lock().unwrap();
        let Some(reader) = readers.get(&token) else {
            return Ok(());
        };
        ensure!(
            !reader.reading.load(Ordering::Acquire),
            "reader still active during release"
        );
        let reader = readers.remove(&token).unwrap();
        if self.stopping.load(Ordering::Acquire) {
            return Ok(());
        }
        let manager = self.manager()?;
        if self
            .get(&reader.shell)?
            .is_some_and(|r| r.label == "code_server:code_te2:global")
        {
            // Code-server stdout becomes logs-only after its one-shot readiness
            // consumer. Keep draining in Rust so its OS pipe never blocks it.
            let stopping = self.stopping.clone();
            let mut drainers = self.drainers.lock().unwrap();
            drainers.retain(|_, thread| !thread.is_finished());
            let shell = reader.shell.clone();
            drainers.insert(
                shell,
                std::thread::spawn(move || {
                    while !stopping.load(Ordering::Acquire) {
                        let read_started = std::time::Instant::now();
                        match manager
                            .read_stdout_chunk_blocking(&reader.shell, Duration::from_millis(100))
                        {
                            Ok(Some(_)) => {}
                            Ok(None)
                                if manager.get_shell(&reader.shell).ok().flatten().is_some_and(
                                    |r| r.status == FerrousNativeShellStatus::Running,
                                ) =>
                            {
                                idle_read_pause(read_started)
                            }
                            Ok(None) => break,
                            Err(error) => {
                                eprintln!(
                                    "[code-te2-worker] intelligence log drain failed: {error}"
                                );
                                break;
                            }
                        }
                    }
                }),
            );
        }
        Ok(())
    }
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        for reader in self.readers.lock().unwrap().values() {
            reader.cancelled.store(true, Ordering::Release);
        }
        for (_, thread) in self.drainers.lock().unwrap().drain() {
            let _ = thread.join();
        }
    }
    pub fn read(&self, token: u64) -> Result<Vec<u8>> {
        let reader = self
            .readers
            .lock()
            .unwrap()
            .get(&token)
            .cloned()
            .context("closed intelligence reader")?;
        ensure!(
            !reader.reading.swap(true, Ordering::AcqRel),
            "concurrent intelligence read"
        );
        let result = (|| {
            let manager = self.manager()?;
            loop {
                ensure!(
                    !reader.cancelled.load(Ordering::Acquire),
                    "closed intelligence reader"
                );
                let read_started = std::time::Instant::now();
                if let Some(bytes) =
                    manager.read_stdout_chunk_blocking(&reader.shell, Duration::from_millis(100))?
                {
                    if !bytes.is_empty() {
                        return Ok(bytes);
                    }
                }
                if !manager
                    .get_shell(&reader.shell)?
                    .is_some_and(|r| r.status == FerrousNativeShellStatus::Running)
                {
                    bail!("intelligence stdout closed");
                }
                idle_read_pause(read_started);
            }
        })();
        reader.reading.store(false, Ordering::Release);
        result
    }
}

fn idle_read_pause(started: std::time::Instant) {
    // None also represents HUP; avoid spinning if a live child closes stdout.
    if let Some(rest) = Duration::from_millis(100).checked_sub(started.elapsed()) {
        std::thread::sleep(rest);
    }
}

pub fn record_value(record: Option<FerrousNativeShellRecord>) -> rmpv::Value {
    let Some(record) = record else {
        return rmpv::Value::Nil;
    };
    crate::protocol::map([
        ("id", record.id.into()),
        ("label", record.label.into()),
        ("pid", record.pid.into()),
        (
            "status",
            if record.status == FerrousNativeShellStatus::Running {
                "running"
            } else {
                "exited"
            }
            .into(),
        ),
        (
            "env_overrides",
            rmpv::Value::Map(
                record
                    .env_overrides
                    .into_iter()
                    .map(|(k, v)| (k.into(), v.into()))
                    .collect(),
            ),
        ),
        (
            "command",
            rmpv::Value::Array(record.command.into_iter().map(Into::into).collect()),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use ferrous_framework::{FerrousNativeEnv, FerrousNativePipeConfig, FerrousNativeStore};

    fn isolated() -> (tempfile::TempDir, Arc<Shells>) {
        let root = tempfile::Builder::new()
            .prefix("native-shells-")
            .tempdir_in(std::env::current_dir().unwrap().join("target"))
            .unwrap();
        let store = FerrousNativeStore::from_base_dir_fingerprint_secret(
            root.path().join("store"),
            "test".into(),
            "test-secret".into(),
        )
        .unwrap();
        let manager = FerrousNativeManager::with_store_and_env(
            store,
            FerrousNativeEnv {
                secret: "test-secret".into(),
                run_id: "isolated".into(),
                fws_socketio_url: None,
                te_framework_url: None,
                extra: HashMap::new(),
            },
        );
        let shells = Arc::new(Shells::default());
        *shells.owner.lock().unwrap() = Some(Owner { manager });
        (root, shells)
    }

    fn child(shells: &Shells, label: &str) -> FerrousNativeShellRecord {
        shells
            .manager()
            .unwrap()
            .spawn_pipe_blocking(FerrousNativePipeConfig {
                command: vec!["/bin/cat".into()],
                cwd: None,
                env: HashMap::new(),
                label: label.into(),
                spec_id: "test".into(),
                subgroups: vec![],
                log_dir: None,
            })
            .unwrap()
    }

    #[test]
    fn binary_pipe_ownership_cancellation_and_exact_shutdown() {
        let (_root, shells) = isolated();
        let _lifetime = Lifetime(shells.clone());
        let record = child(&shells, "workbench_adapter:code_te2:global");
        assert!(shells.live(&record.id).unwrap());
        assert_eq!(shells.find(&record.label).unwrap().unwrap().id, record.id);
        let token = shells.subscribe(record.id.clone()).unwrap();
        assert!(shells.subscribe(record.id.clone()).is_err());
        let bytes = b"\x81\xa1x\xc4\x03\x00\xff\x80";
        shells.write(&record.id, bytes).unwrap();
        assert_eq!(shells.read(token).unwrap(), bytes);
        let reader_shells = shells.clone();
        let reading = std::thread::spawn(move || reader_shells.read(token));
        std::thread::sleep(Duration::from_millis(30));
        shells.unsubscribe(token);
        assert!(reading.join().unwrap().is_err());
        shells.release(token).unwrap();
        let token = shells.subscribe(record.id.clone()).unwrap();
        shells.terminate(&record.id).unwrap();
        assert!(shells.read(token).is_err());
        shells.unsubscribe(token);
        shells.release(token).unwrap();
        assert_eq!(
            shells.get(&record.id).unwrap().unwrap().status,
            FerrousNativeShellStatus::Exited
        );
    }

    #[test]
    fn code_server_readiness_hands_stdout_to_native_log_drain() {
        let (_root, shells) = isolated();
        let _lifetime = Lifetime(shells.clone());
        let record = child(&shells, "code_server:code_te2:global");
        let token = shells.subscribe(record.id.clone()).unwrap();
        shells.write(&record.id, b"ready\n").unwrap();
        assert_eq!(shells.read(token).unwrap(), b"ready\n");
        shells.unsubscribe(token);
        shells.release(token).unwrap();
        assert!(shells.subscribe(record.id.clone()).is_err());
        shells.write(&record.id, b"after-readiness\n").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            shells
                .manager()
                .unwrap()
                .flush_stdout_log_blocking(&record.id)
                .unwrap();
            if std::fs::read(&record.stdout_log)
                .unwrap()
                .windows(b"after-readiness\n".len())
                .any(|w| w == b"after-readiness\n")
            {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "stdout was not drained"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        shells.terminate(&record.id).unwrap();
    }

    #[test]
    fn rejects_non_intelligence_shells() {
        let (_root, shells) = isolated();
        let record = child(&shells, "unrelated");
        assert!(shells.get(&record.id).unwrap().is_none());
        assert!(shells.terminate(&record.id).is_err());
        shells
            .manager()
            .unwrap()
            .shutdown_tree_blocking(vec![record.pid.into()])
            .unwrap();
        assert!(shells.live("missing").is_err());
        assert!(shells.find("unrelated").is_err());
    }

    #[test]
    fn persisted_record_does_not_grant_live_pipe_ownership() {
        let (root, shells) = isolated();
        let record = child(&shells, "workbench_adapter:code_te2:global");
        let store = FerrousNativeStore::from_base_dir_fingerprint_secret(
            root.path().join("store"),
            "test".into(),
            "test-secret".into(),
        )
        .unwrap();
        let manager = FerrousNativeManager::with_store_and_env(
            store,
            FerrousNativeEnv {
                secret: "test-secret".into(),
                run_id: "new-owner".into(),
                fws_socketio_url: None,
                te_framework_url: None,
                extra: HashMap::new(),
            },
        );
        let observer = Shells::default();
        *observer.owner.lock().unwrap() = Some(Owner { manager });
        assert!(observer.get(&record.id).unwrap().is_some());
        assert!(!observer.live(&record.id).unwrap());
        assert!(observer.subscribe(record.id.clone()).is_err());
        assert!(observer.write(&record.id, b"no ownership").is_err());
        shells.terminate(&record.id).unwrap();
    }

    #[test]
    fn shellspec_render_and_spawn_preserve_context() {
        let (root, shells) = isolated();
        let path = root.path().join("test.yaml");
        std::fs::write(&path, "version: '1'\nshells:\n  echo:\n    backend: pipe\n    command: [sh, -c, 'printf %s \"$MARKER\"; cat']\n    env:\n      MARKER: ${ctx:MARKER}\n").unwrap();
        let record = shells
            .spawn(
                path,
                "echo".into(),
                HashMap::from([("MARKER".into(), "configured".into())]),
                "workbench_adapter:code_te2:global".into(),
                "test".into(),
            )
            .unwrap();
        let token = shells.subscribe(record.id.clone()).unwrap();
        assert_eq!(shells.read(token).unwrap(), b"configured");
        shells.unsubscribe(token);
        shells.release(token).unwrap();
        shells.terminate(&record.id).unwrap();
    }
}
