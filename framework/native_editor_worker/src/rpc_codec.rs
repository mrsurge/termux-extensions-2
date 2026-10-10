//! Frontend RPC payload codec. Socket.IO framing is a separate outer protocol.
use crate::{
    decode,
    protocol::{map, text},
};
use anyhow::{Result, bail};
use flate2::{Compression, write::GzEncoder};
use rmpv::Value;
use std::{
    io::{Cursor, Write},
    sync::OnceLock,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

pub const PAYLOAD_LIMIT: usize = 8 * 1024 * 1024;
pub const GZIP_CODEC: &str = "msgpack-gzip-v1";
const HEADER: usize = 12;

pub fn negotiate(namespace: &str, auth: &Value) -> Result<bool> {
    match text(auth, "rpcCodec") {
        Some(GZIP_CODEC) if namespace == "/rpc/editor" => Ok(true),
        Some("msgpack-v1") => Ok(false),
        _ if lane(namespace).is_none() => Ok(false),
        _ => bail!("unsupported_rpc_codec"),
    }
}

pub fn frame(bytes: &[u8], compress: bool) -> Result<Vec<u8>> {
    if bytes.is_empty() || bytes.len() > PAYLOAD_LIMIT - HEADER {
        bail!("rpc_payload_limit");
    }
    let mut zipped = Vec::new();
    if compress && bytes.len() >= 1024 {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(bytes)?;
        zipped = encoder.finish()?;
    }
    let compressed = !zipped.is_empty() && zipped.len() < bytes.len();
    let body = if compressed { zipped.as_slice() } else { bytes };
    let mut framed = Vec::with_capacity(HEADER + body.len());
    framed.extend_from_slice(b"TE2C");
    framed.extend_from_slice(&[1, u8::from(compressed), 0, 0]);
    framed.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    framed.extend_from_slice(body);
    Ok(framed)
}

pub fn wrap(value: &Value) -> Result<Value> {
    let Value::Binary(bytes) = value else {
        bail!("binary_rpc_payload_required")
    };
    Ok(Value::Binary(frame(bytes, true)?))
}

pub fn encode_for(value: &Value, lane: &str, gzip: bool) -> Result<Value> {
    let encoded = encode(value, lane)?;
    if gzip { wrap(&encoded) } else { Ok(encoded) }
}

pub fn decode_for(
    payload: Value,
    lane: &str,
    gzip: bool,
) -> std::result::Result<Value, &'static str> {
    if !gzip {
        return decode(payload, lane);
    }
    let Value::Binary(bytes) = payload else {
        return Err("binary_rpc_payload_required");
    };
    if bytes.len() < HEADER
        || bytes.len() > PAYLOAD_LIMIT
        || &bytes[..4] != b"TE2C"
        || bytes[4] != 1
        || bytes[5] != 0
        || bytes[6] != 0
        || bytes[7] != 0
    {
        return Err("invalid_rpc_frame");
    }
    // This contract intentionally accepts only raw framed browser requests.
    let length = u32::from_be_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if length == 0 || length > PAYLOAD_LIMIT - HEADER || bytes.len() - HEADER != length {
        return Err("invalid_rpc_frame");
    }
    decode(Value::Binary(bytes[HEADER..].to_vec()), lane)
}

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
    use std::io::Read;

    #[test]
    fn gzip_is_explicit_and_editor_only() {
        let auth = map([("rpcCodec", GZIP_CODEC.into())]);
        assert!(negotiate("/rpc/editor", &auth).unwrap());
        assert!(negotiate("/rpc/explorer", &auth).is_err());
        assert!(!negotiate("/rpc/editor", &map([("rpcCodec", "msgpack-v1".into())])).unwrap());
    }

    #[test]
    fn framed_requests_are_strict_and_responses_compress_bytes() {
        let value = map([
            ("text", "λabc".repeat(4096).into()),
            ("binary", Value::Binary(vec![0, 255])),
        ]);
        let Value::Binary(raw) = encode(&value, "editor").unwrap() else {
            panic!()
        };
        let request = frame(&raw, false).unwrap();
        assert_eq!(
            decode_for(Value::Binary(request.clone()), "editor", true).unwrap(),
            value
        );
        assert!(decode_for(Value::Binary(raw.clone()), "editor", true).is_err());
        assert!(decode_for(Value::Binary(request.clone()), "editor", false).is_err());
        let response = frame(&raw, true).unwrap();
        assert_eq!(response[5], 1);
        assert!(response.len() < raw.len());
        assert!(decode_for(Value::Binary(response.clone()), "editor", true).is_err());
        let mut decoded = Vec::new();
        flate2::read::GzDecoder::new(&response[HEADER..])
            .read_to_end(&mut decoded)
            .unwrap();
        assert_eq!(decoded, raw);
        for offset in [0, 4, 5, 6, 7, 8, 11] {
            let mut bad = request.clone();
            bad[offset] ^= 0x80;
            assert!(decode_for(Value::Binary(bad), "editor", true).is_err());
        }
        assert!(
            decode_for(
                Value::Binary(request[..request.len() - 1].to_vec()),
                "editor",
                true
            )
            .is_err()
        );
        assert!(frame(&vec![0; PAYLOAD_LIMIT], true).is_err());
        assert_eq!(frame(&[0xc0], true).unwrap()[5], 0);
        if let Ok(path) = std::env::var("TE2_RPC_GZIP_FIXTURE") {
            std::fs::write(path, response).unwrap();
        }
    }

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
