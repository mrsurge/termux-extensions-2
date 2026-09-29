"""Python wire adapter for pipe DTOs; imported only when conversion is used.

Structural DTOs remain msgspec Structs for compatibility. This seam removes the
eager stream-codec import, not the worker's msgspec dependency.
"""
from __future__ import annotations

import msgspec

from .pipe_dto import PipeEnvelope, PipeProtocolError, validate_envelope


def decode_envelope(value: object) -> PipeEnvelope:
    try:
        envelope = msgspec.convert(value, type=PipeEnvelope, strict=True)
    except msgspec.ValidationError as exc:
        raise PipeProtocolError(f"invalid MessagePack envelope: {exc}") from exc
    validate_envelope(envelope)
    return envelope


def encode_frame(envelope: PipeEnvelope) -> bytes:
    from .messagepack_stream import encode_message

    validate_envelope(envelope)
    return encode_message(envelope)
