//! Isolated conversion benchmark: no sockets, production hooks or activation.
#[allow(dead_code)]
#[path = "../src/decode.rs"]
mod decode;
#[allow(dead_code)]
#[path = "../src/protocol.rs"]
mod protocol;
#[path = "../src/values.rs"]
mod values;

use anyhow::{Result, bail};
use pyo3::{prelude::*, types::PyBytes};
use rmpv::Value;
use std::{ffi::CString, hint::black_box, io::Write, path::PathBuf, time::Instant};

struct Limited(Vec<u8>);
impl Write for Limited {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > protocol::FRAME_LIMIT.saturating_sub(self.0.len()) {
            return Err(std::io::Error::other("frame byte limit exceeded"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn checked_decode(wire: &[u8]) -> Result<Value> {
    let (value, consumed) = decode::read_frame(&mut std::io::Cursor::new(wire))?;
    if consumed != wire.len() {
        bail!("trailing frame");
    }
    Ok(value)
}

fn incoming(
    py: Python<'_>,
    helpers: &Bound<'_, PyModule>,
    wire: &[u8],
    buffer: bool,
) -> Result<Py<PyAny>> {
    // Both candidates retain the existing byte/depth/node/key/marker guards.
    Ok(if buffer {
        let mut reader = std::io::BufReader::new(std::io::Cursor::new(wire));
        let captured = decode::read_frame_bytes(&mut reader)?;
        if captured.len() != wire.len() {
            bail!("trailing frame");
        }
        helpers
            .call_method1("from_bytes", (PyBytes::new(py, &captured),))?
            .unbind()
    } else {
        let (decoded, size) =
            decode::read_frame(&mut std::io::BufReader::new(std::io::Cursor::new(wire)))?;
        if size != wire.len() {
            bail!("trailing frame");
        }
        helpers
            .call_method1("from_graph", (values::to_python(py, &decoded)?,))?
            .unbind()
    })
}

fn outgoing(
    helpers: &Bound<'_, PyModule>,
    envelope: &Bound<'_, PyAny>,
    buffer: bool,
) -> Result<Vec<u8>> {
    if buffer {
        let encoded = helpers.call_method1("to_bytes", (envelope,))?;
        let wire = encoded.cast::<PyBytes>().map_err(PyErr::from)?.as_bytes();
        let value = checked_decode(wire)?;
        protocol::validate(&value)?;
        // Include the owned PyBytes -> Rust Vec copy, not a zero-copy claim.
        Ok(wire.to_vec())
    } else {
        let graph = helpers.call_method1("to_graph", (envelope,))?;
        let value = values::from_python(&graph)?;
        protocol::validate(&value)?;
        let mut bytes = Limited(Vec::new());
        rmpv::encode::write_value(&mut bytes, &value)?;
        Ok(bytes.0)
    }
}

fn exercise(
    py: Python<'_>,
    helpers: &Bound<'_, PyModule>,
    envelope: &Bound<'_, PyAny>,
    wire: &[u8],
    mode: usize,
) -> Result<()> {
    if mode < 2 {
        black_box(incoming(py, helpers, wire, mode == 1)?);
    } else {
        black_box(outgoing(helpers, envelope, mode == 3)?);
    }
    Ok(())
}

fn run(py: Python<'_>, helpers: &Bound<'_, PyModule>, samples: usize, scale: usize) -> Result<()> {
    for (name, iterations) in [
        ("control", 200),
        ("nested_256", 10),
        ("unicode_binary_256k", 10),
        ("wide_1024", 5),
        ("search_512", 5),
        ("git_512", 5),
        ("error", 100),
    ] {
        let iterations = iterations * scale;
        let envelope = helpers.call_method1("fixture", (name,))?;
        let wire = outgoing(helpers, &envelope, false)?;
        let alternate = outgoing(helpers, &envelope, true)?;
        if checked_decode(&wire)? != checked_decode(&alternate)? {
            bail!("outbound parity: {name}");
        }
        let left = incoming(py, helpers, &wire, false)?;
        let right = incoming(py, helpers, &wire, true)?;
        if !left.bind(py).eq(right.bind(py))? {
            bail!("inbound parity: {name}");
        }
        for mode in 0..4 {
            for _ in 0..3 {
                exercise(py, helpers, &envelope, &wire, mode)?;
            }
        }
        let mut timings: [Vec<f64>; 4] = std::array::from_fn(|_| Vec::new());
        for sample in 0..samples {
            // Rotate mode order to reduce fixed warmup/order bias.
            for offset in 0..4 {
                let mode = (sample + offset) % 4;
                let start = Instant::now();
                for _ in 0..iterations {
                    exercise(py, helpers, &envelope, &wire, mode)?;
                }
                timings[mode].push(start.elapsed().as_nanos() as f64 / iterations as f64);
            }
        }
        let labels = [
            "incoming_graph",
            "incoming_buffer",
            "outgoing_graph",
            "outgoing_buffer",
        ];
        let mut measurements = serde_json::Map::new();
        for (label, mut values) in labels.into_iter().zip(timings) {
            values.sort_by(f64::total_cmp);
            measurements.insert(label.to_owned(), serde_json::json!({
                "median_batch_mean_ns": values[values.len()/2],
                "p95_batch_mean_ns": values[((values.len()*95).div_ceil(100)-1).min(values.len()-1)]
            }));
        }
        println!(
            "{}",
            serde_json::json!({"kind":"timing", "fixture":name,
            "wire_bytes":wire.len(), "samples":samples, "iterations_per_batch":iterations,
            "parity":"pass", "measurements":measurements})
        );
    }
    // Acceptance mismatches are reported, not hidden behind favorable timings.
    for name in ["unsupported_set", "unsupported_datetime"] {
        let envelope = helpers.call_method1("fixture", (name,))?;
        let graph = outgoing(helpers, &envelope, false);
        let buffer = outgoing(helpers, &envelope, true);
        if graph.is_ok() || buffer.is_ok() != (name == "unsupported_set") {
            bail!("unexpected acceptance result for {name}");
        }
        println!(
            "{}",
            serde_json::json!({"kind":"acceptance", "fixture":name,
            "graph_accepts":graph.is_ok(), "buffer_accepts":buffer.is_ok(),
            "same_acceptance":graph.is_ok()==buffer.is_ok(),
            "graph_error":graph.err().map(|e| e.to_string()),
            "buffer_error":buffer.err().map(|e| e.to_string())})
        );
    }
    // Malformed/truncated/key/marker/depth guards must reject on both paths.
    let mut too_deep = vec![0x91; 66];
    too_deep.push(0xc0);
    let invalid = [
        vec![0xc1],
        vec![0x81],
        vec![0xd4, 0, 0],
        vec![0x81, 1, 0],
        vec![0x82, 0xa1, b'x', 0, 0xa1, b'x', 1],
        vec![0xc6, 0xff, 0xff, 0xff, 0xff],
        too_deep,
        vec![0x81, 0xa4, b'k', b'i', b'n', b'd', 1],
        vec![0xc0, 0xc0],
        vec![0xa1, 0xff],
    ];
    for wire in &invalid {
        if incoming(py, helpers, wire, false).is_ok() || incoming(py, helpers, wire, true).is_ok() {
            bail!("invalid input accepted: {wire:?}");
        }
    }
    println!(
        "{}",
        serde_json::json!({"kind":"rejections", "cases":invalid.len(), "parity":"pass"})
    );
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let samples = args.first().map(|v| v.parse()).transpose()?.unwrap_or(11);
    let scale = args.get(1).map(|v| v.parse()).transpose()?.unwrap_or(1);
    if !(3..=101).contains(&samples) || !(1..=100).contains(&scale) || args.len() > 2 {
        bail!("usage: boundary_probe [samples:3..101] [iteration-scale:1..100]");
    }
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let scratch = std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo.join(".codex-scratch"));
    let isolated = tempfile::Builder::new()
        .prefix("boundary-probe-")
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
        let snapshot = std::env::var("BOUNDARY_PROBE_MYPYC_DIR").ok();
        if let Some(ref snapshot) = snapshot {
            py.import("app.apps.code_te2.mypyc_overlay")?.call_method1(
                "install",
                (repo.to_string_lossy().as_ref(), snapshot.as_str()),
            )?;
        }
        let source = CString::new(include_str!("boundary_probe.py"))?;
        let helpers = PyModule::from_code(py, &source, c"boundary_probe.py", c"boundary_probe")?;
        let versions = helpers.call_method0("versions")?;
        println!(
            "{}",
            serde_json::json!({"kind":"scope", "profile":if cfg!(debug_assertions) {"debug"} else {"release"},
            "runtime":versions.str()?.to_str()?, "snapshot":snapshot, "scope":"single attached interpreter; conversions/validation/copies; no IPC, queue waits, handlers or network",
            "candidate":"buffer path retains native validation, captures original bytes and uses production typed decoder; source-wired, not activated"})
        );
        run(py, &helpers, samples, scale)
    })
}
