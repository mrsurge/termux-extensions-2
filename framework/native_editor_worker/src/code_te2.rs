//! Branch-native Code TE2 entrypoint. No Python HTTP/Socket.IO server fallback.
mod decode;
mod persistence;
#[allow(dead_code)] // Shared helpers also compile into the isolated pipe harness.
mod protocol;
mod rpc_codec;
mod shells;
mod values;
mod web;

use anyhow::{Context, Result, bail};
use pyo3::exceptions::PyRuntimeError;
use pyo3::prelude::*;
use rmpv::Value;
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc,
    },
    time::Duration,
};
use tokio::sync::{Notify, Semaphore};

struct State {
    closed: AtomicBool,
    failed: AtomicBool,
    wake: Notify,
    output: Mutex<Option<mpsc::SyncSender<OutputFrame>>>,
    output_bytes: Arc<AtomicUsize>,
}
struct OutputFrame {
    bytes: Vec<u8>,
    budget: Arc<AtomicUsize>,
}
impl Drop for OutputFrame {
    fn drop(&mut self) {
        self.budget.fetch_sub(self.bytes.len(), Ordering::AcqRel);
    }
}
struct LimitedBuffer(Vec<u8>);
impl Write for LimitedBuffer {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        if data.len() > protocol::FRAME_LIMIT.saturating_sub(self.0.len()) {
            return Err(std::io::Error::other("pipe frame too large"));
        }
        self.0.extend_from_slice(data);
        Ok(data.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl State {
    fn fail(&self) {
        self.failed.store(true, Ordering::Release);
        self.close();
    }
    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.wake.notify_waiters();
    }
    fn write(&self, value: &Value) -> Result<()> {
        if self.closed.load(Ordering::Acquire) {
            bail!("framework pipe closed");
        }
        let mut bytes = LimitedBuffer(Vec::new());
        rmpv::encode::write_value(&mut bytes, value)?;
        let tx = self
            .output
            .lock()
            .unwrap()
            .clone()
            .context("writer closed")?;
        let bytes = bytes.0;
        self.output_bytes
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                used.checked_add(bytes.len())
                    .filter(|v| *v <= protocol::BYTE_BUDGET)
            })
            .map_err(|_| anyhow::anyhow!("native pipe byte budget exceeded"))?;
        tx.try_send(OutputFrame {
            bytes,
            budget: self.output_bytes.clone(),
        })
        .map_err(|_| anyhow::anyhow!("native pipe writer overloaded/closed"))
    }
}

