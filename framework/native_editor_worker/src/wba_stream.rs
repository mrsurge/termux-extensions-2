//! The Python-facing WBA codec; framing is owned by wba_codec::Stream.
use crate::{values, wba_codec};
use pyo3::{exceptions::PyRuntimeError, prelude::*, types::PyBytes};
use std::sync::Mutex;

#[pyclass]
pub struct WbaStream {
    decoder: Mutex<wba_codec::Stream>,
}

impl WbaStream {
    pub fn new() -> Self {
        Self {
            decoder: Mutex::new(wba_codec::Stream::default()),
        }
    }
}

#[pymethods]
impl WbaStream {
    fn feed_frames(&self, py: Python<'_>, chunk: Vec<u8>) -> PyResult<Vec<Py<PyBytes>>> {
        let records = py
            .detach(|| self.decoder.lock().unwrap().feed_frames(&chunk))
            .map_err(|error| PyRuntimeError::new_err(error.to_string()))?;
        Ok(records
            .iter()
            .map(|record| PyBytes::new(py, record).unbind())
            .collect())
    }

    // Retained for older Python callers and the real-converter benchmark.
    fn feed(&self, py: Python<'_>, chunk: Vec<u8>) -> PyResult<Vec<Py<PyAny>>> {
        let records = py
            .detach(|| self.decoder.lock().unwrap().feed(&chunk))
            .map_err(|error| PyRuntimeError::new_err(error.to_string()))?;
        records
            .iter()
            .map(|record| values::to_python(py, record))
            .collect()
    }

    fn finish(&self) -> PyResult<()> {
        self.decoder
            .lock()
            .unwrap()
            .finish()
            .map_err(|error| PyRuntimeError::new_err(error.to_string()))
    }
}
