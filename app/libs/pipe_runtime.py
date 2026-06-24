from __future__ import annotations

import asyncio
import inspect
import itertools
import os
import queue
import threading
from collections.abc import Awaitable, Callable
from typing import Protocol, cast

from app.libs.pipe_protocol import (
    PipeEnvelope,
    PipeError,
    PipeIdentity,
    encode_line,
    error_response,
    success_response,
)

PipeDispatcher = Callable[[PipeEnvelope], object]
PipeNotificationQueue = queue.Queue[PipeEnvelope]
PipeNotificationListener = tuple[PipeNotificationQueue, set[str] | None]


class PipeWriter(Protocol):
    def write(self, data: bytes) -> object: ...

    def flush(self) -> object: ...


_lock = threading.RLock()
_counter = itertools.count(1)
_dispatcher: PipeDispatcher | None = None
_identity: PipeIdentity | None = None
_transport_writer: PipeWriter | None = None
_write_lock = threading.Lock()
_pending: dict[str, queue.Queue[PipeEnvelope]] = {}
_notification_listeners: list[PipeNotificationListener] = []


class PipeRuntimeError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "pipe.error",
        retryable: bool = False,
        details: object | None = None,
    ) -> None:
        super().__init__(message)
        self.code: str = code
        self.retryable: bool = retryable
        self.details: object | None = details


def configure(dispatcher: PipeDispatcher, identity: PipeIdentity | None = None) -> None:
    responder = identity or PipeIdentity.from_env()
    with _lock:
        global _dispatcher, _identity
        _dispatcher = dispatcher
        _identity = responder


def configure_stdio_transport(protocol_stdout: object) -> None:
    """Attach the worker stdio pipe used for app-origin framework service calls."""
    writer = getattr(protocol_stdout, "buffer", protocol_stdout)
    with _lock:
        global _transport_writer
        _transport_writer = cast(PipeWriter, writer)


def configured_identity() -> PipeIdentity:
    with _lock:
        if _identity is None:
            raise PipeRuntimeError("Pipe runtime is not configured", code="pipe.notConfigured")
        return _identity


def call(
    method: str,
    params: object | None = None,
    *,
    target_name: str | None = None,
    target_nid: int | None = None,
    workspace_root: str | None = None,
    project_generation: int | None = None,
    origin_name: str | None = None,
    origin_nid: int = 1100,
    correlation_id: str | None = None,
    op_id: str | None = None,
    timeout_seconds: float | None = None,
) -> object:
    method = str(method or "").strip()
    if not method:
        raise PipeRuntimeError("Pipe method is required", code="pipe.methodRequired")
    identity = configured_identity()
    request = PipeEnvelope(
        kind="request",
        id=_next_request_id(),
        method=method,
        origin_nid=origin_nid,
        origin_name=origin_name or _default_origin_name(),
        target_nid=target_nid if target_nid is not None else identity.nid,
        target_name=target_name or identity.name,
        project_generation=project_generation,
        workspace_root=workspace_root,
        correlation_id=correlation_id,
        op_id=op_id,
        params=params,
    )
    response = _send_outbound_request(request, timeout_seconds=timeout_seconds)
    if response.id != request.id:
        raise PipeRuntimeError("Pipe response id mismatch", code="pipe.responseIdMismatch")
    if response.kind == "response":
        return response.result
    if response.kind == "error" and response.error is not None:
        raise PipeRuntimeError(
            response.error.message,
            code=response.error.code,
            retryable=response.error.retryable,
            details=response.error.details,
        )
    raise PipeRuntimeError("Pipe returned a non-response frame", code="pipe.invalidResponse")


async def call_async(
    method: str,
    params: object | None = None,
    *,
    target_name: str | None = None,
    target_nid: int | None = None,
    workspace_root: str | None = None,
    project_generation: int | None = None,
    origin_name: str | None = None,
    origin_nid: int = 1100,
    correlation_id: str | None = None,
    op_id: str | None = None,
    timeout_seconds: float | None = None,
) -> object:
    return await asyncio.to_thread(
        call,
        method,
        params,
        target_name=target_name,
        target_nid=target_nid,
        workspace_root=workspace_root,
        project_generation=project_generation,
        origin_name=origin_name,
        origin_nid=origin_nid,
        correlation_id=correlation_id,
        op_id=op_id,
        timeout_seconds=timeout_seconds,
    )


def accept_response(envelope: PipeEnvelope) -> bool:
    """Resolve one pending app-origin request from an inbound response frame."""
    if envelope.kind not in {"response", "error"}:
        return False
    request_id = str(envelope.id or "")
    if not request_id:
        return False
    with _lock:
        pending = _pending.get(request_id)
    if pending is None:
        return False
    pending.put(envelope)
    return True


def add_notification_listener(
    event_queue: PipeNotificationQueue,
    *,
    methods: set[str] | None = None,
) -> PipeNotificationListener:
    method_filter = {method for method in (methods or set()) if method}
    listener: PipeNotificationListener = (event_queue, method_filter or None)
    with _lock:
        _notification_listeners.append(listener)
    return listener


