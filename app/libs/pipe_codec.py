"""Python wire adapter for pipe DTOs; imported only when conversion is used.

Structural DTOs remain msgspec Structs for compatibility. This seam removes the
eager stream-codec import, not the worker's msgspec dependency.
"""
from __future__ import annotations

import msgspec

from .pipe_dto import PipeEnvelope, PipeProtocolError, validate_envelope

_envelope_decoder = msgspec.msgpack.Decoder(PipeEnvelope, strict=True)


def decode_envelope_bytes(frame: bytes) -> PipeEnvelope:
    """Decode a single frame already admitted by the bounded native decoder.

    Native ingress owns stream/key/depth/node/marker guards. On schema rejection
    only, retain the graph converter's precise error wording (e.g. null vs None).
    This does not dispatch, retry a request or select another transport.
    """
    try:
        envelope = _envelope_decoder.decode(frame)
    except msgspec.ValidationError:
        return decode_envelope(msgspec.msgpack.decode(frame, type=object))
    except msgspec.DecodeError as exc:
        raise PipeProtocolError(f"invalid MessagePack envelope: {exc}") from exc
    validate_envelope(envelope)
    return envelope


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
