"""WBA control-pipe codec seam; domain RPC/event policy stays in Python.

The independent native worker configures its Rust codec before importing domain
modules. Interpreted tests/tools retain the established bounded Python codec.
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol

import msgspec


class WbaStream(Protocol):
    def feed(self, data: bytes) -> Iterable[object]: ...
    def finish(self) -> None: ...


class OutputSource(Protocol):
    async def get(self) -> bytes: ...


class NativeWbaStream(Protocol):
    def feed_frames(self, data: bytes) -> Iterable[bytes]: ...
    def finish(self) -> None: ...


class NativeWbaCodec(Protocol):
    def wba_stream(self) -> NativeWbaStream: ...
    def wba_encode(self, value: object) -> bytes: ...


_native: NativeWbaCodec | None = None
_record_decoder = msgspec.msgpack.Decoder(object)


class _NativeStream:
    def __init__(self, stream: NativeWbaStream) -> None:
        feed_frames: object = getattr(stream, "feed_frames", None)
        if not callable(feed_frames):
            raise RuntimeError("Native WBA codec lacks feed_frames; rebuild the matching Code TE2 worker")
        self._stream = stream

    def feed(self, data: bytes) -> list[object]:
        # Rust owns bounded frame/key/depth/node admission. Decode the original
        # bytes here; existing domain owners still validate record/payload/kind.
        return [_record_decoder.decode(frame) for frame in self._stream.feed_frames(data)]

    def finish(self) -> None:
        self._stream.finish()


def configure_native(bridge: NativeWbaCodec) -> None:
    global _native
    _native = bridge


def new_stream() -> WbaStream:
    if _native is not None:
        return _NativeStream(_native.wba_stream())
    from app.libs.messagepack_stream import MessagePackStream

    return MessagePackStream()


def encode_message(value: object) -> bytes:
    if _native is not None:
        return _native.wba_encode(value)
    from app.libs.messagepack_stream import encode_message as encode_reference

    return encode_reference(value)
