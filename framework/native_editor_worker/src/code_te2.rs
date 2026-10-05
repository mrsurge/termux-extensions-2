//! Branch-native Code TE2 entrypoint. No Python HTTP/Socket.IO server fallback.
mod decode;
mod fws_observer;
mod persistence;
#[allow(dead_code)] // Shared helpers also compile into the isolated pipe harness.
mod protocol;
mod rpc_codec;
mod shells;
mod terminal_log;
mod values;
mod wba_codec;
mod web;

use anyhow::{Context, Result, bail};
use pyo3::exceptions::PyRuntimeError;
use pyo3::prelude::*;
use rmpv::Value;
use std::{
    ffi::{CStr, CString},
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
    fws: Arc<fws_observer::Observer>,
}

#[pyclass]
struct WbaStream {
    decoder: Mutex<wba_codec::Stream>,
}

#[pymethods]
impl WbaStream {
    fn feed(&self, py: Python<'_>, chunk: Vec<u8>) -> PyResult<Vec<Py<PyAny>>> {
        let records = py
            .detach(|| self.decoder.lock().unwrap().feed(&chunk))
            .map_err(shell_error)?;
        records
            .iter()
            .map(|record| values::to_python(py, record))
            .collect()
    }

    fn finish(&self) -> PyResult<()> {
        self.decoder.lock().unwrap().finish().map_err(shell_error)
    }
}

#[cfg(test)]
mod wba_python_tests {
    use super::*;

    #[test]
    fn native_stream_returns_python_records_across_partial_reads() {
        Python::attach(|py| {
            let stream = Py::new(
                py,
                WbaStream {
                    decoder: Mutex::new(wba_codec::Stream::default()),
                },
            )
            .unwrap();
            let frame =
                wba_codec::encode(&Value::Map(vec![(Value::from("id"), Value::from(7))])).unwrap();
            let first = stream
                .call_method1(py, "feed", (frame[..1].to_vec(),))
                .unwrap();
            assert_eq!(first.bind(py).len().unwrap(), 0);
            let second = stream
                .call_method1(py, "feed", (frame[1..].to_vec(),))
                .unwrap();
            let records = second.bind(py).cast::<pyo3::types::PyList>().unwrap();
            assert_eq!(records.len(), 1);
            let record = records
                .get_item(0)
                .unwrap()
                .cast::<pyo3::types::PyDict>()
                .unwrap()
                .clone();
            assert_eq!(
                record
                    .get_item("id")
                    .unwrap()
                    .unwrap()
                    .extract::<i64>()
                    .unwrap(),
                7
            );
            stream.call_method0(py, "finish").unwrap();
        });
    }
}

#[pymethods]
impl Bridge {
    fn wba_stream(&self) -> WbaStream {
        WbaStream {
            decoder: Mutex::new(wba_codec::Stream::default()),
        }
    }

    fn wba_encode(
        &self,
        py: Python<'_>,
        value: &Bound<'_, PyAny>,
    ) -> PyResult<Py<pyo3::types::PyBytes>> {
        let value = values::from_python(value)?;
        let bytes = py
            .detach(|| wba_codec::encode(&value))
            .map_err(shell_error)?;
        Ok(pyo3::types::PyBytes::new(py, &bytes).unbind())
    }

