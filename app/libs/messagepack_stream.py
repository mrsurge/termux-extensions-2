"""Bounded concatenated-object framing for structured process pipes, not PTYs."""
# pyright: strict
from __future__ import annotations

from collections.abc import Iterator
from importlib import import_module
from typing import Protocol, cast

import msgspec

MAX_FRAME_BYTES = 32 * 1024 * 1024


class _Unpacker(Protocol):
    def feed(self, data: bytes) -> None: ...
    def unpack(self) -> object: ...
    def tell(self) -> int: ...


class _Msgpack(Protocol):
    OutOfData: type[Exception]

    def Unpacker(self, *, raw: bool, max_buffer_size: int, strict_map_key: bool) -> _Unpacker: ...


_msgpack = cast(_Msgpack, cast(object, import_module("msgpack")))


def encode_message(value: object) -> bytes:
    data = msgspec.msgpack.encode(value)
    if len(data) > MAX_FRAME_BYTES:
        raise ValueError("MessagePack pipe frame exceeds byte limit")
    return data


class MessagePackStream:
    def __init__(self, limit: int = MAX_FRAME_BYTES) -> None:
        if limit <= 0:
            raise ValueError("MessagePack frame limit must be positive")
        self._limit: int = limit
        self._unpacker: _Unpacker = _msgpack.Unpacker(raw=False, max_buffer_size=limit, strict_map_key=True)
        self._fed: int = 0
        self._boundary: int = 0

    def feed(self, data: bytes) -> Iterator[object]:
        # A real incremental parser retains its state across reads. Bound each
        # feed independently of caller chunking and count bytes since a full object.
        for offset in range(0, len(data), min(65536, self._limit)):
            chunk = data[offset:offset + min(65536, self._limit)]
            self._unpacker.feed(chunk)
            self._fed += len(chunk)
            while True:
                try:
                    value = self._unpacker.unpack()
                except _msgpack.OutOfData:
                    if self._fed - self._boundary > self._limit:
                        raise ValueError("MessagePack pipe frame exceeds byte limit") from None
                    break
                end = self._unpacker.tell()
                if end - self._boundary > self._limit:
                    raise ValueError("MessagePack pipe frame exceeds byte limit")
                self._boundary = end
                yield value

    def finish(self) -> None:
        if self._fed != self._boundary:
            raise ValueError("Truncated MessagePack pipe frame at EOF")
