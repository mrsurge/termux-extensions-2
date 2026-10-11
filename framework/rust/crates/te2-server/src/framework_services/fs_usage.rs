//! Bounded, owner-scoped disk-usage jobs. Independent of interactive FS reads.
use super::{
    common::path_to_string,
    fs_ops,
    pipe::{
        PipeEventSink,
        protocol::{PipeEnvelope, PipeError, PipeIdentity, PipeMessageKind},
    },
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;

// The sink is bridge-owned; envelope origin fields alone are caller-controlled.
// An active job retains its Arc so this address cannot be reused during the job.
type Key = (usize, u32, String, String);
pub(crate) struct UsageJobs {
    lane: Arc<Semaphore>,
    jobs: Mutex<HashMap<Key, Arc<AtomicBool>>>,
}
impl Default for UsageJobs {
    fn default() -> Self {
        Self {
            lane: Arc::new(Semaphore::new(2)),
            jobs: Mutex::new(HashMap::new()),
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Params {
    scan_id: String,
    root: Option<String>,
    path: Option<String>,
}
impl UsageJobs {
    pub(crate) fn dispatch(
        self: &Arc<Self>,
        request: &PipeEnvelope,
        responder: &PipeIdentity,
        sink: Option<Arc<dyn PipeEventSink>>,
    ) -> Option<PipeEnvelope> {
        let method = request.method.as_deref()?;
        if !matches!(
            method,
            "fs.directoryUsage.start" | "fs.directoryUsage.cancel"
        ) {
            return None;
        }
        let fail = |code, message: &str| {
            Some(PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new(code, message, false, None),
            ))
        };
        let Ok(mut params) =
            serde_json::from_value::<Params>(request.params.clone().unwrap_or(Value::Null))
        else {
            return fail("protocol.invalidParams", "Expected scanId, root and path");
        };
        if params.scan_id.is_empty() || params.scan_id.len() > 128 {
            return fail("protocol.invalidParams", "scanId must contain 1..128 bytes");
        }
        let Some(sink) = sink else {
            return fail(
                "fs.eventSinkRequired",
                "Directory usage requires an event sink",
            );
        };
        let key = (
            Arc::as_ptr(&sink) as *const () as usize,
            request.origin_nid,
            request.origin_name.clone(),
            params.scan_id.clone(),
        );
        let mut jobs = self.jobs.lock().unwrap();
        if method.ends_with(".cancel") {
            let cancelled = jobs
                .get(&key)
                .map(|flag| {
                    flag.store(true, Ordering::Relaxed);
                    true
                })
                .unwrap_or(false);
            return Some(PipeEnvelope::success_response(
                request,
                responder,
                json!({"scanId":params.scan_id,"cancelled":cancelled}),
            ));
        }
        if jobs.contains_key(&key) {
            return fail("fs.scanExists", "scanId is already active for this owner");
        }
        if jobs.len() >= 16 {
            return fail("fs.busy", "Directory usage admission limit reached");
        }
        if params.root.is_none() {
            params.root.clone_from(&request.workspace_root);
        }
        if params.path.as_ref().is_some_and(|path| path.len() > 65_536)
            || params.root.as_ref().is_some_and(|root| root.len() > 65_536)
        {
            return fail("protocol.invalidParams", "Directory usage path is too long");
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        jobs.insert(key.clone(), cancelled.clone());
        drop(jobs);
        let this = self.clone();
        let request = request.clone();
        let responder = responder.clone();
        let ack = PipeEnvelope::success_response(
            &request,
            &responder,
            json!({"scanId":params.scan_id,"accepted":true}),
        );
        tokio::spawn(async move {
            let started = Instant::now();
            let permit = loop {
                if cancelled.load(Ordering::Relaxed)
                    || started.elapsed() >= Duration::from_secs(120)
                {
                    break None;
                }
                tokio::select! {
                    permit = this.lane.clone().acquire_owned() => break permit.ok(),
                    _ = tokio::time::sleep(Duration::from_millis(50)) => {}
                }
            };
            let scan_id = params.scan_id.clone();
            let path = params.path.clone().unwrap_or_else(|| ".".into());
            let flag = cancelled.clone();
            let mut sequence = 0;
            let emit = move |value: Value, terminal: bool| {
                sequence += 1;
                let mut envelope = request.clone();
                envelope.kind = PipeMessageKind::Notification;
                envelope.id = None;
                envelope.method = Some(
                    if terminal {
                        "fs.directoryUsage.result"
                    } else {
                        "fs.directoryUsage.progress"
                    }
                    .into(),
                );
                envelope.origin_nid = responder.nid;
                envelope.origin_name = responder.name.clone();
                envelope.target_nid = Some(request.origin_nid);
                envelope.target_name = Some(request.origin_name.clone());
                envelope.sequence = Some(sequence);
                envelope.params = Some(value);
                envelope.result = None;
                envelope.error = None;
                if sink.send(envelope).is_err() {
                    flag.store(true, Ordering::Relaxed);
                }
            };
            // Permit ownership stays in the blocking closure even if the async waiter disappears.
            let result = tokio::task::spawn_blocking(move || {
                let _permit = permit;
                let mut emit = emit;
                let mut scan = Scan::new(scan_id, path, cancelled, started, 1_000_000, 10_000);
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    scan.run(params.root.as_deref(), &mut emit)
                }))
                .is_err()
                {
                    scan.fatal = true;
                    scan.error(Path::new(""), "Directory usage worker failed");
                }
                emit(scan.value(true), true);
            })
            .await;
            if let Err(error) = result {
                tracing::warn!(%error, "directory usage worker failed");
            }
            this.jobs.lock().unwrap().remove(&key);
        });
        Some(ack)
    }
}

struct Row {
    path: PathBuf,
    kind: &'static str,
    bytes: u64,
    complete: bool,
}
struct Scan {
    id: String,
    path: String,
    cancelled: Arc<AtomicBool>,
    started: Instant,
    last_progress: Instant,
    max_entries: u64,
    max_rows: usize,
    visited: u64,
    total: u64,
    rows: Vec<Row>,
    seen: HashSet<(u64, u64)>,
    errors: Vec<Value>,
    error_count: u64,
    reason: Option<&'static str>,
    fatal: bool,
}
impl Scan {
    fn new(
        id: String,
        path: String,
        cancelled: Arc<AtomicBool>,
        started: Instant,
        max_entries: u64,
        max_rows: usize,
    ) -> Self {
        Self {
            id,
            path,
            cancelled,
            started,
            last_progress: started,
            max_entries,
            max_rows,
            visited: 0,
            total: 0,
            rows: vec![],
            seen: HashSet::new(),
            errors: vec![],
            error_count: 0,
            reason: None,
            fatal: false,
        }
    }
    fn stop(&mut self) -> bool {
        if self.cancelled.load(Ordering::Relaxed) {
            self.reason = Some("cancelled");
        } else if self.started.elapsed() >= Duration::from_secs(120) {
            self.reason = Some("timeLimit");
        } else if self.visited >= self.max_entries {
            self.reason = Some("entryLimit");
        }
        self.reason.is_some()
    }
    fn error(&mut self, path: &Path, error: impl std::fmt::Display) {
        self.error_count += 1;
        if self.errors.len() < 32 {
            self.errors
                .push(json!({"path":path_to_string(path),"message":error.to_string()}));
        }
    }
    fn children(
        &mut self,
        path: &Path,
        limit: usize,
        emit: &mut impl FnMut(Value, bool),
    ) -> Vec<PathBuf> {
        let mut children = Vec::new();
        match fs::read_dir(path) {
            Err(e) => self.error(path, e),
            Ok(dir) => {
                for entry in dir {
                    if self.stop() {
                        break;
                    }
                    if self.last_progress.elapsed() >= Duration::from_millis(250) {
                        emit(self.value(false), false);
                        self.last_progress = Instant::now();
                    }
                    match entry {
                        Ok(e) => {
                            if children.len() >= limit {
                                self.reason = Some(if limit == self.max_rows {
                                    "rowLimit"
                                } else {
                                    "entryLimit"
                                });
                                break;
                            }
                            children.push(e.path());
                        }
                        Err(e) => self.error(path, e),
                    }
                }
            }
        }
        children.sort();
        children
    }
    fn metadata(&mut self, path: &Path, row: Option<usize>) -> Option<fs::Metadata> {
        self.visited += 1;
        match fs::symlink_metadata(path) {
            Err(e) => {
                self.error(path, e);
                None
            }
            Ok(m) => {
                #[cfg(unix)]
                let bytes = {
                    use std::os::unix::fs::MetadataExt;
                    if self.seen.insert((m.dev(), m.ino())) {
                        m.blocks().saturating_mul(512)
                    } else {
                        0
                    }
                };
                #[cfg(not(unix))]
                let bytes = m.len();
                self.total = self.total.saturating_add(bytes);
                if let Some(i) = row {
                    self.rows[i].bytes = self.rows[i].bytes.saturating_add(bytes);
                }
                Some(m)
            }
        }
    }
    fn run(&mut self, root: Option<&str>, emit: &mut impl FnMut(Value, bool)) {
        if self.stop() {
            return;
        }
        let resolved = (|| -> Result<PathBuf, String> {
            let (root, path) = fs_ops::resolve_list_directory_path(root, Some(&self.path))
                .map_err(|e| format!("{e:?}"))?;
            self.path = path_to_string(&path);
            let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
            let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
            if !path.starts_with(root) {
                return Err("Path is outside the requested root".into());
            }
            if !path.is_dir() {
                return Err("Path is not a directory".into());
            }
            Ok(path)
        })();
        let root = match resolved {
            Ok(p) => p,
            Err(e) => {
                self.fatal = true;
                self.error(Path::new(&self.path.clone()), e);
                return;
            }
        };
        self.metadata(&root, None);
        let children = self.children(&root, self.max_rows, emit);
        for path in children {
            self.rows.push(Row {
                path,
                kind: "other",
                bytes: 0,
                complete: false,
            });
        }
        for i in 0..self.rows.len() {
            if self.stop() {
                break;
            }
            let before = self.error_count;
            let mut stack = vec![self.rows[i].path.clone()];
            while let Some(path) = stack.pop() {
                if self.stop() {
                    break;
                }
                if self.last_progress.elapsed() >= Duration::from_millis(250) {
                    emit(self.value(false), false);
                    self.last_progress = Instant::now();
                }
                let Some(m) = self.metadata(&path, Some(i)) else {
                    continue;
                };
                if path == self.rows[i].path {
                    self.rows[i].kind = if m.is_symlink() {
                        "symlink"
                    } else if m.is_dir() {
                        "directory"
                    } else if m.is_file() {
                        "file"
                    } else {
                        "other"
                    };
                }
                if m.is_dir() {
                    // Revalidate containment after lstat to avoid following a replaced external directory.
                    match fs::canonicalize(&path) {
                        Ok(p) if p == path && p.starts_with(&root) => {}
                        _ => {
                            self.error(&path, "Directory changed during scan");
                            continue;
                        }
                    }
                    let remaining = (self.max_entries - self.visited)
                        .saturating_sub(stack.len() as u64)
                        as usize;
                    let children = self.children(&path, remaining, emit);
                    stack.extend(children.into_iter().rev());
                }
            }
            self.rows[i].complete = self.reason.is_none() && self.error_count == before;
            if self.last_progress.elapsed() >= Duration::from_millis(250) {
                emit(self.value(false), false);
                self.last_progress = Instant::now();
            }
        }
    }
    fn value(&self, terminal: bool) -> Value {
        let status = if !terminal {
            "running"
        } else if self.reason == Some("cancelled") {
            "cancelled"
        } else if self.fatal {
            "error"
        } else if self.reason.is_some() || self.error_count > 0 {
            "partial"
        } else {
            "complete"
        };
        let mut value = json!({"scanId":self.id,"path":self.path,"status":status,"mode":if cfg!(unix){"allocated"}else{"apparent"},"totalBytes":self.total,"entriesVisited":self.visited,"entries":[],"complete":status=="complete","errorCount":self.error_count,"errors":self.errors,"reason":self.reason});
        // Bound encoded payload, not only row count: long paths can otherwise
        // exceed the pipe frame ceiling and silently lose the terminal event.
        let mut remaining =
            (4 * 1024 * 1024usize).saturating_sub(serde_json::to_vec(&value).unwrap().len() + 256);
        {
            for row in &self.rows {
                let entry = json!({"path":path_to_string(&Path::new(&self.path).join(row.path.file_name().unwrap_or_default())),"name":row.path.file_name().unwrap_or_default().to_string_lossy(),"type":row.kind,"bytes":row.bytes,"complete":row.complete});
                let size = serde_json::to_vec(&entry).unwrap().len() + 1;
                if size > remaining {
                    if terminal {
                        value["status"] = json!("partial");
                        value["reason"] = json!("resultLimit");
                        value["complete"] = json!(false);
                    }
                    break;
                }
                remaining -= size;
                value["entries"].as_array_mut().unwrap().push(entry);
            }
        }
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directory_usage_encoded_result_limit() {
        let mut scan = Scan::new(
            "test".into(),
            format!("/{}", "p".repeat(3500)),
            Arc::new(AtomicBool::new(false)),
            Instant::now(),
            1_000_000,
            10_000,
        );
        scan.total = 1234;
        for i in 0..2000 {
            scan.rows.push(Row {
                path: PathBuf::from(format!("/{}-{i}", "n".repeat(200))),
                kind: "file",
                bytes: 1,
                complete: true,
            });
        }
        let value = scan.value(true);
        assert_eq!(value["status"], "partial");
        assert_eq!(value["reason"], "resultLimit");
        assert_eq!(value["complete"], false);
        assert_eq!(value["totalBytes"], 1234);
        assert!(value["entries"].as_array().unwrap().len() < 2000);
        assert!(serde_json::to_vec(&value).unwrap().len() < 4 * 1024 * 1024);
    }
    #[derive(Default)]
    struct Sink(Mutex<Vec<PipeEnvelope>>);
    impl PipeEventSink for Sink {
        fn send(&self, event: PipeEnvelope) -> anyhow::Result<()> {
            self.0.lock().unwrap().push(event);
            Ok(())
        }
    }
    fn request(owner: u32, method: &str, path: &Path) -> PipeEnvelope {
        serde_json::from_value(json!({"jsonrpc":"2.0","protocolVersion":1,"kind":"request","id":"req","method":method,"originNid":owner,"originName":"worker","targetNid":2100,"targetName":"service.fs","params":{"scanId":"same","root":path,"path":path}})).unwrap()
    }
    #[tokio::test]
    async fn directory_usage_owner_bound_cancel_and_terminal_event() {
        let dir = fixture();
        let jobs = Arc::new(UsageJobs::default());
        let sink = Arc::new(Sink::default());
        let responder = PipeIdentity {
            nid: 2100,
            name: "service.fs".into(),
        };
        // Occupy both permits to exercise queued cancellation deterministically.
        let _permits = jobs.lane.clone().acquire_many_owned(2).await.unwrap();
        let start = request(1, "fs.directoryUsage.start", dir.path());
        assert_eq!(
            jobs.dispatch(&start, &responder, Some(sink.clone()))
                .unwrap()
                .result
                .unwrap()["accepted"],
            true
        );
        assert_eq!(
            jobs.dispatch(&start, &responder, Some(sink.clone()))
                .unwrap()
                .error
                .unwrap()
                .code,
            "fs.scanExists"
        );
        let stranger = request(2, "fs.directoryUsage.cancel", dir.path());
        assert_eq!(
            jobs.dispatch(&stranger, &responder, Some(sink.clone()))
                .unwrap()
                .result
                .unwrap()["cancelled"],
            false
        );
        let own = request(1, "fs.directoryUsage.cancel", dir.path());
        assert_eq!(
            jobs.dispatch(&own, &responder, Some(Arc::new(Sink::default())))
                .unwrap()
                .result
                .unwrap()["cancelled"],
            false
        );
        assert_eq!(
            jobs.dispatch(&own, &responder, Some(sink.clone()))
                .unwrap()
                .result
                .unwrap()["cancelled"],
            true
        );
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if !sink.0.lock().unwrap().is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let frames = sink.0.lock().unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].target_nid, Some(1));
        assert_eq!(
            frames[0].method.as_deref(),
            Some("fs.directoryUsage.result")
        );
        assert_eq!(frames[0].params.as_ref().unwrap()["status"], "cancelled");
    }
    fn fixture() -> tempfile::TempDir {
        let base = std::env::var_os("TMPDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap().join(".usage-test-scratch"));
        fs::create_dir_all(&base).unwrap();
        tempfile::tempdir_in(base).unwrap()
    }
    fn scan(path: &Path, cancelled: bool, limit: u64) -> Value {
        let mut scan = Scan::new(
            "test".into(),
            path_to_string(path),
            Arc::new(AtomicBool::new(cancelled)),
            Instant::now(),
            limit,
            10_000,
        );
        scan.run(Some(path.to_str().unwrap()), &mut |_, _| {});
        scan.value(true)
    }
    #[test]
    fn directory_usage_empty_and_hidden_totals() {
        let dir = fixture();
        fs::create_dir(dir.path().join(".hidden")).unwrap();
        fs::write(dir.path().join(".hidden/file"), vec![1; 8192]).unwrap();
        let result = scan(dir.path(), false, 100);
        assert_eq!(result["status"], "complete");
        assert_eq!(result["entriesVisited"], 3);
        assert_eq!(result["entries"][0]["name"], ".hidden");
        assert_eq!(result["entries"][0]["complete"], true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let expected = [
                dir.path().to_path_buf(),
                dir.path().join(".hidden"),
                dir.path().join(".hidden/file"),
            ]
            .iter()
            .map(|p| fs::metadata(p).unwrap().blocks() * 512)
            .sum::<u64>();
            assert_eq!(result["totalBytes"], expected);
        }
    }
    #[test]
    fn directory_usage_cancellation_and_partial_bound() {
        let dir = fixture();
        fs::write(dir.path().join("a"), "data").unwrap();
        assert_eq!(scan(dir.path(), true, 100)["status"], "cancelled");
        let value = scan(dir.path(), false, 1);
        assert_eq!(value["status"], "partial");
        assert_eq!(value["reason"], "entryLimit");
    }
    #[test]
    fn directory_usage_running_cancel_and_row_bound() {
        let dir = fixture();
        for name in ["a", "b", "c"] {
            fs::write(dir.path().join(name), "data").unwrap();
        }
        let flag = Arc::new(AtomicBool::new(false));
        let mut scanner = Scan::new(
            "test".into(),
            path_to_string(dir.path()),
            flag.clone(),
            Instant::now() - Duration::from_secs(1),
            100,
            10,
        );
        scanner.run(
            Some(dir.path().to_str().unwrap()),
            &mut |event, terminal| {
                assert!(!terminal);
                assert_eq!(event["entries"], json!([]));
                flag.store(true, Ordering::Relaxed);
            },
        );
        assert_eq!(scanner.value(true)["status"], "cancelled");
        let mut bounded = Scan::new(
            "test".into(),
            path_to_string(dir.path()),
            Arc::new(AtomicBool::new(false)),
            Instant::now(),
            100,
            2,
        );
        bounded.run(Some(dir.path().to_str().unwrap()), &mut |_, _| {});
        assert_eq!(bounded.value(true)["reason"], "rowLimit");
        assert_eq!(bounded.rows.len(), 2);
    }
    #[cfg(unix)]
    #[test]
    fn directory_usage_symlinks_and_hardlinks() {
        use std::os::unix::fs::{MetadataExt, symlink};
        let dir = fixture();
        let outside = fixture();
        fs::write(dir.path().join("a"), vec![1; 8192]).unwrap();
        fs::hard_link(dir.path().join("a"), dir.path().join("b")).unwrap();
        fs::write(outside.path().join("secret"), vec![1; 16384]).unwrap();
        symlink(outside.path(), dir.path().join("c")).unwrap();
        let result = scan(dir.path(), false, 100);
        assert_eq!(result["status"], "complete");
        assert_eq!(result["entriesVisited"], 4);
        assert_eq!(result["entries"][1]["bytes"], 0);
        assert_eq!(result["entries"][2]["type"], "symlink");
        let expected = [
            dir.path().to_path_buf(),
            dir.path().join("a"),
            dir.path().join("c"),
        ]
        .iter()
        .map(|p| fs::symlink_metadata(p).unwrap().blocks() * 512)
        .sum::<u64>();
        assert_eq!(result["totalBytes"], expected);
    }
    #[cfg(unix)]
    #[test]
    fn directory_usage_selected_symlink_identity_and_root_fence() {
        use std::os::unix::fs::symlink;
        let dir = fixture();
        let outside = fixture();
        fs::create_dir(dir.path().join("real")).unwrap();
        fs::write(dir.path().join("real/file"), "data").unwrap();
        symlink(dir.path().join("real"), dir.path().join("alias")).unwrap();
        symlink(outside.path(), dir.path().join("escape")).unwrap();
        let mut scan = Scan::new(
            "test".into(),
            path_to_string(&dir.path().join("alias")),
            Arc::new(AtomicBool::new(false)),
            Instant::now(),
            100,
            10,
        );
        scan.run(Some(dir.path().to_str().unwrap()), &mut |_, _| {});
        let result = scan.value(true);
        assert_eq!(result["status"], "complete");
        assert_eq!(result["path"], path_to_string(&dir.path().join("alias")));
        assert_eq!(
            result["entries"][0]["path"],
            path_to_string(&dir.path().join("alias/file"))
        );
        let mut scan = Scan::new(
            "test".into(),
            path_to_string(&dir.path().join("escape")),
            Arc::new(AtomicBool::new(false)),
            Instant::now(),
            100,
            10,
        );
        scan.run(Some(dir.path().to_str().unwrap()), &mut |_, _| {});
        assert_eq!(scan.value(true)["status"], "error");
    }
}
