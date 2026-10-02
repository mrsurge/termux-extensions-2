"""Bounded production intent admission onto the native worker's domain loop."""
from __future__ import annotations

import asyncio
import concurrent.futures
import sys
import threading
from collections.abc import Awaitable, Callable
from typing import cast, final

from app.libs.pipe_protocol import PipeEnvelope, PipeError, PipeIdentity, error_response, success_response


@final
class AppIntentPipe:
    def __init__(self, *, identity: PipeIdentity, reply: Callable[[PipeEnvelope], None],
                 handler: Callable[[PipeEnvelope], Awaitable[object]]) -> None:
        self._identity = identity
        self._reply = reply
        self._handler = handler
        self._lock = threading.RLock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._closed = False
        self._pending: set[concurrent.futures.Future[None]] = set()

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            if self._closed:
                return
            if self._loop is not None:
                raise RuntimeError("App intent loop cannot be rebound")
            self._loop = loop

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._loop = None
            pending = tuple(self._pending)
        for future in pending:
            _ = future.cancel()

    def submit(self, request: PipeEnvelope) -> bool:
        if request.method != "app.intent.deliver":
            return False
        with self._lock:
            loop = self._loop
            if request.origin_nid != 1 or request.origin_name != "framework.rust":
                code = "appIntent.untrustedOrigin"
            elif request.target_name not in (None, "", self._identity.name) or request.target_nid not in (None, self._identity.nid):
                code = "protocol.wrongTarget"
            elif not request.id or request.correlation_id != request.id or not request.op_id:
                code = "appIntent.invalidCorrelation"
            elif self._closed or loop is None or not loop.is_running():
                code = "appIntent.unavailable"
            elif len(self._pending) >= 16:
                code = "appIntent.busy"
            else:
                operation = self._run(request)
                try:
                    future = asyncio.run_coroutine_threadsafe(operation, loop)
                except RuntimeError:
                    operation.close()
                    code = "appIntent.unavailable"
                else:
                    self._pending.add(future)
                    future.add_done_callback(self._finished)
                    return True
        self._reply(error_response(request, self._identity, PipeError(code, code, False)))
        return True

    def _finished(self, future: concurrent.futures.Future[None]) -> None:
        with self._lock:
            self._pending.discard(future)
        if not future.cancelled() and future.exception() is not None:
            print("[app-intent] reply failed; operation is not replayed", file=sys.stderr)

    async def _run(self, request: PipeEnvelope) -> None:
        try:
            result = await self._handler(request)
            response = success_response(request, self._identity, result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            response = error_response(request, self._identity, PipeError(
                "appIntent.failed", f"{type(exc).__name__}: {str(exc)[:1024]}", False,
            ))
        # Never write the framework pipe on the domain event loop.
        await asyncio.to_thread(self._reply, response)


def _object(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    raw = cast(dict[object, object], value)
    if not all(isinstance(key, str) for key in raw):
        raise ValueError(f"{name} keys must be strings")
    return cast(dict[str, object], value)


async def dispatch_app_intent(request: PipeEnvelope) -> object:
    params = _object(request.params, "params")
    if set(params) != {"intent", "context", "payload", "source"}:
        raise ValueError("invalid app intent parameters")
    source = _object(params["source"], "source")
    app_id = source.get("appId")
    shell_id = source.get("shellId")
    if not isinstance(app_id, str) or not isinstance(shell_id, str) or not shell_id:
        raise ValueError("missing framework-derived source")
    if params["intent"] not in {"document.open", "sidebar.openApp", "terminal.createSession"}:
        raise ValueError("app intent is not implemented")
    if app_id not in {"file_explorer", "file_editor", "terminal"}:
        raise ValueError("embedded app caller is not allowed")
    if params["intent"] == "document.open" and app_id not in {"file_explorer", "file_editor"}:
        raise ValueError("document open caller is not allowed")
    context = _object(params["context"], "context")
    if set(context) != {"clientId", "hostId", "presentationId"}:
        raise ValueError("app intent requires exact presentation context")
    payload = dict(_object(params["payload"], "payload"))
    if params["intent"] == "terminal.createSession":
        if set(payload) != {"directory", "destination"} or not all(isinstance(value, str) for value in payload.values()):
            raise ValueError("invalid terminal intent payload")
        from .ui_ipc.sidebar_ws import resolve_sidebar_request_client
        from .host.terminal_intent_backend import open_directory_terminal
        client_id, _ = resolve_sidebar_request_client(
            {"target": context}, requester_app_id=app_id, require_presentation=True,
        )
        return await open_directory_terminal(
            directory=cast(str, payload["directory"]), destination=cast(str, payload["destination"]),
            client_id=client_id, operation_id=request.op_id or "",
            source_context=context, requester_app_id=app_id,
        )
    if params["intent"] == "sidebar.openApp":
        if set(payload) != {"appId", "params"}:
            raise ValueError("invalid app open payload")
        target_app = payload["appId"]
        if not isinstance(target_app, str) or not target_app:
            raise ValueError("appId is required")
        from .ui_ipc.sidebar_ws import resolve_sidebar_request_client
        from .host.sidebar_app_backend import open_sidebar_app
        client_id, _ = resolve_sidebar_request_client(
            {"target": context}, requester_app_id=app_id, require_presentation=True,
        )
        return await open_sidebar_app(
            app_id=target_app, params=_object(payload["params"], "launch params"),
            client_id=client_id, operation_id=request.op_id or "",
            source_context=context, requester_app_id=app_id,
        )
    if "target" in payload:
        raise ValueError("document target belongs in context")
    payload["target"] = dict(context)
    payload["request_id"] = request.op_id
    from .ui_ipc.sidebar_ws import handle_sidebar_document_open
    return await handle_sidebar_document_open(payload, requester_app_id=app_id,
                                             require_presentation=True)