def remove_notification_listener(listener: PipeNotificationListener) -> None:
    with _lock:
        if listener in _notification_listeners:
            _notification_listeners.remove(listener)


def accept_notification(envelope: PipeEnvelope) -> bool:
    """Fan out one inbound framework-origin notification to local listeners."""
    if envelope.kind not in {"notification", "progress"}:
        return False
    method = str(envelope.method or "")
    delivered = False
    with _lock:
        listeners = list(_notification_listeners)
    for event_queue, method_filter in listeners:
        if method_filter is not None and method not in method_filter:
            continue
        try:
            event_queue.put_nowait(envelope)
            delivered = True
        except Exception:
            continue
    return delivered


def dispatch_request(request: PipeEnvelope) -> PipeEnvelope:
    with _lock:
        dispatcher = _dispatcher
        responder = _identity
    if dispatcher is None or responder is None:
        return _process_error(PipeError("pipe.notConfigured", "Pipe runtime is not configured", False))
    if request.kind != "request":
        return error_response(
            request,
            responder,
            PipeError("protocol.expectedRequest", "pipe runtime only accepts request envelopes", False),
        )
    target_error = _target_mismatch(request, responder)
    if target_error is not None:
        return error_response(request, responder, target_error)
    try:
        result = dispatcher(request)
        if inspect.isawaitable(result):
            result = asyncio.run(_await_result(cast(Awaitable[object], result)))
        if result is None:
            return error_response(
                request,
                responder,
                PipeError(
                    "protocol.methodNotFound",
                    f"Method not found: {request.method or '<missing>'}",
                    False,
                ),
            )
        if isinstance(result, PipeEnvelope):
            return result
        return success_response(request, responder, result)
    except Exception as exc:
        return error_response(
            request,
            responder,
            PipeError("protocol.dispatchFailed", str(exc), True),
        )


async def _await_result(value: Awaitable[object]) -> object:
    return await value


def _target_mismatch(request: PipeEnvelope, responder: PipeIdentity) -> PipeError | None:
    target_name = str(request.target_name or "").strip()
    if target_name and target_name != responder.name:
        return PipeError(
            "protocol.wrongTarget",
            f"request targeted {target_name!r}, but this pipe is {responder.name!r}",
            False,
            {
                "expectedName": responder.name,
                "actualName": target_name,
                "expectedNid": responder.nid,
                "actualNid": request.target_nid,
            },
        )
    target_nid = request.target_nid
    if target_nid is not None and target_nid != responder.nid:
        return PipeError(
            "protocol.wrongTarget",
            f"request targeted NID {target_nid}, but this pipe is NID {responder.nid}",
            False,
            {
                "expectedName": responder.name,
                "actualName": target_name or None,
                "expectedNid": responder.nid,
                "actualNid": target_nid,
            },
        )
    return None


def _process_error(error: PipeError) -> PipeEnvelope:
    return PipeEnvelope(
        kind="error",
        origin_nid=0,
        origin_name="pipe.runtime",
        error=error,
    )


def _send_outbound_request(
    request: PipeEnvelope,
    *,
    timeout_seconds: float | None,
) -> PipeEnvelope:
    request_id = str(request.id or "")
    if not request_id:
        raise PipeRuntimeError("Pipe request id is required", code="pipe.requestIdRequired")
    with _lock:
        writer = _transport_writer
        if writer is None:
            raise PipeRuntimeError(
                "Outbound pipe transport is not configured",
                code="pipe.transportNotConfigured",
            )
        pending: queue.Queue[PipeEnvelope] = queue.Queue(maxsize=1)
        _pending[request_id] = pending
    try:
        payload = encode_line(request)
        with _write_lock:
            _ = writer.write(payload)
            _ = writer.flush()
        timeout = _response_timeout(timeout_seconds)
        try:
            response = pending.get(timeout=timeout)
        except queue.Empty as exc:
            raise PipeRuntimeError(
                f"Pipe response timed out after {timeout:.1f}s",
                code="pipe.responseTimeout",
                retryable=True,
            ) from exc
        return response
    except PipeRuntimeError:
        raise
    except Exception as exc:
        raise PipeRuntimeError(
            f"Pipe transport write failed: {exc}",
            code="pipe.transportWriteFailed",
            retryable=True,
        ) from exc
    finally:
        with _lock:
            _ = _pending.pop(request_id, None)


def _response_timeout(timeout_seconds: float | None) -> float:
    if timeout_seconds is not None and timeout_seconds > 0:
        return timeout_seconds
    raw = str(os.environ.get("TE_PIPE_RESPONSE_TIMEOUT_SECONDS") or "").strip()
    if raw:
        try:
            parsed = float(raw)
        except ValueError:
            parsed = 0.0
        if parsed > 0:
            return parsed
    return 30.0


def _next_request_id() -> str:
    app_id = str(os.environ.get("TE_APP_ID") or "app").strip() or "app"
    return f"{app_id}:pipe:{os.getpid()}:{next(_counter)}"


def _default_origin_name() -> str:
    app_id = str(os.environ.get("TE_APP_ID") or "app").strip() or "app"
    return f"{app_id}.backend"