    fn fws_start(&self, url: String) -> PyResult<()> {
        self.fws.start(url).map_err(shell_error)
    }
    fn fws_read(&self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        let value = py.detach(|| self.fws.read()).map_err(shell_error)?;
        let value = rmpv::ext::to_value(value).map_err(shell_error)?;
        values::to_python(py, &value)
    }
    fn fws_call(
        &self,
        py: Python<'_>,
        epoch: u64,
        request: &Bound<'_, PyAny>,
    ) -> PyResult<Py<PyAny>> {
        let request = rmpv::ext::from_value(values::from_python(request)?).map_err(shell_error)?;
        let response = py
            .detach(|| self.fws.call(epoch, request))
            .map_err(shell_error)?;
        values::to_python(py, &rmpv::ext::to_value(response).map_err(shell_error)?)
    }
    fn fws_reconnect(&self, epoch: u64) -> PyResult<()> {
        self.fws.reconnect(epoch).map_err(shell_error)
    }
    fn fws_stop(&self) {
        self.fws.stop();
    }
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
    fn shell_list(&self, py: Python<'_>) -> PyResult<Py<PyAny>> {
        let records = py.detach(|| self.shells.list()).map_err(shell_error)?;
        values::to_python(
            py,
            &Value::Array(
                records
                    .into_iter()
                    .map(|record| shells::record_value(Some(record)))
                    .collect(),
            ),
        )
    }
    fn shell_spawn(
        &self,
        py: Python<'_>,
        path: PathBuf,
        entry: String,
        ctx: std::collections::HashMap<String, String>,
        label: String,
        spec_id: String,
        wait_ready: bool,
    ) -> PyResult<Py<PyAny>> {
        let record = py
            .detach(|| {
                self.shells
                    .spawn(path, entry, ctx, label, spec_id, wait_ready)
            })
            .map_err(shell_error)?;
        values::to_python(py, &shells::record_value(Some(record)))
    }
    fn shell_live(&self, py: Python<'_>, id: String) -> PyResult<bool> {
        py.detach(|| self.shells.live(&id)).map_err(shell_error)
    }
    fn shell_spawn_terminal(
        &self,
        py: Python<'_>,
        path: PathBuf,
        entry: String,
        ctx: std::collections::HashMap<String, String>,
        label: String,
        subgroups: Vec<String>,
    ) -> PyResult<Py<PyAny>> {
        let record = py
            .detach(|| {
                self.shells.spawn_grouped(
                    path,
                    entry,
                    ctx,
                    label,
                    "terminal".into(),
                    false,
                    Some(subgroups),
                )
            })
            .map_err(shell_error)?;
        values::to_python(py, &shells::record_value(Some(record)))
    }
    fn shell_resize(&self, py: Python<'_>, id: String, cols: u16, rows: u16) -> PyResult<()> {
        py.detach(|| self.shells.resize(&id, cols, rows))
            .map_err(shell_error)
    }
    fn shell_remove(&self, py: Python<'_>, id: String) -> PyResult<bool> {
        py.detach(|| self.shells.remove(&id)).map_err(shell_error)
    }
    fn terminal_log_open(
        &self,
        py: Python<'_>,
        path: PathBuf,
    ) -> PyResult<Option<terminal_log::LogReader>> {
        Ok(py.detach(|| terminal_log::LogReader::open(&path))?)
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

fn initialize_selected_python() -> Result<bool> {
    let isolated = match std::env::var("CODE_TE2_PYTHON_ISOLATED").as_deref() {
        Ok("1") => true,
        Ok(_) => bail!("invalid native Python isolation mode"),
        Err(std::env::VarError::NotPresent) => false,
        Err(error) => bail!("invalid native Python isolation value: {error}"),
    };
    let home = std::env::var("CODE_TE2_PYTHON_HOME").ok();
    let executable = std::env::var("CODE_TE2_PYTHON_EXECUTABLE").ok();
    let (home, executable) = match (home, executable) {
        (None, None) if !isolated => return Ok(false), // Explicit standalone diagnostic mode.
        (Some(home), Some(executable)) if !home.is_empty() && !executable.is_empty() => {
            (CString::new(home)?, CString::new(executable)?)
        }
        _ => bail!("native Python selection requires both home and executable"),
    };
    // Configure only this embedded interpreter, not PYTHONHOME in the process
    // environment inherited by terminal shells and other child applications.
    // This runs before the first Python::attach; PyConfig copies these strings.
    unsafe {
        if pyo3::ffi::Py_IsInitialized() != 0 {
            bail!("Python initialized before native interpreter selection");
        }
        let mut config = std::mem::MaybeUninit::<pyo3::ffi::PyConfig>::uninit();
        pyo3::ffi::PyConfig_InitPythonConfig(config.as_mut_ptr());
        let mut config = config.assume_init();
        config.parse_argv = 0;
        if isolated {
            config.isolated = 1;
            config.use_environment = 0;
            config.user_site_directory = 0;
            config.site_import = 0;
            config.safe_path = 1;
            config.write_bytecode = 0;
            config.module_search_paths_set = 1;
        }
        let mut status =
            pyo3::ffi::PyConfig_SetBytesString(&mut config, &mut config.home, home.as_ptr());
        if pyo3::ffi::PyStatus_Exception(status) == 0 {
            status = pyo3::ffi::PyConfig_SetBytesString(
                &mut config,
                &mut config.program_name,
                executable.as_ptr(),
            );
        }
        if isolated && pyo3::ffi::PyStatus_Exception(status) == 0 {
            let base = PathBuf::from(home.to_str()?);
            // Pip may populate adjacent caches using the host Python. Never
            // read those; this reserved prefix is absent from the verified
            // payload and writes are disabled above.
            let cache = CString::new(
                base.join(".disabled-bytecode-cache")
                    .to_string_lossy()
                    .as_bytes(),
            )?;
            status = pyo3::ffi::PyConfig_SetBytesString(
                &mut config,
                &mut config.pycache_prefix,
                cache.as_ptr(),
            );
            for relative in [
                "lib/python3.14",
                "lib/python3.14/lib-dynload",
                "lib/python3.14/site-packages",
            ] {
                if pyo3::ffi::PyStatus_Exception(status) != 0 {
                    break;
                }
                let path = CString::new(base.join(relative).to_string_lossy().as_bytes())?;
                let wide = pyo3::ffi::Py_DecodeLocale(path.as_ptr(), std::ptr::null_mut());
                if wide.is_null() {
                    pyo3::ffi::PyConfig_Clear(&mut config);
                    bail!("cannot decode private Python search path");
                }
                status = pyo3::ffi::PyWideStringList_Append(&mut config.module_search_paths, wide);
                pyo3::ffi::PyMem_RawFree(wide.cast());
                if pyo3::ffi::PyStatus_Exception(status) != 0 {
                    break;
                }
            }
        }
        if pyo3::ffi::PyStatus_Exception(status) == 0 {
            status = pyo3::ffi::Py_InitializeFromConfig(&config);
        }
        let error = if pyo3::ffi::PyStatus_Exception(status) != 0 {
            Some(if status.err_msg.is_null() {
                "unknown Python initialization failure".to_owned()
            } else {
                CStr::from_ptr(status.err_msg)
                    .to_string_lossy()
                    .into_owned()
            })
        } else {
            None
        };
        pyo3::ffi::PyConfig_Clear(&mut config);
        if let Some(error) = error {
            bail!("native interpreter selection: {error}");
        }
        // PyO3's attach expects an initialized interpreter with its initial GIL
        // released. Python::initialize performs this same handoff.
        pyo3::ffi::PyEval_SaveThread();
    }
    Ok(true)
}

fn initialize(root: &std::path::Path) -> Result<Arc<Py<PyAny>>> {
    let isolated = std::env::var("CODE_TE2_PYTHON_ISOLATED").as_deref() == Ok("1");
    let private_root = if isolated {
        Some(std::fs::canonicalize(
            std::env::var("CODE_TE2_PYTHON_SOURCE")
                .context("private Python requires its packaged source root")?,
        )?)
    } else {
        None
    };
    let import_root = private_root.as_deref().unwrap_or(root);
    let selected = initialize_selected_python()?;
    Python::attach(|py| -> PyResult<_> {
        let sys = py.import("sys")?;
        if isolated {
            let version = sys.getattr("version_info")?;
            let major: u8 = version.get_item(0)?.extract()?;
            let minor: u8 = version.get_item(1)?.extract()?;
            if (major, minor) != (3, 14) {
                return Err(pyo3::exceptions::PyRuntimeError::new_err(
                    "private Code TE2 Python must be ordinary 3.14",
                ));
            }
        }
        sys.setattr("stdout", sys.getattr("stderr")?)?;
        let path = sys.getattr("path")?;
        // Bootstrap-selected PyConfig already resolves the venv. Retain the
        // inherited matching-version site path only for standalone diagnostics.
        if let Some(prefix) = (!selected)
            .then(|| std::env::var("VIRTUAL_ENV").ok())
            .flatten()
        {
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
        path.call_method1("insert", (0, import_root.to_string_lossy().as_ref()))?;
        if let Ok(output) = std::env::var("CODE_TE2_MYPYC_DIR") {
            if !output.is_empty() {
                let count: usize = py
                    .import("app.apps.code_te2.mypyc_overlay")?
                    .call_method1(
                        "install",
                        (import_root.to_string_lossy().as_ref(), output.as_str()),
                    )?
                    .extract()?;
                eprintln!("[code-te2-worker] mypyc overlay enabled: {count} modules from {output}");
            }
        }
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
    let fws = Arc::new(fws_observer::Observer::default());
    let start_fws = fws.clone();
    let info = tokio::task::spawn_blocking(move || {
        Python::attach(|py| -> PyResult<Value> {
            let bridge = Py::new(
                py,
                Bridge {
                    fws: start_fws,
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
    fws.stop();
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
