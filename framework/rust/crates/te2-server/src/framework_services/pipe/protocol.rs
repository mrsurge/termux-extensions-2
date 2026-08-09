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
    Json(String),
    Invalid(String),
}

impl fmt::Display for PipeProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(message) => write!(formatter, "json parse error: {message}"),
            Self::Invalid(message) => write!(formatter, "invalid pipe envelope: {message}"),
        }
    }
}

impl std::error::Error for PipeProtocolError {}

pub(crate) fn decode_line(raw: &str) -> Result<PipeEnvelope, PipeProtocolError> {
    let trimmed = raw.trim_end_matches(['\r', '\n']);
    let envelope = serde_json::from_str::<PipeEnvelope>(trimmed)
        .map_err(|error| PipeProtocolError::Json(error.to_string()))?;
    envelope.validate_basic()?;
    Ok(envelope)
}

pub(crate) fn encode_line(envelope: &PipeEnvelope) -> Result<String, PipeProtocolError> {
    envelope.validate_basic()?;
    let encoded = serde_json::to_string(envelope)
        .map_err(|error| PipeProtocolError::Json(error.to_string()))?;
    Ok(format!("{encoded}\n"))
}
