mod decode;
mod protocol;
mod values;

use anyhow::{Context, Result, bail};
use protocol::*;
use pyo3::exceptions::PyRuntimeError;
use pyo3::prelude::*;
use rmpv::Value;
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    mpsc::{self, Receiver, SyncSender},
};
use std::thread;
use std::time::Duration;

type Reply = std::result::Result<Frame<Value>, String>;

struct Lease {
    size: usize,
    budget: Arc<AtomicUsize>,
}
impl Lease {
    fn acquire(budget: &Arc<AtomicUsize>, size: usize) -> Result<Self> {
        budget
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                used.checked_add(size).filter(|next| *next <= BYTE_BUDGET)
            })
            .map_err(|_| anyhow::anyhow!("mailbox byte budget exceeded"))?;
        Ok(Self {
            size,
            budget: budget.clone(),
        })
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.budget.fetch_sub(self.size, Ordering::AcqRel);
    }
}
struct Frame<T> {
    value: T,
    _lease: Lease,
}

struct Shared {
    pending: Mutex<HashMap<String, SyncSender<Reply>>>,
    counter: AtomicU64,
    input_closed: AtomicBool,
    output_closed: AtomicBool,
    failed: AtomicBool,
    finished: AtomicBool,
    output_budget: Arc<AtomicUsize>,
    reply_budget: Arc<AtomicUsize>,
    nid: u32,
    name: String,
}
impl Shared {
    fn stop_pending(&self, reason: &str) {
        self.input_closed.store(true, Ordering::Release);
        let pending = std::mem::take(&mut *self.pending.lock().unwrap());
        for (_, sender) in pending {
            let _ = sender.try_send(Err(reason.to_owned()));
        }
    }
    fn fail(&self, reason: &str) {
        self.failed.store(true, Ordering::Release);
        self.stop_pending(reason);
    }
}

