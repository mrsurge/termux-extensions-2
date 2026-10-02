"""Synchronous decoded-envelope delivery, independent of stdin or a wire codec."""
from __future__ import annotations

from collections.abc import Callable
from typing import Protocol, final

from app.libs.pipe_protocol import PipeEnvelope, PipeError, PipeIdentity, process_error_response


class RequestAdmission(Protocol):
    def submit(self, request: PipeEnvelope) -> bool: ...


@final
class InboundEnvelopeRouter:
    """Route one validated envelope without queues, retries or background dispatch.

    The reader owns decoding and stream shutdown. Production/debug adapters own
    bounded admission and execution; other callbacks run synchronously.
    """

    def __init__(
        self, *, identity: PipeIdentity,
        accept_response: Callable[[PipeEnvelope], bool],
        accept_notification: Callable[[PipeEnvelope], bool],
        dispatch: Callable[[PipeEnvelope], PipeEnvelope],
        reply: Callable[[PipeEnvelope], None],
        report: Callable[[str], None],
        debug: RequestAdmission | None = None,
        production: RequestAdmission | None = None,
    ) -> None:
        self._identity = identity
        self._accept_response = accept_response
        self._accept_notification = accept_notification
        self._dispatch = dispatch
        self._reply = reply
        self._report = report
        self._debug = debug
        self._production = production

    def deliver(self, envelope: PipeEnvelope) -> None:
        if envelope.kind in {"response", "error"}:
            if not self._accept_response(envelope):
                self._report(f"[app-worker] Unmatched pipe response id={envelope.id!r}")
            return
        if envelope.kind in {"notification", "progress"}:
            if not self._accept_notification(envelope):
                self._report(f"[app-worker] Unhandled pipe notification method={envelope.method!r}")
            return
        if envelope.kind != "request":
            self._reply(process_error_response(self._identity, PipeError(
                "protocol.expectedRequest",
                "pipe worker only accepts request/response/error envelopes",
                False,
            )))
            return
        if self._debug is not None and self._debug.submit(envelope):
            return
        if self._production is not None and self._production.submit(envelope):
            return
        self._reply(self._dispatch(envelope))
