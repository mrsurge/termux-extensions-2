"""Domain namespace adapter for the Rust-owned Socket.IO server.

No Python listener/Engine.IO server is constructed here. Existing namespace
handlers keep their service/session logic; Rust owns sockets and rooms.
"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import ParamSpec, Protocol, TypeVar, cast
from .native_runtime_contracts import NativeEventHandler as NativeEventHandler
from .persistence_io import NativePersistence
from .native_shells import NativeShellBridge
from .terminal_log_io import NativeTerminalLog
from .native_fws import NativeFwsBridge
from .wba_pipe_codec import NativeWbaCodec

_Args = ParamSpec("_Args")
_Result = TypeVar("_Result")


class NativeBridge(NativePersistence, NativeShellBridge, NativeTerminalLog, NativeFwsBridge, NativeWbaCodec, Protocol):
    def socket_op(self, operation: dict[str, object]) -> None: ...
    def pipe_send(self, envelope: dict[str, object]) -> None: ...


class Namespace(Protocol):
    namespace: str
    def _set_server(self, server: object) -> None: ...
    async def trigger_event(self, event: str, *args: object) -> object: ...


class ConnectionRefusedError(Exception):
    """Domain admission refusal; the native namespace handshake owns delivery."""


class NativeNamespace:
    """Only the domain helpers used by TE2; no Python Socket.IO server runtime."""

    def __init__(self, namespace: str = "/") -> None:
        self.namespace: str = namespace
        self.server: NativeSocketServer | None = None

    def _set_server(self, server: object) -> None:
        self.server = cast(NativeSocketServer, server)

    def _server(self) -> NativeSocketServer:
        if self.server is None:
            raise RuntimeError("native namespace is not registered")
        return self.server

    async def trigger_event(self, event: str, *args: object) -> object:
        handler = self._event_handler(event)
        if handler is None:
            return None
        try:
            return await handler(*args)
        except asyncio.CancelledError:
            # Preserve the previous async namespace dispatch cancellation result.
            return None

    def _event_handler(self, event: str) -> NativeEventHandler | None:
        handler: object = getattr(self, "on_" + event, None)
        if handler is None:
            return None
        if not isinstance(handler, NativeEventHandler):
            raise TypeError("native event handler is not callable")
        return handler

    async def emit(self, event: str, data: object = None, *, to: str | None = None,
                   room: str | None = None, skip_sid: str | list[str] | None = None,
                   namespace: str | None = None) -> None:
        await self._server().emit(event, data, to=to, room=room, skip_sid=skip_sid,
                                  namespace=namespace or self.namespace)

    async def enter_room(self, sid: str, room: str, namespace: str | None = None) -> None:
        await self._server().enter_room(sid, room, namespace or self.namespace)

    async def leave_room(self, sid: str, room: str, namespace: str | None = None) -> None:
        await self._server().leave_room(sid, room, namespace or self.namespace)

    async def save_session(self, sid: str, session: dict[str, object], namespace: str | None = None) -> None:
        await self._server().save_session(sid, session, namespace or self.namespace)

    async def get_session(self, sid: str, namespace: str | None = None) -> dict[str, object]:
        return await self._server().get_session(sid, namespace or self.namespace)


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
                   room: str | None = None, skip_sid: str | list[str] | None = None,
                   namespace: str | None = None, callback: object = None,
                   ignore_queue: bool = False) -> None:
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

    def start_background_task(
        self, target: Callable[_Args, Awaitable[_Result]],
        *args: _Args.args, **kwargs: _Args.kwargs,
    ) -> asyncio.Task[_Result]:
        async def run() -> _Result:
            return await target(*args, **kwargs)
        return asyncio.create_task(run())

    async def deliver(self, event: dict[str, object]) -> object:
        namespace = str(event["namespace"])
        sid = str(event["sid"])
        kind = str(event["event"])
        handler = self.namespace_handlers[namespace]
        if kind == "connect":
            empty_environ: dict[str, object] = {}
            args: tuple[object, ...] = (sid, event.get("environ", empty_environ))
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
                self._sessions.pop((namespace, sid), None)
