from __future__ import annotations

import os
from typing import Any

import msgspec

JSONRPC_VERSION = "2.0"
PROTOCOL_VERSION = 1


class PipeError(msgspec.Struct, rename="camel"):
    code: str
    message: str
    retryable: bool = False
    details: Any | None = None


class PipeIdentity(msgspec.Struct, rename="camel"):
    nid: int
    name: str

    @classmethod
    def from_env(cls) -> "PipeIdentity":
        raw_nid = str(os.environ.get("TE_PIPE_NID") or "2100").strip()
        try:
            nid = int(raw_nid)
        except ValueError:
            nid = 2100
        name = str(os.environ.get("TE_PIPE_NAME") or "service.app").strip() or "service.app"
        return cls(nid=nid, name=name)


class PipeEnvelope(msgspec.Struct, rename="camel"):
    jsonrpc: str = JSONRPC_VERSION
    protocol_version: int = PROTOCOL_VERSION
    kind: str = ""
    id: str | None = None
    method: str | None = None
    origin_nid: int = 0
    origin_name: str = ""
    target_nid: int | None = None
    target_name: str | None = None
    project_generation: int | None = None
    workspace_root: str | None = None
    correlation_id: str | None = None
    op_id: str | None = None
    sequence: int | None = None
    params: Any | None = None
    result: Any | None = None
    error: PipeError | None = None
    reason: str | None = None


class PipeProtocolError(ValueError):
    pass


_DECODER = msgspec.json.Decoder(PipeEnvelope)
_ENCODER = msgspec.json.Encoder()


def validate_envelope(envelope: PipeEnvelope) -> None:
    if envelope.jsonrpc != JSONRPC_VERSION:
        raise PipeProtocolError(f"jsonrpc must be {JSONRPC_VERSION}")
    if envelope.protocol_version != PROTOCOL_VERSION:
        raise PipeProtocolError(f"unsupported protocolVersion {envelope.protocol_version}")
    if envelope.kind == "request":
        if not envelope.id:
            raise PipeProtocolError("request id is required")
        if not envelope.method:
            raise PipeProtocolError("request method is required")


def decode_line(raw: bytes | bytearray | memoryview | str) -> PipeEnvelope:
    data = raw.encode("utf-8") if isinstance(raw, str) else bytes(raw)
    data = data.rstrip(b"\r\n")
    if not data.strip():
        raise PipeProtocolError("empty pipe frame")
    try:
        envelope = _DECODER.decode(data)
    except msgspec.ValidationError as exc:
        raise PipeProtocolError(f"json parse error: {exc}") from exc
    validate_envelope(envelope)
    return envelope


def encode_line(envelope: PipeEnvelope) -> bytes:
    validate_envelope(envelope)
    return _ENCODER.encode(envelope) + b"\n"


def success_response(
    request: PipeEnvelope,
    responder: PipeIdentity,
    result: Any,
) -> PipeEnvelope:
    return PipeEnvelope(
        kind="response",
        id=request.id,
        origin_nid=responder.nid,
        origin_name=responder.name,
        target_nid=request.origin_nid,
        target_name=request.origin_name,
        project_generation=request.project_generation,
        workspace_root=request.workspace_root,
        correlation_id=request.correlation_id,
        op_id=request.op_id,
        result=result,
    )


def error_response(
    request: PipeEnvelope,
    responder: PipeIdentity,
    error: PipeError,
) -> PipeEnvelope:
    return PipeEnvelope(
        kind="error",
        id=request.id,
        origin_nid=responder.nid,
        origin_name=responder.name,
        target_nid=request.origin_nid,
        target_name=request.origin_name,
        project_generation=request.project_generation,
        workspace_root=request.workspace_root,
        correlation_id=request.correlation_id,
        op_id=request.op_id,
        error=error,
    )


def process_error_response(responder: PipeIdentity, error: PipeError) -> PipeEnvelope:
    return PipeEnvelope(
        kind="error",
        origin_nid=responder.nid,
        origin_name=responder.name,
        error=error,
    )
