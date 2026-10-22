//! Framework control ingress only. WBA/socket codecs and outbound values differ.
use anyhow::Result;
use pyo3::{exceptions::PyRuntimeError, prelude::*, types::PyBytes};
use std::io::BufRead;

pub fn check_domain(module: &Bound<'_, PyAny>) -> PyResult<()> {
    if !module
        .getattr("control_bytes")
        .is_ok_and(|handler| handler.is_callable())
    {
        return Err(PyRuntimeError::new_err(
            "Code TE2 domain lacks control_bytes; rebuild/reactivate the matching mypyc snapshot or use matching interpreted source",
        ));
    }
    Ok(())
}

pub fn read_and_deliver(reader: &mut impl BufRead, module: &Py<PyAny>) -> Result<()> {
    let bytes = crate::decode::read_frame_bytes(reader)?;
    Python::attach(|py| -> PyResult<()> {
        module.call_method1(py, "control_bytes", (PyBytes::new(py, &bytes),))?;
        Ok(())
    })
    .map_err(|error| anyhow::anyhow!("framework control: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_old_domains_before_starting_the_reader() {
        Python::attach(|py| {
            let module = pyo3::types::PyModule::new(py, "inbound_test").unwrap();
            assert!(
                check_domain(module.as_any())
                    .unwrap_err()
                    .to_string()
                    .contains("rebuild/reactivate")
            );
            module.setattr("control_bytes", 1).unwrap();
            assert!(check_domain(module.as_any()).is_err());
            module.setattr("control_bytes", py.None()).unwrap();
            assert!(check_domain(module.as_any()).is_err());
            module
                .setattr(
                    "control_bytes",
                    py.import("builtins").unwrap().getattr("len").unwrap(),
                )
                .unwrap();
            check_domain(module.as_any()).unwrap();
        });
    }
}
