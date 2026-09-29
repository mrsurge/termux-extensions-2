use pyo3::exceptions::{PyTypeError, PyValueError};
use pyo3::prelude::*;
use pyo3::types::{PyBool, PyBytes, PyDict, PyFloat, PyInt, PyList, PyString};
use rmpv::Value;

const MAX_DEPTH: usize = 64;
const MAX_NODES: usize = 1_000_000;

pub fn to_python(py: Python<'_>, value: &Value) -> PyResult<Py<PyAny>> {
    let mut remaining = MAX_NODES;
    convert_to(py, value, 0, &mut remaining)
}

fn visit(depth: usize, remaining: &mut usize) -> PyResult<()> {
    if depth > MAX_DEPTH || *remaining == 0 {
        return Err(PyValueError::new_err("native value budget exceeded"));
    }
    *remaining -= 1;
    Ok(())
}

fn convert_to(
    py: Python<'_>,
    value: &Value,
    depth: usize,
    left: &mut usize,
) -> PyResult<Py<PyAny>> {
    visit(depth, left)?;
    Ok(match value {
        Value::Nil => py.None(),
        Value::Boolean(v) => v.into_pyobject(py)?.to_owned().into_any().unbind(),
        Value::Integer(v) => {
            if let Some(v) = v.as_i64() {
                v.into_pyobject(py)?.into_any().unbind()
            } else {
                v.as_u64().unwrap().into_pyobject(py)?.into_any().unbind()
            }
        }
        Value::F32(v) => v.into_pyobject(py)?.into_any().unbind(),
        Value::F64(v) => v.into_pyobject(py)?.into_any().unbind(),
        Value::String(v) => PyString::new(
            py,
            v.as_str()
                .ok_or_else(|| PyValueError::new_err("invalid UTF-8"))?,
        )
        .into_any()
        .unbind(),
        Value::Binary(v) => PyBytes::new(py, v).into_any().unbind(),
        Value::Array(values) => {
            let list = PyList::empty(py);
            for value in values {
                list.append(convert_to(py, value, depth + 1, left)?)?;
            }
            list.into_any().unbind()
        }
        Value::Map(values) => {
            let dict = PyDict::new(py);
            for (key, value) in values {
                let key = key
                    .as_str()
                    .ok_or_else(|| PyTypeError::new_err("map keys must be strings"))?;
                if dict.contains(key)? {
                    return Err(PyValueError::new_err("duplicate map key"));
                }
                dict.set_item(key, convert_to(py, value, depth + 1, left)?)?;
            }
            dict.into_any().unbind()
        }
        Value::Ext(..) => {
            return Err(PyTypeError::new_err(
                "MessagePack extension values unsupported",
            ));
        }
    })
}

pub fn from_python(value: &Bound<'_, PyAny>) -> PyResult<Value> {
    let mut remaining = MAX_NODES;
    convert_from(value, 0, &mut remaining)
}

fn convert_from(value: &Bound<'_, PyAny>, depth: usize, left: &mut usize) -> PyResult<Value> {
    visit(depth, left)?;
    if value.is_none() {
        Ok(Value::Nil)
    } else if value.is_instance_of::<PyBool>() {
        Ok(Value::Boolean(value.extract()?))
    } else if value.is_instance_of::<PyInt>() {
        if let Ok(v) = value.extract::<i64>() {
            Ok(Value::from(v))
        } else {
            Ok(Value::from(value.extract::<u64>()?))
        }
    } else if value.is_instance_of::<PyFloat>() {
        Ok(Value::F64(value.extract()?))
    } else if value.is_instance_of::<PyString>() {
        Ok(Value::from(value.extract::<String>()?))
    } else if let Ok(bytes) = value.cast::<PyBytes>() {
        Ok(Value::Binary(bytes.as_bytes().to_vec()))
    } else if let Ok(list) = value.cast::<PyList>() {
        list.iter()
            .map(|v| convert_from(&v, depth + 1, left))
            .collect::<PyResult<Vec<_>>>()
            .map(Value::Array)
    } else if let Ok(dict) = value.cast::<PyDict>() {
        let mut result = Vec::new();
        for (key, value) in dict.iter() {
            let key = key
                .cast::<PyString>()
                .map_err(|_| PyTypeError::new_err("map keys must be strings"))?;
            result.push((
                Value::from(key.to_str()?),
                convert_from(&value, depth + 1, left)?,
            ));
        }
        Ok(Value::Map(result))
    } else {
        Err(PyTypeError::new_err(
            "unsupported service value (expected structural builtins)",
        ))
    }
}
