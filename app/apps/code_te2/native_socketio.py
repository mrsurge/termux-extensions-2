"""Domain namespace adapter for the Rust-owned Socket.IO server.

No Python listener/Engine.IO server is constructed here. Existing namespace
handlers keep their service/session logic; Rust owns sockets and rooms.
"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Protocol, cast


class NativeBridge(Protocol):
    def socket_op(self, operation: dict[str, object]) -> None: ...
    def pipe_send(self, envelope: dict[str, object]) -> None: ...


class Namespace(Protocol):
    namespace: str
    def _set_server(self, server: object) -> None: ...
    async def trigger_event(self, event: str, *args: object) -> object: ...


class NativeSocketServer:
    def __init__(self) -> None:
        self.namespace_handlers: dict[str, Namespace] = {}
        self._sessions: dict[tuple[str, str], dict[str, object]] = {}
        self._bridge: NativeBridge | None = None

    def attach(self, bridge: NativeBridge) -> None:
        self._bridge = bridge

    def register_namespace(self, namespace: object) -> None:
        handler = cast(Namespace, namespace)
        handler._set_server(self)  # pyright: ignore[reportPrivateUsage] -- namespace registration hook
        self.namespace_handlers[handler.namespace] = handler

    def _send(self, payload: dict[str, object]) -> None:
        if self._bridge is None:
            raise RuntimeError("native Socket.IO bridge is not attached")
        self._bridge.socket_op(payload)

    async def emit(self, event: str, data: object = None, *, to: str | None = None,
                   room: str | None = None, skip_sid: str | None = None,
                   namespace: str | None = None, callback: object = None,
                   ignore_queue: bool = False) -> None:
        del ignore_queue
        if callback is not None:
            raise RuntimeError("native emit callbacks require explicit ack support")
        self._send({"op": "emit", "event": event, "data": data, "room": to or room,
                    "skipSid": skip_sid, "namespace": namespace or "/"})

    async def enter_room(self, sid: str, room: str, namespace: str | None = None) -> None:
        self._send({"op": "join", "sid": sid, "room": room, "namespace": namespace or "/"})

    async def leave_room(self, sid: str, room: str, namespace: str | None = None) -> None:
        self._send({"op": "leave", "sid": sid, "room": room, "namespace": namespace or "/"})

    async def disconnect(self, sid: str, namespace: str | None = None) -> None:
        self._send({"op": "disconnect", "sid": sid, "namespace": namespace or "/"})

    async def save_session(self, sid: str, session: dict[str, object], namespace: str | None = None) -> None:
        self._sessions[(namespace or "/", sid)] = session

    async def get_session(self, sid: str, namespace: str | None = None) -> dict[str, object]:
        return self._sessions.setdefault((namespace or "/", sid), {})

    def start_background_task(self, target: Callable[..., Awaitable[object]], *args: object) -> asyncio.Task[object]:
        async def run() -> object:
            return await target(*args)
        return asyncio.create_task(run())

    async def deliver(self, event: dict[str, object]) -> object:
        namespace = str(event["namespace"])
        sid = str(event["sid"])
        kind = str(event["event"])
        handler = self.namespace_handlers[namespace]
        if kind == "connect":
            args: tuple[object, ...] = (sid, event.get("environ", {}))
            if namespace != "/terminal":
                args += (event.get("auth"),)
        elif kind == "disconnect":
            args = (sid, event.get("reason", "transport close"))
        else:
            args = (sid, event.get("data"))
        try:
            return await handler.trigger_event(kind, *args)
        finally:
            if kind == "disconnect":
                _ = self._sessions.pop((namespace, sid), None)
