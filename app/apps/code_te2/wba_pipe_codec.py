"""WBA control-pipe codec seam; domain RPC/event policy stays in Python.

The independent native worker configures its Rust codec before importing domain
modules. Interpreted tests/tools retain the established bounded Python codec.
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol


class WbaStream(Protocol):
    def feed(self, data: bytes) -> Iterable[object]: ...
    def finish(self) -> None: ...


class NativeWbaCodec(Protocol):
    def wba_stream(self) -> WbaStream: ...
    def wba_encode(self, value: object) -> bytes: ...


_native: NativeWbaCodec | None = None


def configure_native(bridge: NativeWbaCodec) -> None:
    global _native
    _native = bridge


def new_stream() -> WbaStream:
    if _native is not None:
        return _native.wba_stream()
    from app.libs.messagepack_stream import MessagePackStream

    return MessagePackStream()


def encode_message(value: object) -> bytes:
    if _native is not None:
        return _native.wba_encode(value)
    from app.libs.messagepack_stream import encode_message as encode_reference

    return encode_reference(value)
