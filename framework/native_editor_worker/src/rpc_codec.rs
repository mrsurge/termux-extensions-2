//! Frontend RPC payload codec. Socket.IO framing is a separate outer protocol.
use crate::{
    decode,
    protocol::{map, text},
};
use anyhow::{Result, bail};
use rmpv::Value;
use std::{
    io::{Cursor, Write},
    sync::OnceLock,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

pub const PAYLOAD_LIMIT: usize = 8 * 1024 * 1024;

pub fn lane(namespace: &str) -> Option<&'static str> {
    match namespace {
        "/rpc/editor" => Some("editor"),
        "/rpc/explorer" => Some("explorer"),
        "/ui_ipc" => Some("ui_ipc"),
        _ => None,
    }
}

pub fn encoded_event(namespace: &str, event: &str) -> bool {
    matches!(
        (namespace, event),
        ("/rpc/editor", "rpc") | ("/rpc/explorer" | "/ui_ipc", "rpc.notify")
    )
}

fn timer() -> Option<Instant> {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    let enabled = *ENABLED.get_or_init(|| {
        std::env::var("CODE_TE2_RPC_CODEC_METRICS").is_ok_and(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
    });
    enabled.then(Instant::now)
}

fn metrics(start: Option<Instant>, direction: &str, lane: &str, value: &Value, bytes: usize) {
    let Some(start) = start else {
        return;
    };
    let mut record = serde_json::json!({
        "system": "code_te2.frontend_rpc_codec", "kind": "codec", "owner": "native",
        "ts_ms": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        "codec": "msgpack-v1", "direction": direction, "lane": lane,
        "bytes": bytes, "duration_ms": start.elapsed().as_secs_f64() * 1000.0,
    });
    if let Some(method) = text(value, "method").filter(|v| !v.is_empty()) {
        record["method"] = method.into();
    }
    // stdout belongs exclusively to the framework MessagePack pipe.
    eprintln!("{record}");
}

pub fn decode(payload: Value, lane: &str) -> std::result::Result<Value, &'static str> {
    let Value::Binary(bytes) = payload else {
        return Err("binary_rpc_payload_required");
    };
    if bytes.len() > PAYLOAD_LIMIT {
        return Err("invalid_msgpack_payload");
    }
    let start = timer();
    let mut reader = Cursor::new(bytes.as_slice());
    let (value, consumed) =
        decode::read_frame(&mut reader).map_err(|_| "invalid_msgpack_payload")?;
    if consumed != bytes.len() {
        return Err("invalid_msgpack_payload");
    }
    metrics(start, "decode", lane, &value, bytes.len());
    Ok(value)
}

struct Buffer(Vec<u8>);
impl Write for Buffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > PAYLOAD_LIMIT.saturating_sub(self.0.len()) {
            return Err(std::io::Error::other("RPC payload limit exceeded"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub fn encode(value: &Value, lane: &str) -> Result<Value> {
    let start = timer();
    let mut buffer = Buffer(Vec::new());
    if rmpv::encode::write_value(&mut buffer, value).is_err() {
        bail!("rpc_payload_not_encodable");
    }
    metrics(start, "encode", lane, value, buffer.0.len());
    Ok(Value::Binary(buffer.0))
}

pub fn parse_error(message: &str) -> Value {
    map([
        ("jsonrpc", "2.0".into()),
        ("id", Value::Nil),
        (
            "error",
            map([("code", (-32700).into()), ("message", message.into())]),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_round_trip_without_python_or_json() {
        let value = map([
            ("binary", Value::Binary(vec![0, 255])),
            (
                "nested",
                Value::Array(vec![
                    Value::Nil,
                    true.into(),
                    "λ".into(),
                    i64::MIN.into(),
                    u64::MAX.into(),
                    1.25.into(),
                ]),
            ),
        ]);
        assert_eq!(
            decode(encode(&value, "editor").unwrap(), "editor").unwrap(),
            value
        );
    }

    #[test]
    fn invalid_frames_are_bounded_and_not_concatenated() {
        for bytes in [
            vec![],
            vec![0xc1],
            vec![0x81],
            vec![0xc0, 0xc0],
            vec![0xc6, 255, 255, 255, 255],
            vec![0xd4, 0, 0],
        ] {
            assert_eq!(
                decode(Value::Binary(bytes), "ui_ipc"),
                Err("invalid_msgpack_payload")
            );
        }
        assert_eq!(
            decode(map([("method", "test".into())]), "editor"),
            Err("binary_rpc_payload_required")
        );
        assert!(encode(&Value::Binary(vec![0; PAYLOAD_LIMIT]), "editor").is_err());
    }

    #[test]
    fn only_the_three_rpc_lanes_are_encoded() {
        assert!(encoded_event("/rpc/editor", "rpc"));
        assert!(encoded_event("/rpc/explorer", "rpc.notify"));
        assert!(encoded_event("/ui_ipc", "rpc.notify"));
        assert!(!encoded_event("/sidebar_ipc", "rpc.notify"));
        assert!(!encoded_event("/terminal", "rpc"));
        assert!(!encoded_event("/ui_ipc", "another.event"));
        assert!(lane("/sidebar_ipc").is_none());
    }
}