#[pyclass]
struct Bridge {
    state: Arc<State>,
    sockets: Arc<web::Sockets>,
    shells: Arc<shells::Shells>,
}
#[pymethods]
impl Bridge {
    fn shell_get(&self, py: Python<'_>, id: String) -> PyResult<Py<PyAny>> {
        let record = py.detach(|| self.shells.get(&id)).map_err(shell_error)?;
        values::to_python(py, &shells::record_value(record))
    }
    fn shell_find(&self, py: Python<'_>, label: String) -> PyResult<Py<PyAny>> {
        let record = py
            .detach(|| self.shells.find(&label))
            .map_err(shell_error)?;
        values::to_python(py, &shells::record_value(record))
    }
    fn shell_spawn(
        &self,
        py: Python<'_>,
        path: PathBuf,
        entry: String,
        ctx: std::collections::HashMap<String, String>,
        label: String,
        spec_id: String,
    ) -> PyResult<Py<PyAny>> {
        let record = py
            .detach(|| self.shells.spawn(path, entry, ctx, label, spec_id))
            .map_err(shell_error)?;
        values::to_python(py, &shells::record_value(Some(record)))
    }
    fn shell_live(&self, py: Python<'_>, id: String) -> PyResult<bool> {
        py.detach(|| self.shells.live(&id)).map_err(shell_error)
    }
    fn shell_terminate(&self, py: Python<'_>, id: String) -> PyResult<()> {
        py.detach(|| self.shells.terminate(&id))
            .map_err(shell_error)
    }
    fn shell_write(&self, py: Python<'_>, id: String, data: Vec<u8>) -> PyResult<()> {
        py.detach(|| self.shells.write(&id, &data))
            .map_err(shell_error)
    }
    fn shell_subscribe(&self, py: Python<'_>, id: String) -> PyResult<u64> {
        py.detach(|| self.shells.subscribe(id)).map_err(shell_error)
    }
    fn shell_unsubscribe(&self, py: Python<'_>, token: u64) {
        py.detach(|| self.shells.unsubscribe(token));
    }
    fn shell_release(&self, py: Python<'_>, token: u64) -> PyResult<()> {
        py.detach(|| self.shells.release(token))
            .map_err(shell_error)
    }
    fn shell_read(&self, py: Python<'_>, token: u64) -> PyResult<Py<pyo3::types::PyBytes>> {
        let bytes = py.detach(|| self.shells.read(token)).map_err(shell_error)?;
        Ok(pyo3::types::PyBytes::new(py, &bytes).unbind())
    }
    fn persistence_read(
        &self,
        py: Python<'_>,
        path: PathBuf,
    ) -> PyResult<Py<pyo3::types::PyBytes>> {
        let bytes = py
            .detach(|| std::fs::read(&path))
            .map_err(|e| persistence::python_error(e, &path))?;
        Ok(pyo3::types::PyBytes::new(py, &bytes).unbind())
    }
    fn persistence_write(
        &self,
        py: Python<'_>,
        path: PathBuf,
        payload: Vec<u8>,
        temporary_path: Option<PathBuf>,
        temporary_prefix: Option<String>,
        temporary_suffix: String,
    ) -> PyResult<()> {
        py.detach(|| {
            persistence::write_atomic(
                &path,
                &payload,
                temporary_path.as_deref(),
                temporary_prefix.as_deref(),
                &temporary_suffix,
            )
        })
        .map_err(|e| persistence::python_error(e, &path))
    }
    fn pipe_send(&self, py: Python<'_>, value: &Bound<'_, PyAny>) -> PyResult<()> {
        let value = values::from_python(value)?;
        py.detach(|| self.state.write(&value)).map_err(|e| {
            self.state.fail();
            PyRuntimeError::new_err(e.to_string())
        })
    }
    fn socket_op(&self, py: Python<'_>, value: &Bound<'_, PyAny>) -> PyResult<()> {
        let value = values::from_python(value)?;
        py.detach(|| self.sockets.operation(&value))
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }
}

fn shell_error(error: impl std::fmt::Display) -> PyErr {
    PyRuntimeError::new_err(error.to_string())
}

#[derive(Clone)]
struct Backend {
    module: Arc<Py<PyAny>>,
    admission: Arc<Semaphore>,
    control: Arc<Semaphore>,
}
impl Backend {
    async fn call(&self, value: Value, control: bool) -> Result<Value> {
        let permit = if control {
            self.control.clone()
        } else {
            self.admission.clone()
        }
        .try_acquire_owned()
        .map_err(|_| anyhow::anyhow!("native domain admission full"))?;
        let module = self.module.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            Python::attach(|py| -> PyResult<Value> {
                let future =
                    module.call_method1(py, "submit", (values::to_python(py, &value)?,))?;
                let result = future.call_method1(py, "result", (120.0,));
                if result.is_err() {
                    let _ = future.call_method0(py, "cancel");
                }
                values::from_python(result?.bind(py))
            })
            .map_err(|e| anyhow::anyhow!(e.to_string()))
        })
        .await?
    }
}

fn initialize(root: &std::path::Path) -> Result<Arc<Py<PyAny>>> {
    Python::attach(|py| -> PyResult<_> {
        let sys = py.import("sys")?;
        sys.setattr("stdout", sys.getattr("stderr")?)?;
        let path = sys.getattr("path")?;
        // Embedding does not automatically activate an inherited venv. Select
        // only its matching-version site-packages, never another Python ABI.
        if let Ok(prefix) = std::env::var("VIRTUAL_ENV") {
            let version = sys.getattr("version_info")?;
            let major: u8 = version.get_item(0)?.extract()?;
            let minor: u8 = version.get_item(1)?.extract()?;
            let prefix = PathBuf::from(prefix);
            let site = prefix.join(format!("lib/python{major}.{minor}/site-packages"));
            if site.is_dir() {
                py.import("site")?
                    .call_method1("addsitedir", (site.to_string_lossy().as_ref(),))?;
                sys.setattr("prefix", prefix.to_string_lossy().as_ref())?;
                sys.setattr("exec_prefix", prefix.to_string_lossy().as_ref())?;
                sys.setattr(
                    "executable",
                    prefix.join("bin/python").to_string_lossy().as_ref(),
                )?;
            }
        }
        path.call_method1("insert", (0, root.to_string_lossy().as_ref()))?;
        Ok(Arc::new(
            py.import("app.apps.code_te2.native_worker")?
                .into_any()
                .unbind(),
        ))
    })
    .map_err(|e| anyhow::anyhow!("native Python import: {e}"))
}

