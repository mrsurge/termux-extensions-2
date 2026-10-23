//! Production codec + PyO3 submit + real Python Future/namespace adapter.
#[allow(dead_code)]
#[path = "../src/decode.rs"]
mod decode;
#[allow(dead_code)]
#[path = "../src/protocol.rs"]
mod protocol;
#[allow(dead_code)]
#[path = "../src/rpc_codec.rs"]
mod rpc_codec;
#[path = "../src/rpc_ingress.rs"]
mod rpc_ingress;
#[allow(dead_code)]
#[path = "../src/values.rs"]
mod values;

use anyhow::Result;
use pyo3::{prelude::*, types::PyBytes};
use std::{ffi::CString, path::PathBuf};

fn main() -> Result<()> {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let scratch = std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo.join(".codex-scratch"));
    let root = tempfile::Builder::new()
        .prefix("network-rpc-probe-")
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
        let isolated = py
            .import("pathlib")?
            .getattr("Path")?
            .call1((root.path().to_string_lossy().as_ref(),))?;
        py.import("probe_code_te2_mypyc")?
            .call_method1("_isolate", (isolated,))?;
        if let Ok(snapshot) = std::env::var("BOUNDARY_PROBE_MYPYC_DIR") {
            py.import("app.apps.code_te2.mypyc_overlay")?
                .call_method1("install", (repo.to_string_lossy().as_ref(), snapshot))?;
        }
        let helpers = PyModule::from_code(
            py,
            &CString::new(include_str!("network_rpc_boundary_probe.py"))?,
            c"network_rpc_boundary_probe.py",
            c"network_rpc_boundary_probe",
        )?;
        eprintln!("{}", helpers.call_method0("start")?.str()?);
        let result = (|| -> Result<()> {
            helpers.call_method0("check_python")?;
            let domain = py
                .import("app.apps.code_te2.native_worker")?
                .into_any()
                .unbind();
            rpc_ingress::check_domain(domain.bind(py))?;
            let mut cases = 0;
            for (namespace, lane) in [
                ("/rpc/editor", "editor"),
                ("/rpc/explorer", "explorer"),
                ("/ui_ipc", "ui_ipc"),
            ] {
                for index in 0..6 {
                    let raw = helpers.call_method1("fixture", (index,))?;
                    let raw = raw.cast::<PyBytes>().map_err(PyErr::from)?.as_bytes();
                    for framed in [false, true]
                        .into_iter()
                        .filter(|framed| !framed || lane == "editor")
                    {
                        let payload = if framed {
                            rpc_codec::frame(raw, false)?
                        } else {
                            raw.to_vec()
                        };
                        let legacy = rpc_codec::decode_for(
                            rmpv::Value::Binary(payload.clone()),
                            lane,
                            framed,
                        )
                        .map_err(anyhow::Error::msg)?;
                        let expected = helpers
                            .call_method1("graph", (namespace, values::to_python(py, &legacy)?))?
                            .call_method1("result", (2.0,))?;
                        let frame =
                            rpc_codec::validate_for(rmpv::Value::Binary(payload), lane, framed)
                                .map_err(anyhow::Error::msg)?;
                        let actual = rpc_ingress::submit(
                            py,
                            &domain,
                            namespace,
                            "owned-sid",
                            "rpc",
                            &frame,
                        )?
                        .call_method1(py, "result", (2.0,))?;
                        anyhow::ensure!(expected.eq(actual.bind(py))?, "RPC dispatch mismatch");
                        cases += 1;
                    }
                }
            }
            println!(
                "{}",
                serde_json::json!({"parity_cases":cases,"scope":"production codec/PyO3/domain Future/namespace adapter; no real sockets, production queues or speedup claim"})
            );
            Ok(())
        })();
        let stopped = helpers.call_method0("stop");
        result?;
        stopped?;
        Ok(())
    })
}
