# pyright: strict
from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING, cast

from .rpc_contract import (
    ExplorerRpcProtocolError,
    JsonRpcErrorEnvelope,
    JsonRpcSuccessEnvelope,
    build_default_jsonrpc_success,
    build_jsonrpc_error,
    build_jsonrpc_result,
    dispatcher_message_type_from_rpc_method,
    normalize_payload,
    parse_explorer_rpc_request,
)
from ...explorer_runtime import ExplorerDispatcher

logger = logging.getLogger(__name__)


if TYPE_CHECKING:
    class _SocketIOAsyncNamespace:
        def __init__(self, namespace: str = "/rpc/explorer") -> None: ...

        async def emit(
            self,
            event: str,
            data: object,
            *,
            room: str | None = None,
            namespace: str | None = None,
        ) -> None: ...
else:
    import socketio

    _SocketIOAsyncNamespace = socketio.AsyncNamespace


class ExplorerRpcSocketShim:
    """Adapt ConnectionManager sends into JSON-RPC notifications and ack replies."""

    def __init__(self, namespace: _SocketIOAsyncNamespace, sid: str):
        self.namespace = namespace
        self.sid = sid
        self._pending_requests: dict[str, asyncio.Future[dict[str, object]]] = {}

    async def accept(self) -> None:
        return

    def open_request(self, request_id: str) -> asyncio.Future[dict[str, object]]:
        future: asyncio.Future[dict[str, object]] = asyncio.get_running_loop().create_future()
        self._pending_requests[request_id] = future
        return future

    def finish_request(self, request_id: str) -> None:
        self._pending_requests.pop(request_id, None)

    def complete_rpc_request(self, request_id: str, result: dict[str, object]) -> bool:
        pending = self._pending_requests.pop(request_id, None)
        if pending is None or pending.done():
            return False
        pending.set_result({"kind": "result", "result": result})
        return True

    def fail_rpc_request(
        self,
        request_id: str,
        message: str,
        data: dict[str, object] | None = None,
    ) -> bool:
        pending = self._pending_requests.pop(request_id, None)
        if pending is None or pending.done():
            return False
        payload: dict[str, object] = {"kind": "error", "message": message}
        if data:
            payload["data"] = data
        pending.set_result(payload)
        return True

    def cancel_pending(self, reason: str) -> None:
        error = RuntimeError(reason)
        pending = list(self._pending_requests.values())
        self._pending_requests.clear()
        for future in pending:
            if future.done():
                continue
            future.set_exception(error)

    async def send_text(self, data: str) -> None:
        try:
            loaded = cast(object, json.loads(data))
        except json.JSONDecodeError:
            return
        if not isinstance(loaded, dict):
            return
        payload = {
            key: value
            for key, value in cast(dict[object, object], loaded).items()
            if isinstance(key, str)
        }

        if payload.get("jsonrpc") == "2.0":
            request_id = payload.get("id")
            if isinstance(request_id, str):
                pending = self._pending_requests.pop(request_id, None)
                if pending is not None and not pending.done():
                    pending.set_result(payload)
                    return
            method = payload.get("method")
            if isinstance(method, str) and method:
                await self.namespace.emit("rpc.notify", payload, room=self.sid)


class ExplorerRpcSocketIONamespace(_SocketIOAsyncNamespace):
    def __init__(self, namespace: str = "/rpc/explorer"):
        super().__init__(namespace)
        self.dispatchers: dict[str, ExplorerDispatcher] = {}
        self.rpc_sockets: dict[str, ExplorerRpcSocketShim] = {}

    async def on_connect(self, sid: str, environ: dict[str, object]) -> None:
        rpc_socket = ExplorerRpcSocketShim(self, sid)
        dispatcher = ExplorerDispatcher(rpc_socket)
        await dispatcher.initialize()
        self.rpc_sockets[sid] = rpc_socket
        self.dispatchers[sid] = dispatcher
        logger.info("[ExplorerRPC] client connected sid=%s", sid)

    async def on_disconnect(self, sid: str, reason: str | None = None) -> None:
        rpc_socket = self.rpc_sockets.pop(sid, None)
        if rpc_socket is not None:
            rpc_socket.cancel_pending(f"Explorer RPC disconnected: {reason or 'disconnect'}")
        disp = self.dispatchers.pop(sid, None)
        if disp:
            await disp.cleanup()
        logger.info("[ExplorerRPC] client disconnected sid=%s reason=%s", sid, reason)

    async def on_rpc(
        self,
        sid: str,
        data: object,
    ) -> JsonRpcSuccessEnvelope | JsonRpcErrorEnvelope | None:
        disp = self.dispatchers.get(sid)
        rpc_socket = self.rpc_sockets.get(sid)
        if disp is None or rpc_socket is None:
            return build_jsonrpc_error(
                request_id=None,
                code=-32000,
                message="Explorer RPC session not ready",
            )

        try:
            parsed = parse_explorer_rpc_request(data)
            message_type = dispatcher_message_type_from_rpc_method(parsed["method"])
        except ExplorerRpcProtocolError as exc:
            return exc.to_json()

        request_id = parsed["request_id"]
        pending_reply = rpc_socket.open_request(request_id) if request_id is not None else None

        try:
            await disp.dispatch_message(message_type, parsed["params"], request_id)
        except Exception as exc:
            logger.exception("[ExplorerRPC] handler failure sid=%s method=%s", sid, parsed["method"])
            if request_id is None:
                return None
            rpc_socket.finish_request(request_id)
            return build_jsonrpc_error(
                request_id=request_id,
                code=-32603,
                message=str(exc),
            )

        if request_id is None:
            return None

        if pending_reply is None:
            return build_default_jsonrpc_success(request_id)

        try:
            legacy_reply = await asyncio.wait_for(pending_reply, timeout=0.05)
        except asyncio.TimeoutError:
            rpc_socket.finish_request(request_id)
            return build_default_jsonrpc_success(request_id)
        except Exception as exc:
            rpc_socket.finish_request(request_id)
            return build_jsonrpc_error(
                request_id=request_id,
                code=-32000,
                message=str(exc),
            )

        if legacy_reply.get("kind") == "error":
            data = legacy_reply.get("data")
            error_data = normalize_payload(cast(object, data)) if isinstance(data, dict) else None
            return build_jsonrpc_error(
                request_id=request_id,
                code=-32000,
                message=str(legacy_reply.get("message") or "Explorer RPC request failed"),
                data=error_data,
            )
        if legacy_reply.get("kind") == "result":
            result = legacy_reply.get("result")
            if isinstance(result, dict):
                return build_jsonrpc_result(request_id, normalize_payload(cast(object, result)))
            return build_default_jsonrpc_success(request_id)
        return build_default_jsonrpc_success(request_id)
