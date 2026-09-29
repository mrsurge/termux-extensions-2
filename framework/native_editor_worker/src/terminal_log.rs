//! One opened raw-log snapshot; bounded reads and explicit descriptor lifetime.
use pyo3::prelude::*;
use pyo3::types::PyBytes;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    os::unix::fs::MetadataExt,
    path::Path,
    sync::Mutex,
};

#[pyclass]
pub struct LogReader {
    file: Mutex<Option<File>>,
    #[pyo3(get)]
    identity: (u64, u64),
    #[pyo3(get)]
    size: u64,
}

impl LogReader {
    pub fn open(path: &Path) -> std::io::Result<Option<Self>> {
        let file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let meta = file.metadata()?;
        Ok(Some(Self {
            file: Mutex::new(Some(file)),
            identity: (meta.dev(), meta.ino()),
            size: meta.len(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_snapshot_reader_pins_descriptor_and_closes() {
        let root = tempfile::tempdir_in("target").unwrap();
        let path = root.path().join("raw.log");
        assert!(LogReader::open(&path).unwrap().is_none());
        std::fs::write(&path, b"first").unwrap();
        let reader = LogReader::open(&path).unwrap().unwrap();
        std::fs::rename(&path, root.path().join("old.log")).unwrap();
        std::fs::write(&path, b"replacement").unwrap();
        assert_ne!(
            reader.identity,
            LogReader::open(&path).unwrap().unwrap().identity
        );
        Python::attach(|py| {
            assert_eq!(
                reader.read(py, 65536).unwrap().bind(py).as_bytes(),
                b"first"
            );
            assert!(reader.read(py, 65537).is_err());
            reader.seek(py, 0).unwrap();
            assert_eq!(reader.read(py, 2).unwrap().bind(py).as_bytes(), b"fi");
            reader.close(py);
            assert!(reader.read(py, 1).is_err());
        });
    }
}

#[pymethods]
impl LogReader {
    fn seek(&self, py: Python<'_>, offset: u64) -> PyResult<()> {
        py.detach(|| {
            let mut guard = self.file.lock().unwrap();
            let file = guard
                .as_mut()
                .ok_or_else(|| std::io::Error::other("terminal log closed"))?;
            file.seek(SeekFrom::Start(offset))?;
            Ok::<_, std::io::Error>(())
        })?;
        Ok(())
    }
    fn read(&self, py: Python<'_>, limit: usize) -> PyResult<Py<PyBytes>> {
        if limit == 0 || limit > 65536 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "invalid terminal log read bound",
            ));
        }
        let bytes = py.detach(|| {
            let mut guard = self.file.lock().unwrap();
            let file = guard
                .as_mut()
                .ok_or_else(|| std::io::Error::other("terminal log closed"))?;
            let remaining = self.size.saturating_sub(file.stream_position()?);
            let mut bytes = vec![0; limit.min(remaining.min(65536) as usize)];
            let read = file.read(&mut bytes)?;
            bytes.truncate(read);
            Ok::<_, std::io::Error>(bytes)
        })?;
        Ok(PyBytes::new(py, &bytes).unbind())
    }
    fn close(&self, py: Python<'_>) {
        py.detach(|| {
            self.file.lock().unwrap().take();
        });
    }
}