#[derive(Clone)]
struct Output {
    tx: SyncSender<Frame<Vec<u8>>>,
    shared: Arc<Shared>,
}
impl Output {
    fn send(&self, value: &Value) -> Result<()> {
        if self.shared.failed.load(Ordering::Acquire)
            || self.shared.output_closed.load(Ordering::Acquire)
        {
            bail!("pipe transport closed");
        }
        let mut bytes = Vec::new();
        // Encoding into a bounded writer prevents an oversized reply buffer.
        rmpv::encode::write_value(&mut BoundedWrite(&mut bytes), value)?;
        let lease = Lease::acquire(&self.shared.output_budget, bytes.len())?;
        self.tx
            .try_send(Frame {
                value: bytes,
                _lease: lease,
            })
            .map_err(|_| anyhow::anyhow!("pipe output queue full or closed"))
    }
    fn reply(&self, request: &Value, result: Value, is_error: bool) -> Result<()> {
        self.send(&response(
            request,
            result,
            is_error,
            self.shared.nid,
            &self.shared.name,
        ))
    }
}
struct BoundedWrite<'a>(&'a mut Vec<u8>);
impl Write for BoundedWrite<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > FRAME_LIMIT.saturating_sub(self.0.len()) {
            return Err(io::Error::other("frame byte limit exceeded"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[pyclass]
struct NativeBridge {
    output: Output,
}
#[pymethods]
impl NativeBridge {
    #[pyo3(signature = (method, params=None, timeout=5.0))]
    fn call(
        &self,
        py: Python<'_>,
        method: &str,
        params: Option<&Bound<'_, PyAny>>,
        timeout: f64,
    ) -> PyResult<Py<PyAny>> {
        if method.is_empty() || !timeout.is_finite() || timeout <= 0.0 || timeout > 300.0 {
            return Err(PyRuntimeError::new_err("invalid method/timeout"));
        }
        let params = params
            .map(values::from_python)
            .transpose()?
            .unwrap_or(Value::Nil);
        let shared = &self.output.shared;
        let id = format!(
            "native:{}:{}",
            std::process::id(),
            shared.counter.fetch_add(1, Ordering::Relaxed)
        );
        let request = map([
            ("jsonrpc", "2.0".into()),
            ("protocolVersion", 1.into()),
            ("kind", "request".into()),
            ("id", id.clone().into()),
            ("method", method.into()),
            ("originNid", shared.nid.into()),
            ("originName", shared.name.clone().into()),
            ("targetNid", 1.into()),
            ("targetName", "framework.rust".into()),
            ("params", params),
        ]);
        let (tx, rx) = mpsc::sync_channel(1);
        {
            let mut pending = shared.pending.lock().unwrap();
            if shared.input_closed.load(Ordering::Acquire) || pending.len() >= CAPACITY {
                return Err(PyRuntimeError::new_err(
                    "pipe closed or pending-call capacity exhausted",
                ));
            }
            pending.insert(id.clone(), tx);
        }
        // No interpreter attachment or registry lock while awaiting native I/O.
        let output = self.output.clone();
        let result = py.detach(move || -> Reply {
            output.send(&request).map_err(|e| e.to_string())?;
            rx.recv_timeout(Duration::from_secs_f64(timeout))
                .map_err(|_| "framework reply timeout/disconnected".to_owned())?
        });
        shared.pending.lock().unwrap().remove(&id);
        let reply = result.map_err(PyRuntimeError::new_err)?;
        if text(&reply.value, "kind") == Some("error") {
            return Err(PyRuntimeError::new_err(format!(
                "framework error: {}",
                get(&reply.value, "error")
                    .and_then(|e| text(e, "code"))
                    .unwrap_or("unknown")
            )));
        }
        values::to_python(py, get(&reply.value, "result").unwrap_or(&Value::Nil))
    }
}

fn read_loop(
    output: Output,
    requests: SyncSender<Frame<Value>>,
    budget: Arc<AtomicUsize>,
) -> Result<()> {
    let mut reader = BufReader::new(io::stdin());
    loop {
        if reader.fill_buf()?.is_empty() {
            return Ok(());
        }
        let (value, size) = decode::read_frame(&mut reader)?;
        if let Err(error) = validate(&value) {
            output.reply(
                &Value::Nil,
                protocol::error("protocol.invalidFrame", &error.to_string()),
                true,
            )?;
            continue;
        }
        match text(&value, "kind") {
            Some("response" | "error") => {
                if let Some(id) = text(&value, "id") {
                    let mut pending = output.shared.pending.lock().unwrap();
                    // Fence optional target identity before consuming a pending id.
                    if get(&value, "targetNid").is_some_and(|v| {
                        !v.is_nil() && v.as_u64() != Some(output.shared.nid as u64)
                    }) || text(&value, "targetName")
                        .is_some_and(|v| !v.is_empty() && v != output.shared.name)
                    {
                        continue;
                    }
                    if let Some(sender) = pending.remove(id) {
                        let lease = Lease::acquire(&output.shared.reply_budget, size)?;
                        let _ = sender.try_send(Ok(Frame {
                            value,
                            _lease: lease,
                        }));
                    }
                }
            }
            Some("request" | "notification" | "progress") => {
                if get(&value, "targetNid")
                    .is_some_and(|v| !v.is_nil() && v.as_u64() != Some(output.shared.nid as u64))
                    || text(&value, "targetName")
                        .is_some_and(|v| !v.is_empty() && v != output.shared.name)
                {
                    if text(&value, "kind") == Some("request") {
                        output.reply(
                            &value,
                            protocol::error("protocol.wrongTarget", "wrong worker identity"),
                            true,
                        )?;
                    }
                    continue;
                }
                // No diagnostic evaluator in this isolated harness.
                if text(&value, "method").is_some_and(|s| s.starts_with("runtime.debug.")) {
                    output.reply(
                        &value,
                        protocol::error(
                            "runtimeDebug.disabled",
                            "native harness diagnostics disabled",
                        ),
                        true,
                    )?;
                    continue;
                }
                let lease = match Lease::acquire(&budget, size) {
                    Ok(lease) => lease,
                    Err(_) if text(&value, "kind") == Some("request") => {
                        output.reply(
                            &value,
                            protocol::error("pipe.overloaded", "application byte budget exhausted"),
                            true,
                        )?;
                        continue;
                    }
                    Err(error) => return Err(error),
                };
                if let Err(error) = requests.try_send(Frame {
                    value,
                    _lease: lease,
                }) {
                    let frame = match error {
                        mpsc::TrySendError::Full(frame)
                        | mpsc::TrySendError::Disconnected(frame) => frame,
                    };
                    if text(&frame.value, "kind") != Some("request") {
                        bail!("notification admission failed");
                    }
                    output.reply(
                        &frame.value,
                        protocol::error("pipe.overloaded", "application queue exhausted"),
                        true,
                    )?;
                }
            }
            _ => output.reply(
                &value,
                protocol::error("protocol.expectedRequest", "unsupported envelope kind"),
                true,
            )?,
        }
    }
}

fn writer_loop(rx: Receiver<Frame<Vec<u8>>>, shared: Arc<Shared>) {
    let mut stdout = io::stdout().lock();
    loop {
        let frame = match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(frame) => frame,
            Err(mpsc::RecvTimeoutError::Timeout)
                if !shared.output_closed.load(Ordering::Acquire) =>
            {
                continue;
            }
            Err(_) => return,
        };
        if let Err(error) = stdout.write_all(&frame.value).and_then(|_| stdout.flush()) {
            shared.fail(&format!("stdout failed: {error}"));
            return;
        }
    }
}

fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        bail!("usage: te2-native-editor-worker <python-import-root> <service-module>");
    }
    let root = std::fs::canonicalize(&args[1]).context("Python import root")?;
    let shared = Arc::new(Shared {
        pending: Mutex::new(HashMap::new()),
        counter: AtomicU64::new(1),
        input_closed: AtomicBool::new(false),
        output_closed: AtomicBool::new(false),
        failed: AtomicBool::new(false),
        finished: AtomicBool::new(false),
        output_budget: Arc::new(AtomicUsize::new(0)),
        reply_budget: Arc::new(AtomicUsize::new(0)),
        nid: std::env::var("TE_PIPE_NID")
            .unwrap_or_else(|_| "2100".into())
            .parse()?,
        name: std::env::var("TE_PIPE_NAME").unwrap_or_else(|_| "service.app".into()),
    });
    let (out_tx, out_rx) = mpsc::sync_channel(CAPACITY);
    let output = Output {
        tx: out_tx,
        shared: shared.clone(),
    };
    // Load service before admitting any input. stdout is protocol-only.
    let (handler, bridge) = Python::attach(|py| -> PyResult<_> {
        let sys = py.import("sys")?;
        sys.setattr("stdout", sys.getattr("stderr")?)?;
        sys.getattr("path")?
            .call_method1("insert", (0, root.to_string_lossy().as_ref()))?;
        let service = py.import(&args[2])?;
        let handler = service.getattr("te2_native_dispatch")?;
        if !handler.is_callable() {
            return Err(PyRuntimeError::new_err(
                "service dispatcher is not callable",
            ));
        }
        Ok((
            handler.unbind(),
            Py::new(
                py,
                NativeBridge {
                    output: output.clone(),
                },
            )?,
        ))
    })
    .map_err(|e| anyhow::anyhow!("Python service initialization failed: {e}"))?;
    let writer_shared = shared.clone();
    let writer = thread::spawn(move || writer_loop(out_rx, writer_shared));
    let (request_tx, request_rx) = mpsc::sync_channel(CAPACITY);
    let reader_output = output.clone();
    let reader_shared = shared.clone();
    let _reader = thread::spawn(move || {
        if let Err(error) = read_loop(reader_output, request_tx, Arc::new(AtomicUsize::new(0))) {
            eprintln!("[native-worker] input failed: {error}");
            reader_shared.fail(&error.to_string());
        } else {
            reader_shared.stop_pending("framework EOF");
        }
        // A blocked Python handler or stdout must not strand process shutdown.
        thread::sleep(Duration::from_secs(3));
        if !reader_shared.finished.load(Ordering::Acquire) {
            eprintln!("[native-worker] shutdown deadline exceeded");
            std::process::exit(2);
        }
    });
    loop {
        if shared.failed.load(Ordering::Acquire) {
            break;
        }
        let frame = match request_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(frame) => frame,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let result = Python::attach(|py| -> PyResult<Value> {
            let envelope = values::to_python(py, &frame.value)?;
            let result = handler.call1(py, (envelope, bridge.bind(py)))?;
            values::from_python(result.bind(py))
        });
        if text(&frame.value, "kind") == Some("request") {
            let send = match result {
                Ok(value) => output.reply(&frame.value, value, false),
                Err(error) => output.reply(
                    &frame.value,
                    protocol::error("protocol.dispatchFailed", &error.to_string()),
                    true,
                ),
            };
            if let Err(error) = send {
                shared.fail(&error.to_string());
                break;
            }
        } else if let Err(error) = result {
            eprintln!("[native-worker] notification handler failed: {error}");
        }
    }
    shared.stop_pending("worker stopping");
    shared.output_closed.store(true, Ordering::Release);
    drop(handler);
    drop(bridge);
    // Force deferred PyO3 decrefs while attached, releasing bridge's output sender.
    Python::attach(|_| {});
    drop(output);
    writer
        .join()
        .map_err(|_| anyhow::anyhow!("writer panicked"))?;
    shared.finished.store(true, Ordering::Release);
    if shared.failed.load(Ordering::Acquire) {
        bail!("native worker transport failed");
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("[native-worker] {error:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leases_bound_bytes_and_release_on_drop() {
        let budget = Arc::new(AtomicUsize::new(0));
        let lease = Lease::acquire(&budget, BYTE_BUDGET).unwrap();
        assert!(Lease::acquire(&budget, 1).is_err());
        assert_eq!(budget.load(Ordering::Acquire), BYTE_BUDGET);
        drop(lease);
        assert_eq!(budget.load(Ordering::Acquire), 0);
        assert!(Lease::acquire(&budget, 1).is_ok());
    }
}
