use anyhow::{Result, bail};
use rmpv::Value;

pub const FRAME_LIMIT: usize = 32 * 1024 * 1024;
pub const BYTE_BUDGET: usize = 64 * 1024 * 1024;
pub const CAPACITY: usize = 64;

pub fn get<'a>(value: &'a Value, name: &str) -> Option<&'a Value> {
    value
        .as_map()?
        .iter()
        .find(|(k, _)| k.as_str() == Some(name))
        .map(|(_, v)| v)
}

pub fn text<'a>(value: &'a Value, name: &str) -> Option<&'a str> {
    get(value, name).and_then(Value::as_str)
}

pub fn map(items: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Map(
        items
            .into_iter()
            .map(|(k, v)| (Value::from(k), v))
            .collect(),
    )
}

pub fn validate(value: &Value) -> Result<()> {
    let entries = value
        .as_map()
        .ok_or_else(|| anyhow::anyhow!("envelope must be a map"))?;
    let mut keys = std::collections::HashSet::new();
    for (key, _) in entries {
        let key = key
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("envelope keys must be strings"))?;
        if !keys.insert(key) {
            bail!("duplicate envelope key");
        }
    }
    if get(value, "jsonrpc").is_some_and(|v| v.as_str() != Some("2.0")) {
        bail!("jsonrpc must be 2.0");
    }
    if get(value, "protocolVersion").is_some_and(|v| v.as_i64() != Some(1)) {
        bail!("unsupported protocolVersion");
    }
    for key in ["kind", "originName"] {
        if get(value, key).is_some_and(|v| v.as_str().is_none()) {
            bail!("{key} must be a string");
        }
    }
    for key in [
        "id",
        "method",
        "targetName",
        "workspaceRoot",
        "correlationId",
        "opId",
        "reason",
    ] {
        if get(value, key).is_some_and(|v| !v.is_nil() && v.as_str().is_none()) {
            bail!("{key} must be a string or null");
        }
    }
    for key in ["originNid", "targetNid", "projectGeneration", "sequence"] {
        if get(value, key)
            .is_some_and(|v| (key == "originNid" || !v.is_nil()) && !v.is_i64() && !v.is_u64())
        {
            bail!("{key} must be an integer");
        }
    }
    if let Some(error) = get(value, "error").filter(|v| !v.is_nil()) {
        if error.as_map().is_none()
            || text(error, "code").is_none()
            || text(error, "message").is_none()
        {
            bail!("error must contain string code and message");
        }
        if get(error, "retryable").is_some_and(|v| v.as_bool().is_none()) {
            bail!("error.retryable must be boolean");
        }
    }
    if text(value, "kind") == Some("request")
        && (text(value, "id").unwrap_or("").is_empty()
            || text(value, "method").unwrap_or("").is_empty())
    {
        bail!("request id and method required");
    }
    Ok(())
}

pub fn response(request: &Value, result: Value, error: bool, nid: u32, name: &str) -> Value {
    let mut fields = vec![
        ("jsonrpc", Value::from("2.0")),
        ("protocolVersion", Value::from(1)),
        (
            "kind",
            Value::from(if error { "error" } else { "response" }),
        ),
        ("originNid", Value::from(nid)),
        ("originName", Value::from(name)),
        (
            "targetNid",
            get(request, "originNid").cloned().unwrap_or(Value::from(0)),
        ),
        (
            "targetName",
            get(request, "originName")
                .cloned()
                .unwrap_or(Value::from("")),
        ),
        (if error { "error" } else { "result" }, result),
    ];
    for key in [
        "id",
        "projectGeneration",
        "workspaceRoot",
        "correlationId",
        "opId",
    ] {
        if let Some(value) = get(request, key) {
            fields.push((key, value.clone()));
        }
    }
    map(fields)
}

pub fn error(code: &str, message: &str) -> Value {
    let message: String = message.chars().take(1024).collect();
    map([
        ("code", Value::from(code)),
        ("message", Value::from(message)),
        ("retryable", Value::Boolean(false)),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_metadata_and_correlation() {
        assert!(validate(&map([("originNid", Value::Boolean(true))])).is_err());
        let request = map([
            ("kind", "request".into()),
            ("id", "i".into()),
            ("method", "m".into()),
            ("opId", "o".into()),
        ]);
        validate(&request).unwrap();
        assert_eq!(
            text(&response(&request, Value::Nil, false, 2100, "test"), "opId"),
            Some("o")
        );
    }
}
