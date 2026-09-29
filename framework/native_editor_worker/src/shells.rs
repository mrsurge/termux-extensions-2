//! Worker-owned app children. Never constructs a TE2 server/host.
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
struct Drainer {
    cancel: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<()>,
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
    drainers: Mutex<HashMap<String, Drainer>>,
}

fn allowed_label(label: &str) -> bool {
    matches!(
        label,
        "code_server:code_te2:global"
            | "workbench_adapter:code_te2:global"
            | "code-editor-terminal"
    ) || [
        "runner-profile:code_te2:",
        "page-preview:code_te2:",
        "watchexec:code_te2:",
        "code-editor-terminal:",
    ]
    .iter()
    .any(|prefix| {
        label
            .strip_prefix(prefix)
            .is_some_and(|suffix| !suffix.is_empty())
    })
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
        let manager = self.manager()?;
        let record = manager.get_shell(id)?.filter(|r| allowed_label(&r.label));
        if record.as_ref().is_some_and(|r| r.backend == "pty")
            && !manager.live_records()?.iter().any(|r| r.id == id)
        {
            return Ok(None);
        }
        Ok(record)
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
            .filter(|r| r.backend != "pty" || self.get(&r.id).ok().flatten().is_some())
            .max_by_key(|r| r.created_at_ms))
    }
    pub fn list(&self) -> Result<Vec<FerrousNativeShellRecord>> {
        Ok(self
            .manager()?
            .list_shells()?
            .into_iter()
            .filter(|record| allowed_label(&record.label))
            .collect())
    }
    pub fn spawn(
        &self,
        path: PathBuf,
        entry: String,
        ctx: HashMap<String, String>,
        label: String,
        spec_id: String,
        wait_ready: bool,
    ) -> Result<FerrousNativeShellRecord> {
        self.spawn_grouped(path, entry, ctx, label, spec_id, wait_ready, None)
    }
    pub fn spawn_grouped(
        &self,
        path: PathBuf,
        entry: String,
        ctx: HashMap<String, String>,
        label: String,
        spec_id: String,
        wait_ready: bool,
        subgroups: Option<Vec<String>>,
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
        let terminal =
            label == "code-editor-terminal" || label.starts_with("code-editor-terminal:");
        if terminal {
            spec.env.entry("TERM".into()).or_insert_with(|| {
                std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".into())
            });
        }
        ensure!(
            spec.backend == if terminal { "pty" } else { "pipe" },
            "invalid worker shell backend"
        );
        ensure!(
            !terminal || !wait_ready,
            "terminal readiness is not output-marker based"
        );
        let readiness = spec.readiness.take();
        let probe = if wait_ready {
            let probe = readiness.context("shellspec readiness missing")?;
            ensure!(
                probe.probe_type == "output_match",
                "unsupported native worker readiness"
            );
            ensure!(
                probe.timeout_seconds.is_finite()
                    && probe.timeout_seconds > 0.0
                    && probe.timeout_seconds <= 120.0,
                "invalid shell readiness timeout"
            );
            let pattern = probe.pattern.context("shell readiness pattern missing")?;
            ensure!(pattern.len() <= 4096, "shell readiness pattern too large");
            Some((
                regex::bytes::Regex::new(&pattern)?,
                Duration::from_secs_f64(probe.timeout_seconds),
            ))
        } else {
            None
        };
        // Code-server/WBA retain their domain handshakes. The run-profile
        // marker is consumed directly, not via repeated whole-log reads.
        let manager = self.manager()?;
        let record = manager.spawn_rendered_shellspec_with_overrides_blocking(
            spec,
            FerrousShellLaunchOverrides {
                label: Some(label),
                spec_id: Some(spec_id),
                subgroups,
                ..Default::default()
            },
        )?;
        if terminal {
            if let Err(error) = self.start_log_drain(record.id.clone()) {
                let _ = manager.shutdown_tree_blocking(vec![record.pid.into()]);
                return Err(error);
            }
        }
        if let Some((pattern, timeout)) = probe {
            let ready = self
                .wait_output(&record.id, &pattern, timeout)
                .and_then(|()| self.start_log_drain(record.id.clone()));
            if let Err(error) = ready {
                let cleanup = manager.shutdown_tree_blocking(vec![record.pid.into()])?;
                ensure!(
                    cleanup.ok,
                    "readiness failed ({error}); child cleanup failed: {:?}",
                    cleanup.stats.errors
                );
                return Err(error);
            }
        }
        Ok(record)
    }

    fn wait_output(
        &self,
        id: &str,
        pattern: &regex::bytes::Regex,
        timeout: Duration,
    ) -> Result<()> {
        let manager = self.manager()?;
        let deadline = std::time::Instant::now() + timeout;
        let mut retained = Vec::new();
        while std::time::Instant::now() < deadline {
            ensure!(
                !self.stopping.load(Ordering::Acquire),
                "shell manager stopping"
            );
            let started = std::time::Instant::now();
            if let Some(bytes) =
                manager.read_stdout_chunk_blocking(id, Duration::from_millis(100))?
            {
                for chunk in bytes.chunks(32768) {
                    retained.extend_from_slice(chunk);
                    if pattern.is_match(&retained) {
                        return Ok(());
                    }
                    if retained.len() > 32768 {
                        retained.drain(..retained.len() - 32768);
                    }
                }
            }
            ensure!(
                manager
                    .get_shell(id)?
                    .is_some_and(|r| r.status == FerrousNativeShellStatus::Running),
                "shell exited before readiness"
            );
            idle_read_pause(started);
        }
        bail!("shell output readiness timed out")
    }
    pub fn live(&self, id: &str) -> Result<bool> {
        ensure!(self.get(id)?.is_some(), "unknown intelligence shell");
        if let Some(record) = self
            .manager()?
            .live_records()?
            .into_iter()
            .find(|r| r.id == id && r.backend == "pty")
        {
            return Ok(record.status == FerrousNativeShellStatus::Running);
        }
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
        ensure!(
            self.manager()?.write_blocking(id, data)?,
            "native stdin unavailable"
        );
        Ok(())
    }
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        ensure!(
            cols > 0 && rows > 0 && self.live(id)?,
            "invalid terminal resize"
        );
        ensure!(
            self.get(id)?.is_some_and(|r| r.backend == "pty"),
            "not a terminal"
        );
        ensure!(
            self.manager()?.resize_pty_blocking(id, cols, rows)?,
            "terminal resize unavailable"
        );
        Ok(())
    }
    pub fn remove(&self, id: &str) -> Result<bool> {
        let manager = self.manager()?;
        let Some(record) = manager.get_shell(id)? else {
            // Already absent: let the domain forget its stale membership.
            return Ok(true);
        };
        ensure!(
            allowed_label(&record.label) && record.backend == "pty",
            "not a drawer terminal"
        );
        let owned = manager.live_records()?.iter().any(|r| r.id == id);
        if !owned {
            ensure!(
                record.status == FerrousNativeShellStatus::Exited,
                "terminal is not locally owned"
            );
            // Ferrous retains this history and owns its eventual cleanup.
            // Success here only authorizes forgetting the drawer membership.
            return Ok(true);
        }
        self.terminate(id)?;
        if let Some(drainer) = self.drainers.lock().unwrap().remove(id) {
            drainer.cancel.store(true, Ordering::Release);
            let _ = drainer.thread.join();
        }
        manager.remove_exited_shell_blocking(id)
    }
    pub fn subscribe(&self, id: String) -> Result<u64> {
        ensure!(
            self.live(&id)?,
            "intelligence stdout is not locally owned/live"
        );
        let mut readers = self.readers.lock().unwrap();
        let mut drainers = self.drainers.lock().unwrap();
        drainers.retain(|_, drainer| !drainer.thread.is_finished());
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
        if self
            .get(&reader.shell)?
            .is_some_and(|r| r.label == "code_server:code_te2:global")
        {
            // Code-server stdout becomes logs-only after its one-shot readiness
            // consumer. Keep draining in Rust so its OS pipe never blocks it.
            self.start_log_drain(reader.shell.clone())?;
        }
        Ok(())
    }
    fn start_log_drain(&self, shell: String) -> Result<()> {
        let manager = self.manager()?;
        let stopping = self.stopping.clone();
        let mut drainers = self.drainers.lock().unwrap();
        drainers.retain(|_, drainer| !drainer.thread.is_finished());
        ensure!(drainers.len() < 64, "native log-drainer capacity exceeded");
        ensure!(
            !drainers.contains_key(&shell),
            "shell already has a log drainer"
        );
        let cancel = Arc::new(AtomicBool::new(false));
        let cancelled = cancel.clone();
        drainers.insert(
            shell.clone(),
            Drainer {
                cancel,
                thread: std::thread::spawn(move || {
                    while !stopping.load(Ordering::Acquire) && !cancelled.load(Ordering::Acquire) {
                        let read_started = std::time::Instant::now();
                        match manager.read_stdout_chunk_blocking(&shell, Duration::from_millis(100))
                        {
                            Ok(Some(_)) => {}
                            Ok(None)
                                if manager.get_shell(&shell).ok().flatten().is_some_and(|r| {
                                    r.status == FerrousNativeShellStatus::Running
                                }) =>
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
            },
        );
        Ok(())
    }
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        for reader in self.readers.lock().unwrap().values() {
            reader.cancelled.store(true, Ordering::Release);
        }
        for (_, drainer) in self.drainers.lock().unwrap().drain() {
            let _ = drainer.thread.join();
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
        ("backend", record.backend.into()),
        ("pid", record.pid.into()),
        (
            "stdout_log",
            record.stdout_log.to_string_lossy().to_string().into(),
        ),
        (
            "exit_code",
            record.exit_code.map_or(rmpv::Value::Nil, Into::into),
        ),
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
    fn stale_drawer_close_leaves_foreign_history_but_rejects_live_shell() {
        let (root, shells) = isolated();
        let _lifetime = Lifetime(shells.clone());
        let path = root.path().join("terminal.yaml");
        std::fs::write(&path, "version: '1'\nshells:\n  terminal:\n    backend: pty\n    command: [sh, -c, 'sleep 30']\n").unwrap();
        let record = shells
            .spawn(
                path,
                "terminal".into(),
                HashMap::new(),
                "code-editor-terminal:project:abcd1234:1".into(),
                "test".into(),
                false,
            )
            .unwrap();
        let store = FerrousNativeStore::from_base_dir_fingerprint_secret(
            root.path().join("store"),
            "test".into(),
            "test-secret".into(),
        )
        .unwrap();
        let observer = Shells::default();
        *observer.owner.lock().unwrap() = Some(Owner {
            manager: FerrousNativeManager::with_store_and_env(
                store,
                FerrousNativeEnv {
                    secret: "test-secret".into(),
                    run_id: "observer".into(),
                    fws_socketio_url: None,
                    te_framework_url: None,
                    extra: HashMap::new(),
                },
            ),
        });
        assert!(observer.remove(&record.id).is_err());
        shells.terminate(&record.id).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while observer
            .manager()
            .unwrap()
            .get_shell(&record.id)
            .unwrap()
            .unwrap()
            .status
            != FerrousNativeShellStatus::Exited
        {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(observer.remove(&record.id).unwrap());
        assert!(
            observer
                .manager()
                .unwrap()
                .get_shell(&record.id)
                .unwrap()
                .is_some()
        );
        assert!(observer.remove("missing").unwrap());
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
                false,
            )
            .unwrap();
        let token = shells.subscribe(record.id.clone()).unwrap();
        assert_eq!(shells.read(token).unwrap(), b"configured");
        shells.unsubscribe(token);
        shells.release(token).unwrap();
        shells.terminate(&record.id).unwrap();
    }

    #[test]
    fn auxiliary_marker_readiness_and_logs_survive_split_output() {
        let (root, shells) = isolated();
        let _lifetime = Lifetime(shells.clone());
        let path = root.path().join("ready.yaml");
        std::fs::write(&path, "version: '1'\nshells:\n  runner:\n    backend: pipe\n    command: [sh, -c, 'printf runner-; sleep 0.05; printf \"profile-ready\\n\"; cat']\n    readiness:\n      type: output_match\n      pattern: runner-profile-ready\n      timeout: 2\n").unwrap();
        for label in [
            "runner-profile:code_te2:project:profile",
            "page-preview:code_te2:project:preview",
        ] {
            let record = shells
                .spawn(
                    path.clone(),
                    "runner".into(),
                    HashMap::new(),
                    label.into(),
                    "test".into(),
                    true,
                )
                .unwrap();
            assert!(shells.subscribe(record.id.clone()).is_err());
            assert!(shells.list().unwrap().iter().any(|r| r.id == record.id));
            shells.write(&record.id, b"after-ready\n").unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            let drained = loop {
                shells
                    .manager()
                    .unwrap()
                    .flush_stdout_log_blocking(&record.id)
                    .unwrap();
                if std::fs::read(&record.stdout_log)
                    .unwrap()
                    .windows(12)
                    .any(|w| w == b"after-ready\n")
                {
                    break true;
                }
                if std::time::Instant::now() > deadline {
                    break false;
                }
                std::thread::sleep(Duration::from_millis(20));
            };
            shells.terminate(&record.id).unwrap();
            assert!(drained);
        }
    }

    #[test]
    fn failed_marker_readiness_reaps_the_child() {
        let (root, shells) = isolated();
        let path = root.path().join("timeout.yaml");
        std::fs::write(&path, "version: '1'\nshells:\n  runner:\n    backend: pipe\n    command: [cat]\n    readiness:\n      type: output_match\n      pattern: never-ready\n      timeout: 0.15\n").unwrap();
        let error = shells
            .spawn(
                path,
                "runner".into(),
                HashMap::new(),
                "runner-profile:code_te2:project:timeout".into(),
                "test".into(),
                true,
            )
            .unwrap_err();
        assert!(error.to_string().contains("timed out"));
        let records = shells.list().unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, FerrousNativeShellStatus::Exited);
    }

    #[test]
    fn watcher_keeps_the_binary_reader_instead_of_a_log_only_drain() {
        let (_root, shells) = isolated();
        let record = child(&shells, "watchexec:code_te2:project");
        let token = shells.subscribe(record.id.clone()).unwrap();
        shells.write(&record.id, b"{\"tags\":[]}\n").unwrap();
        assert_eq!(shells.read(token).unwrap(), b"{\"tags\":[]}\n");
        shells.unsubscribe(token);
        shells.release(token).unwrap();
        let replacement = shells.subscribe(record.id.clone()).unwrap();
        shells.unsubscribe(replacement);
        shells.release(replacement).unwrap();
        shells.terminate(&record.id).unwrap();
    }
}
