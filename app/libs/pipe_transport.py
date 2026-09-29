"""Envelope transport seam; no request correlation or application dispatch.

The runtime serializes calls to write. The stdio adapter borrows its stream: it
does not close process stdout, own the reader, or retry a partially written frame.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from app.libs.pipe_protocol import PipeEnvelope, encode_frame


class PipeWriter(Protocol):
    def write(self, data: bytes) -> object: ...

    def flush(self) -> object: ...


class EnvelopeTransport(Protocol):
    def write(
        self, envelope: PipeEnvelope, before_write: Callable[[], None] | None = None,
    ) -> None:
        """Write once; call before_write immediately before exposing the frame.

        The caller holds the shared writer lock. Implementations must not invoke
        application dispatch or await a response here. Errors propagate unchanged.
        """
        ...


class StdioEnvelopeTransport:
    def __init__(self, writer: PipeWriter) -> None:
        self._writer: PipeWriter = writer

    def write(
        self, envelope: PipeEnvelope, before_write: Callable[[], None] | None = None,
    ) -> None:
        payload = encode_frame(envelope)
        if before_write is not None:
            before_write()
        _ = self._writer.write(payload)
        _ = self._writer.flush()