fn pipe_reader(module: Arc<Py<PyAny>>, state: Arc<State>) {
    let mut reader = BufReader::new(std::io::stdin());
    let result = (|| -> Result<()> {
        loop {
            if reader.fill_buf()?.is_empty() {
                return Ok(());
            }
            let (value, _) = decode::read_frame(&mut reader)?;
            Python::attach(|py| -> PyResult<()> {
                module.call_method1(py, "control", (values::to_python(py, &value)?,))?;
                Ok(())
            })
            .map_err(|e| anyhow::anyhow!("framework control: {e}"))?;
        }
    })();
    if let Err(error) = result {
        eprintln!("[code-te2-worker] pipe stopped: {error:#}");
        state.fail();
    }
    state.close();
}

async fn run(root: PathBuf, port: u16) -> Result<()> {
    let (tx, rx) = mpsc::sync_channel::<OutputFrame>(protocol::CAPACITY);
    let state = Arc::new(State {
        closed: AtomicBool::new(false),
        failed: AtomicBool::new(false),
        wake: Notify::new(),
        output: Mutex::new(Some(tx)),
        output_bytes: Arc::new(AtomicUsize::new(0)),
    });
    let writer_state = state.clone();
    std::thread::spawn(move || {
        let mut output = std::io::stdout().lock();
        while let Ok(frame) = rx.recv() {
            if output
                .write_all(&frame.bytes)
                .and_then(|_| output.flush())
                .is_err()
            {
                writer_state.fail();
                break;
            }
        }
    });
    let sockets = Arc::new(web::Sockets::default());
    let module = initialize(&root)?;
    let backend = Backend {
        module: module.clone(),
        admission: Arc::new(Semaphore::new(64)),
        control: Arc::new(Semaphore::new(16)),
    };
    let reader_module = module.clone();
    let reader_state = state.clone();
    // Start stdout response delivery before Python startup can request services.
    std::thread::spawn(move || pipe_reader(reader_module, reader_state));
    let start_state = state.clone();
    let start_sockets = sockets.clone();
    let start_module = module.clone();
    let shells = Arc::new(shells::Shells::default());
    let _shell_lifetime = shells::Lifetime(shells.clone());
    let start_shells = shells.clone();
    let info = tokio::task::spawn_blocking(move || {
        Python::attach(|py| -> PyResult<Value> {
            let bridge = Py::new(
                py,
                Bridge {
                    shells: start_shells,
                    state: start_state,
                    sockets: start_sockets,
                },
            )?;
            values::from_python(start_module.call_method1(py, "start", (bridge,))?.bind(py))
        })
    })
    .await??;
    if state.closed.load(Ordering::Acquire) {
        bail!("framework pipe closed during startup");
    }
    let icon_dir = protocol::text(&info, "agentIconDir").context("missing icon directory")?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    state.write(&protocol::serving_ready())?;
    eprintln!("[code-te2-worker] native HTTP ready 127.0.0.1:{port}");
    let serving = web::serve(
        listener,
        backend,
        sockets,
        root,
        PathBuf::from(icon_dir),
        state.clone(),
    );
    let serve_result = serving.await;
    state.close();
    let stopping = tokio::task::spawn_blocking(move || {
        Python::attach(|py| {
            module
                .call_method1(py, "stop", ("native worker stopping",))
                .map(|_| ())
        })
    });
    let _ = tokio::time::timeout(Duration::from_secs(6), stopping).await;
    shells.stop();
    state.output.lock().unwrap().take();
    if state.failed.load(Ordering::Acquire) {
        bail!("native framework pipe failed");
    }
    serve_result
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let result = (|| -> Result<()> {
        if args.len() != 3 {
            bail!("usage: code-te2-worker <repo-or-package-root> <port>");
        }
        let root = std::fs::canonicalize(&args[1])?;
        let port = args[2].parse::<u16>()?;
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .max_blocking_threads(80)
            .build()?;
        let result = runtime.block_on(run(root, port));
        runtime.shutdown_timeout(Duration::from_secs(2));
        result
    })();
    if let Err(error) = result {
        eprintln!("[code-te2-worker] {error:#}");
        std::process::exit(1);
    }
}
