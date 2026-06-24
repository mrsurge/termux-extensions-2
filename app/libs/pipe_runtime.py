from __future__ import annotations

import asyncio
import inspect
import itertools
import os
import threading
from collections.abc import Callable
from typing import Any

from app.libs.pipe_protocol import (
    PipeEnvelope,
    PipeError,
    PipeIdentity,
    error_response,
    success_response,
)

PipeDispatcher = Callable[[PipeEnvelope], Any]

_LOCK = threading.RLock()
_COUNTER = itertools.count(1)
_DISPATCHER: PipeDispatcher | None = None
_IDENTITY: PipeIdentity | None = None


class PipeRuntimeError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "pipe.error",
        retryable: bool = False,
        details: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.details = details


def configure(dispatcher: PipeDispatcher, identity: PipeIdentity | None = None) -> None:
    if not callable(dispatcher):
        raise TypeError("pipe dispatcher must be callable")
    responder = identity or PipeIdentity.from_env()
    with _LOCK:
        global _DISPATCHER, _IDENTITY
        _DISPATCHER = dispatcher
        _IDENTITY = responder


def configured_identity() -> PipeIdentity:
    with _LOCK:
        if _IDENTITY is None:
            raise PipeRuntimeError("Pipe runtime is not configured", code="pipe.notConfigured")
        return _IDENTITY


def call(
    method: str,
    params: Any | None = None,
    *,
    target_name: str | None = None,
    target_nid: int | None = None,
    workspace_root: str | None = None,
    project_generation: int | None = None,
    origin_name: str | None = None,
    origin_nid: int = 1100,
    correlation_id: str | None = None,
    op_id: str | None = None,
) -> Any:
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
    response = dispatch_request(request)
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


async def call_async(method: str, params: Any | None = None, **kwargs: Any) -> Any:
    return await asyncio.to_thread(call, method, params, **kwargs)


def dispatch_request(request: PipeEnvelope) -> PipeEnvelope:
    with _LOCK:
        dispatcher = _DISPATCHER
        responder = _IDENTITY
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
            result = asyncio.run(result)
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


def _next_request_id() -> str:
    app_id = str(os.environ.get("TE_APP_ID") or "app").strip() or "app"
    return f"{app_id}:pipe:{os.getpid()}:{next(_COUNTER)}"


def _default_origin_name() -> str:
    app_id = str(os.environ.get("TE_APP_ID") or "app").strip() or "app"
    return f"{app_id}.backend"
