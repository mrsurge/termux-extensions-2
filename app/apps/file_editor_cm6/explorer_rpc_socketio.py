# pyright: strict
from __future__ import annotations

import asyncio
import json
import logging
from typing import cast

import socketio

from .explorer_rpc_contract import (
    build_default_jsonrpc_success,
    build_jsonrpc_error,
    build_jsonrpc_error_from_legacy_reply,
    build_jsonrpc_success,
    parse_explorer_rpc_request,
    legacy_message_from_rpc_request,
    rpc_notification_from_legacy_message,
    ExplorerRpcProtocolError,
)
from .explorer_ws import ExplorerDispatcher

logger = logging.getLogger(__name__)


class ExplorerRpcSocketShim:
    """Adapt ConnectionManager sends into JSON-RPC notifications and ack replies."""

    def __init__(self, namespace: socketio.AsyncNamespace, sid: str):
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
            payload = json.loads(data)
        except json.JSONDecodeError:
            return
        if not isinstance(payload, dict):
            return

        request_id = payload.get("id")
        if isinstance(request_id, str):
            pending = self._pending_requests.pop(request_id, None)
            if pending is not None and not pending.done():
                pending.set_result(cast(dict[str, object], payload))
                return

        notification = rpc_notification_from_legacy_message(payload)
        if notification is None:
            return
        await self.namespace.emit("rpc.notify", notification, room=self.sid)


class ExplorerRpcSocketIONamespace(socketio.AsyncNamespace):
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

    async def on_rpc(self, sid: str, data: object) -> dict[str, object] | None:
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
            legacy_message = legacy_message_from_rpc_request(parsed)
        except ExplorerRpcProtocolError as exc:
            return exc.to_json()

        request_id = parsed["request_id"]
        pending_reply = rpc_socket.open_request(request_id) if request_id is not None else None

        try:
            await disp.handle_message_json(legacy_message)
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

        if legacy_reply.get("type") == "error":
            return build_jsonrpc_error_from_legacy_reply(request_id, legacy_reply)
        return build_jsonrpc_success(request_id, legacy_reply)
