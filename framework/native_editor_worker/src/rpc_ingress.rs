//! Transfer a validated RPC body without constructing a Python value graph.
use crate::rpc_codec::ValidatedRpc;
use pyo3::{prelude::*, types::PyBytes};

pub fn check_domain(module: &Bound<'_, PyAny>) -> PyResult<()> {
    if !module
        .getattr("submit_rpc")
        .is_ok_and(|handler| handler.is_callable())
    {
        return Err(pyo3::exceptions::PyRuntimeError::new_err(
            "Code TE2 domain lacks submit_rpc; rebuild/reactivate matching mypyc or use matching interpreted source",
        ));
    }
    Ok(())
}

pub fn submit(
    py: Python<'_>,
    module: &Py<PyAny>,
    namespace: &str,
    sid: &str,
    event: &str,
    frame: &ValidatedRpc,
) -> PyResult<Py<PyAny>> {
    if !frame.conversion_fits() {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "native value budget exceeded",
        ));
    }
    module.call_method1(
        py,
        "submit_rpc",
        (namespace, sid, event, PyBytes::new(py, frame.as_bytes())),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn submits_exact_validated_bytes_and_separate_native_context() {
        Python::attach(|py| {
            let code = CString::new("def submit_rpc(namespace, sid, event, payload):\n    assert type(payload) is bytes\n    return (namespace, sid, event, payload)\n").unwrap();
            let module = PyModule::from_code(py, &code, c"rpc_probe.py", c"rpc_probe").unwrap();
            check_domain(module.as_any()).unwrap();
            let wire = vec![0x81, 0xa1, b'x', 0xcc, 1]; // Nonminimal uint encoding stays exact.
            let frame =
                crate::rpc_codec::validate_for(rmpv::Value::Binary(wire.clone()), "editor", false)
                    .unwrap();
            let result = submit(
                py,
                &module.into_any().unbind(),
                "/rpc/editor",
                "owned",
                "rpc",
                &frame,
            )
            .unwrap();
            let (ns, sid, event, body): (String, String, String, Vec<u8>) =
                result.extract(py).unwrap();
            assert_eq!(
                (ns.as_str(), sid.as_str(), event.as_str()),
                ("/rpc/editor", "owned", "rpc")
            );
            assert_eq!(body, wire);
        });
    }

    #[test]
    fn old_or_noncallable_domains_fail_before_reader_startup() {
        Python::attach(|py| {
            let module = PyModule::new(py, "old_domain").unwrap();
            assert!(check_domain(module.as_any()).is_err());
            module.setattr("submit_rpc", 1).unwrap();
            assert!(check_domain(module.as_any()).is_err());
        });
    }

    #[test]
    fn retains_wrapped_conversion_depth_failure_not_a_wire_parse_error() {
        Python::attach(|py| {
            for depth in [63, 64] {
                let mut value = rmpv::Value::Nil;
                for _ in 0..depth {
                    value = rmpv::Value::Array(vec![value]);
                }
                let mut wire = Vec::new();
                rmpv::encode::write_value(&mut wire, &value).unwrap();
                let frame =
                    crate::rpc_codec::validate_for(rmpv::Value::Binary(wire), "editor", false)
                        .unwrap();
                let wrapped = crate::protocol::map([
                    ("namespace", "/rpc/editor".into()),
                    ("sid", "owned".into()),
                    ("event", "rpc".into()),
                    ("data", value),
                ]);
                assert_eq!(
                    frame.conversion_fits(),
                    crate::values::to_python(py, &wrapped).is_ok()
                );
                if depth == 64 {
                    let module = PyModule::new(py, "must_not_dispatch")
                        .unwrap()
                        .into_any()
                        .unbind();
                    assert!(
                        submit(py, &module, "/rpc/editor", "owned", "rpc", &frame)
                            .unwrap_err()
                            .to_string()
                            .contains("native value budget exceeded")
                    );
                }
            }
        });
    }
}
