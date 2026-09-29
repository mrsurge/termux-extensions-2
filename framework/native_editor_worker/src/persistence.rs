//! Byte persistence only: callers retain schema, locking and directory policy.
use std::{
    fs,
    io::{self, Write},
    path::Path,
};

pub fn python_error(error: io::Error, path: &Path) -> pyo3::PyErr {
    // Generic PyO3 io::Error conversion drops errno; OSError selects its subclass.
    if let Some(errno) = error.raw_os_error() {
        pyo3::exceptions::PyOSError::new_err((
            errno,
            error.to_string(),
            path.as_os_str().to_os_string(),
        ))
    } else {
        error.into()
    }
}

pub fn write_atomic(
    path: &Path,
    payload: &[u8],
    fixed: Option<&Path>,
    prefix: Option<&str>,
    suffix: &str,
) -> io::Result<()> {
    if let Some(temporary) = fixed {
        // Match the existing fixed-path write, replace, finally-unlink contract.
        let result = fs::write(temporary, payload).and_then(|()| fs::rename(temporary, path));
        let cleanup = fs::remove_file(temporary);
        if let Err(error) = cleanup {
            if error.kind() != io::ErrorKind::NotFound {
                return Err(error);
            }
        }
        return result;
    }
    let default_prefix = format!(
        "{}.",
        path.file_name().unwrap_or_default().to_string_lossy()
    );
    let mut temporary = tempfile::Builder::new()
        .prefix(prefix.filter(|p| !p.is_empty()).unwrap_or(&default_prefix))
        .suffix(suffix)
        .tempfile_in(
            path.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )?;
    let written = temporary.write_all(payload);
    // Close before rename, matching NamedTemporaryFile's Python context manager.
    let temporary = temporary.into_temp_path();
    let result = written.and_then(|()| fs::rename(&temporary, path));
    if let Err(error) = fs::remove_file(&temporary) {
        if error.kind() != io::ErrorKind::NotFound {
            return Err(error);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn writes_replace_without_cache_and_unique_files_are_private() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("store");
        write_atomic(&path, b"first", None, Some(".store."), ".tmp").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        write_atomic(&path, b"second", Some(&root.path().join("fixed")), None, "").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_replace_cleans_both_temporary_forms_and_does_not_create_parents() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("destination");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("retained"), b"old").unwrap();
        for fixed in [None, Some(root.path().join("fixed"))] {
            assert!(write_atomic(&directory, b"new", fixed.as_deref(), None, "").is_err());
            assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
            assert_eq!(fs::read(directory.join("retained")).unwrap(), b"old");
        }
        assert_eq!(
            write_atomic(&root.path().join("missing/store"), b"new", None, None, "")
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
    }

    #[test]
    fn fixed_temporary_retains_existing_permissions() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("store");
        let fixed = root.path().join("fixed");
        fs::write(&fixed, b"old").unwrap();
        fs::set_permissions(&fixed, fs::Permissions::from_mode(0o640)).unwrap();
        write_atomic(&path, b"new", Some(&fixed), None, "").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
    }

    #[test]
    fn io_errors_keep_python_exception_categories_and_errno() {
        use pyo3::{
            exceptions::{PyFileNotFoundError, PyPermissionError},
            prelude::*,
        };
        Python::attach(|py| {
            let missing = python_error(io::Error::from_raw_os_error(2), Path::new("missing"));
            assert!(missing.is_instance_of::<PyFileNotFoundError>(py));
            assert_eq!(
                missing
                    .value(py)
                    .getattr("errno")
                    .unwrap()
                    .extract::<i32>()
                    .unwrap(),
                2
            );
            assert_eq!(
                missing
                    .value(py)
                    .getattr("filename")
                    .unwrap()
                    .extract::<String>()
                    .unwrap(),
                "missing"
            );
            let denied = python_error(io::Error::from_raw_os_error(13), Path::new("denied"));
            assert!(denied.is_instance_of::<PyPermissionError>(py));
        });
    }
}
