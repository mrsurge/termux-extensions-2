use serde::{Deserialize, Deserializer, Serialize, de};
use serde_json::Value;
use std::{
    env, fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

pub(crate) fn deserialize_boolish<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::Bool(flag) => Ok(flag),
        Value::Number(number) => Ok(number.as_i64().unwrap_or_default() != 0),
        Value::String(raw) => Ok(boolish(raw.as_str())),
        Value::Null => Ok(false),
        other => Err(de::Error::custom(format!("invalid boolean value: {other}"))),
    }
}

pub(crate) fn boolish(raw: &str) -> bool {
    matches!(
        raw.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub(crate) fn expand_user_path(candidate: &str, home_dir: &Path) -> PathBuf {
    if candidate == "~" {
        return home_dir.to_path_buf();
    }
    if let Some(rest) = candidate.strip_prefix("~/") {
        return home_dir.join(rest);
    }
    if candidate.starts_with('/') {
        return PathBuf::from(candidate);
    }
    home_dir.join(candidate)
}

pub(crate) fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub(crate) fn normalize_lexical(path: PathBuf) -> PathBuf {
    let absolute = if path.is_absolute() {
        path
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(Path::new("/")),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    if normalized.as_os_str().is_empty() {
        PathBuf::from("/")
    } else {
        normalized
    }
}

pub(crate) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(crate) fn write_json_atomic<T: Serialize>(
    path: &Path,
    value: &T,
) -> Result<(), std::io::Error> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    let mut temp = tempfile::Builder::new()
        .prefix(".te2-json-")
        .suffix(".tmp")
        .tempfile_in(parent)?;
    temp.write_all(text.as_bytes())?;
    temp.flush()?;
    temp.persist(path).map_err(|error| error.error)?;
    Ok(())
}
