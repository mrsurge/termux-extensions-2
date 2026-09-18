use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

pub(crate) const JSONRPC_VERSION: &str = "2.0";
pub(crate) const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PipeMessageKind {
    Hello,
    Request,
    Response,
    Notification,
    Progress,
    Cancel,
    Error,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PipeIdentity {
    pub(crate) nid: u32,
    pub(crate) name: String,
}

impl PipeIdentity {
    pub(crate) fn framework_rust() -> Self {
        Self {
            nid: 1,
            name: "framework.rust".to_owned(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PipeEnvelope {
    pub(crate) jsonrpc: String,
    pub(crate) protocol_version: u16,
    pub(crate) kind: PipeMessageKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) method: Option<String>,
    pub(crate) origin_nid: u32,
    pub(crate) origin_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) target_nid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) target_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) project_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) workspace_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) op_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) params: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<PipeError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason: Option<String>,
}

impl PipeEnvelope {
    pub(crate) fn success_response(
        request: &Self,
        responder: &PipeIdentity,
        result: Value,
    ) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            protocol_version: PROTOCOL_VERSION,
            kind: PipeMessageKind::Response,
            id: request.id.clone(),
            method: None,
            origin_nid: responder.nid,
            origin_name: responder.name.clone(),
            target_nid: Some(request.origin_nid),
            target_name: Some(request.origin_name.clone()),
            project_generation: request.project_generation,
            workspace_root: request.workspace_root.clone(),
            correlation_id: request.correlation_id.clone(),
            op_id: request.op_id.clone(),
            sequence: None,
            params: None,
            result: Some(result),
            error: None,
            reason: None,
        }
    }

    pub(crate) fn error_response(
        request: &Self,
        responder: &PipeIdentity,
        error: PipeError,
    ) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            protocol_version: PROTOCOL_VERSION,
            kind: PipeMessageKind::Error,
            id: request.id.clone(),
            method: None,
            origin_nid: responder.nid,
            origin_name: responder.name.clone(),
            target_nid: Some(request.origin_nid),
            target_name: Some(request.origin_name.clone()),
            project_generation: request.project_generation,
            workspace_root: request.workspace_root.clone(),
            correlation_id: request.correlation_id.clone(),
            op_id: request.op_id.clone(),
            sequence: None,
            params: None,
            result: None,
            error: Some(error),
            reason: None,
        }
    }

    pub(crate) fn validate_basic(&self) -> Result<(), PipeProtocolError> {
        if self.jsonrpc != JSONRPC_VERSION {
            return Err(PipeProtocolError::Invalid(format!(
                "jsonrpc must be {JSONRPC_VERSION}"
            )));
        }
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(PipeProtocolError::Invalid(format!(
                "unsupported protocolVersion {}",
                self.protocol_version
            )));
        }
        if matches!(self.kind, PipeMessageKind::Request) {
            if self.id.as_deref().unwrap_or_default().is_empty() {
                return Err(PipeProtocolError::Invalid(
                    "request id is required".to_owned(),
                ));
            }
            if self.method.as_deref().unwrap_or_default().is_empty() {
                return Err(PipeProtocolError::Invalid(
                    "request method is required".to_owned(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PipeError {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) details: Option<Value>,
}

impl PipeError {
    pub(crate) fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        retryable: bool,
        details: Option<Value>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
            details,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "payloadKind")]
pub(crate) enum PipePayload {
    #[serde(rename = "object")]
    Object { value: Value },
    #[serde(rename = "string", rename_all = "camelCase")]
    String { encoding: String, value: String },
    #[serde(rename = "bytes", rename_all = "camelCase")]
    Bytes { encoding: String, value: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PipeProtocolError {
    MessagePack(String),
    Invalid(String),
}

impl fmt::Display for PipeProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MessagePack(message) => write!(formatter, "MessagePack parse error: {message}"),
            Self::Invalid(message) => write!(formatter, "invalid pipe envelope: {message}"),
        }
    }
}

impl std::error::Error for PipeProtocolError {}

pub(crate) const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;

pub(crate) fn encode_frame(envelope: &PipeEnvelope) -> Result<Vec<u8>, PipeProtocolError> {
    envelope.validate_basic()?;
    // Named maps preserve the existing cross-language envelope field names.
    let encoded = rmp_serde::to_vec_named(envelope)
        .map_err(|error| PipeProtocolError::MessagePack(error.to_string()))?;
    if encoded.len() > MAX_FRAME_BYTES {
        return Err(PipeProtocolError::Invalid(
            "frame exceeds byte limit".into(),
        ));
    }
    Ok(encoded)
}

#[derive(Default)]
pub(crate) struct PipeDecoder {
    // Only incomplete bytes cross reads. A malformed object is fatal because
    // concatenated MessagePack has no safe delimiter for resynchronization.
    pending: Vec<u8>,
}

impl PipeDecoder {
    pub(crate) fn feed(&mut self, chunk: &[u8]) -> Result<Vec<PipeEnvelope>, PipeProtocolError> {
        let mut messages = Vec::new();
        for part in chunk.chunks(65536) {
            self.pending.extend_from_slice(part);
            let mut consumed = 0;
            while consumed < self.pending.len() {
                let bytes = &self.pending[consumed..];
                if !matches!(bytes[0], 0x80..=0x8f | 0xde | 0xdf) {
                    return Err(PipeProtocolError::Invalid(
                        "expected an envelope map".into(),
                    ));
                }
                let mut cursor = std::io::Cursor::new(&bytes[..bytes.len().min(MAX_FRAME_BYTES)]);
                let result =
                    PipeEnvelope::deserialize(&mut rmp_serde::Deserializer::new(&mut cursor));
                match result {
                    Ok(envelope) => {
                        envelope.validate_basic()?;
                        consumed += cursor.position() as usize;
                        messages.push(envelope);
                    }
                    Err(
                        rmp_serde::decode::Error::InvalidMarkerRead(ref error)
                        | rmp_serde::decode::Error::InvalidDataRead(ref error),
                    ) if error.kind() == std::io::ErrorKind::UnexpectedEof
                        && bytes.len() < MAX_FRAME_BYTES =>
                    {
                        break;
                    }
                    Err(error) => return Err(PipeProtocolError::MessagePack(error.to_string())),
                }
            }
            if consumed != 0 {
                self.pending.drain(..consumed);
            }
        }
        Ok(messages)
    }

    pub(crate) fn finish(&self) -> Result<(), PipeProtocolError> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err(PipeProtocolError::Invalid("truncated frame at EOF".into()))
        }
    }
}

#[cfg(test)]
mod codec_tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        let hex =
            include_str!("../../../../../../../tests/fixtures/framework_pipe_request.msgpack.hex")
                .trim();
        hex.as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }

    #[test]
    fn python_fixture_fragmentation_coalescing_and_eof() {
        let bytes = fixture();
        let mut stream = bytes.clone();
        stream.extend_from_slice(&bytes);
        for size in [1, 3, stream.len()] {
            let mut decoder = PipeDecoder::default();
            let mut messages = Vec::new();
            for chunk in stream.chunks(size) {
                messages.extend(decoder.feed(chunk).unwrap());
            }
            decoder.finish().unwrap();
            assert_eq!(messages.len(), 2);
            assert_eq!(messages[0].id.as_deref(), Some("cross-language"));
            assert_eq!(messages[0].params.as_ref().unwrap()["path"], "line\nbreak");
        }
        let mut decoder = PipeDecoder::default();
        assert!(decoder.feed(&bytes[..bytes.len() - 1]).unwrap().is_empty());
        assert!(decoder.finish().is_err());
        assert!(PipeDecoder::default().feed(&[0xc1]).is_err());
    }
}
