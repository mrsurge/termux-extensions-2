//! Exercise the actual native ingress and Python router without starting a worker.
#[allow(dead_code)]
#[path = "../src/decode.rs"]
mod decode;
#[path = "../src/inbound.rs"]
mod inbound;
#[allow(dead_code)]
#[path = "../src/protocol.rs"]
mod protocol;

use anyhow::Result;
use pyo3::{exceptions::PyValueError, prelude::*};
use std::{ffi::CString, io::Cursor, path::PathBuf};

#[pyfunction]
fn deliver(module: Py<PyAny>, bytes: Vec<u8>) -> PyResult<()> {
    Python::attach(|py| inbound::check_domain(module.bind(py)))?;
    let mut reader = Cursor::new(bytes);
    while reader.position() < reader.get_ref().len() as u64 {
        inbound::read_and_deliver(&mut reader, &module)
            .map_err(|error| PyValueError::new_err(error.to_string()))?;
    }
    Ok(())
}

fn main() -> Result<()> {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let scratch = std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo.join(".codex-scratch"));
    let isolated = tempfile::Builder::new()
        .prefix("inbound-dispatch-")
        .tempdir_in(scratch)?;
    Python::attach(|py| -> Result<()> {
        let sys = py.import("sys")?;
        sys.setattr("stdout", sys.getattr("stderr")?)?;
        let path = sys.getattr("path")?;
        path.call_method1("insert", (0, repo.to_string_lossy().as_ref()))?;
        path.call_method1(
            "insert",
            (0, repo.join("scripts").to_string_lossy().as_ref()),
        )?;
        let root = py
            .import("pathlib")?
            .getattr("Path")?
            .call1((isolated.path().to_string_lossy().as_ref(),))?;
        py.import("probe_code_te2_mypyc")?
            .call_method1("_isolate", (root,))?;
        if let Ok(snapshot) = std::env::var("BOUNDARY_PROBE_MYPYC_DIR") {
            py.import("app.apps.code_te2.mypyc_overlay")?
                .call_method1("install", (repo.to_string_lossy().as_ref(), snapshot))?;
        }
        let source = CString::new(include_str!("inbound_dispatch_probe.py"))?;
        let helpers = PyModule::from_code(
            py,
            &source,
            c"inbound_dispatch_probe.py",
            c"inbound_dispatch_probe",
        )?;
        let result = helpers.call_method1("run", (wrap_pyfunction!(deliver, py)?,))?;
        println!("{}", result.str()?);
        Ok(())
    })
}
