from collections.abc import Mapping
import struct
from typing import cast, final

import msgspec


TERMINAL_STREAM_CODEC = "msgpack-v1"
MAX_TERMINAL_FRAME_BYTES = 32 * 1024 * 1024
PIPE_FRAME_HEADER = struct.Struct(">I")

JsonObject = dict[str, object]
_ENCODER = msgspec.msgpack.Encoder()
_DECODER = msgspec.msgpack.Decoder(object)


def _as_object(raw: object) -> JsonObject | None:
    if not isinstance(raw, Mapping):
        return None
    payload: JsonObject = {}
    for key, value in cast(Mapping[object, object], raw).items():
        if isinstance(key, str):
            payload[key] = value
    return payload


def pack_message(payload: Mapping[str, object]) -> bytes:
    encoded = _ENCODER.encode(dict(payload))
    if len(encoded) > MAX_TERMINAL_FRAME_BYTES:
        raise ValueError("Terminal message exceeds the configured frame limit")
    return encoded


def unpack_message(payload: bytes) -> JsonObject:
    if not payload or len(payload) > MAX_TERMINAL_FRAME_BYTES:
        raise ValueError("Invalid terminal MessagePack payload size")
    try:
        decoded = _DECODER.decode(payload)
    except msgspec.DecodeError as exc:
        raise ValueError("Invalid terminal MessagePack payload") from exc
    message = _as_object(decoded)
    if message is None:
        raise ValueError("Terminal MessagePack payload must be an object")
    return message


def encode_pipe_message(payload: Mapping[str, object]) -> bytes:
    encoded = pack_message(payload)
    return PIPE_FRAME_HEADER.pack(len(encoded)) + encoded


@final
class PipeFrameDecoder:
    def __init__(self, max_frame_bytes: int = MAX_TERMINAL_FRAME_BYTES) -> None:
        self._buffer: bytearray = bytearray()
        self._max_frame_bytes: int = max_frame_bytes

    def push(self, chunk: bytes | bytearray) -> list[JsonObject]:
        self._buffer.extend(chunk)
        messages: list[JsonObject] = []
        while len(self._buffer) >= PIPE_FRAME_HEADER.size:
            (payload_length,) = cast(
                tuple[int],
                PIPE_FRAME_HEADER.unpack_from(self._buffer),
            )
            if payload_length <= 0 or payload_length > self._max_frame_bytes:
                raise ValueError(f"Invalid terminal pipe frame length: {payload_length}")
            frame_length = PIPE_FRAME_HEADER.size + payload_length
            if len(self._buffer) < frame_length:
                break
            payload = bytes(self._buffer[PIPE_FRAME_HEADER.size:frame_length])
            del self._buffer[:frame_length]
            messages.append(unpack_message(payload))
        return messages
