//! Real WBA PyO3 stream comparison, isolated from production workers.
#[allow(dead_code)]
#[path = "../src/decode.rs"]
mod decode;
#[allow(dead_code)]
#[path = "../src/protocol.rs"]
mod protocol;
#[allow(dead_code)]
#[path = "../src/values.rs"]
mod values;
#[allow(dead_code)]
#[path = "../src/wba_codec.rs"]
mod wba_codec;
#[path = "../src/wba_stream.rs"]
mod wba_stream;

use anyhow::{Result, bail};
use pyo3::{prelude::*, types::PyBytes};
use std::{ffi::CString, hint::black_box, path::PathBuf, time::Instant};

#[pyfunction]
fn new_native(py: Python<'_>) -> PyResult<Py<wba_stream::WbaStream>> {
    Py::new(py, wba_stream::WbaStream::new())
}

fn run(py: Python<'_>, helpers: &Bound<'_, PyModule>, samples: usize) -> Result<()> {
    println!(
        "{}",
        helpers
            .call_method1("check", (wrap_pyfunction!(new_native, py)?,))?
            .str()?
    );
    for (name, iterations) in [
        ("ready", 300),
        ("diagnostics_256", 10),
        ("reply_512", 5),
        ("binary_256k", 10),
    ] {
        let wire = helpers.call_method1("fixture", (name,))?;
        let wire = wire.cast::<PyBytes>().map_err(PyErr::from)?.as_bytes();
        let baseline = new_native(py)?;
        let native = new_native(py)?;
        let wrapped = helpers.call_method1("wrap", (native,))?;
        let modes = [baseline.bind(py).as_any(), &wrapped];
        let exercise = |mode: usize| -> Result<()> {
            // Real FWS reader chunks are bounded, not one giant artificial call.
            for chunk in wire.chunks(65_536) {
                black_box(modes[mode].call_method1("feed", (PyBytes::new(py, chunk),))?);
            }
            Ok(())
        };
        for mode in 0..2 {
            for _ in 0..3 {
                exercise(mode)?;
            }
        }
        let mut timings: [Vec<f64>; 2] = std::array::from_fn(|_| Vec::new());
        for sample in 0..samples {
            for offset in 0..2 {
                let mode = (sample + offset) % 2;
                let start = Instant::now();
                for _ in 0..iterations {
                    exercise(mode)?;
                }
                timings[mode].push(start.elapsed().as_nanos() as f64 / iterations as f64);
            }
        }
        for mode in modes {
            mode.call_method0("finish")?;
        }
        let mut measures = serde_json::Map::new();
        for (label, mut samples) in ["graph", "bytes"].into_iter().zip(timings) {
            samples.sort_by(f64::total_cmp);
            measures.insert(label.into(), serde_json::json!({
                "median_batch_mean_ns": samples[samples.len()/2],
                "p95_batch_mean_ns": samples[((samples.len()*95).div_ceil(100)-1).min(samples.len()-1)]}));
        }
        println!(
            "{}",
            serde_json::json!({"fixture":name,"wire_bytes":wire.len(),"samples":samples,
            "iterations_per_batch":iterations,"measurements":measures})
        );
    }
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let samples = args.first().map(|v| v.parse()).transpose()?.unwrap_or(11);
    if args.len() > 1 || !(3..=101).contains(&samples) {
        bail!("usage: wba_boundary_probe [samples:3..101]");
    }
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let scratch = std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo.join(".codex-scratch"));
    let root = tempfile::Builder::new()
        .prefix("wba-boundary-")
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
        let source = CString::new(include_str!("wba_boundary_probe.py"))?;
        let helpers =
            PyModule::from_code(py, &source, c"wba_boundary_probe.py", c"wba_boundary_probe")?;
        println!(
            "{}",
            serde_json::json!({"scope":"single attached interpreter; actual stream/guards/copies/msgspec; no network, queue waits or full runtime",
            "python":sys.getattr("version")?.str()?.to_str()?,"msgspec":py.import("msgspec")?.getattr("__version__")?.str()?.to_str()?,
            "profile":if cfg!(debug_assertions){"debug"}else{"release"}})
        );
        run(py, &helpers, samples)
    })
}
