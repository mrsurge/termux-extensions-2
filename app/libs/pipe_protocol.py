"""Public pipe API; DTO imports do not initialize the Python stream codec."""
from __future__ import annotations

from .pipe_dto import (
    JSONRPC_VERSION as JSONRPC_VERSION,
    PROTOCOL_VERSION as PROTOCOL_VERSION,
    PipeEnvelope as PipeEnvelope,
    PipeError as PipeError,
    PipeIdentity as PipeIdentity,
    PipeProtocolError as PipeProtocolError,
    error_response as error_response,
    process_error_response as process_error_response,
    success_response as success_response,
    validate_envelope as validate_envelope,
)


def decode_envelope(value: object) -> PipeEnvelope:
    from .pipe_codec import decode_envelope as decode

    return decode(value)


def encode_frame(envelope: PipeEnvelope) -> bytes:
    from .pipe_codec import encode_frame as encode

    return encode(envelope)
