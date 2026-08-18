# pyright: strict
from __future__ import annotations

from collections.abc import Awaitable
from typing import Protocol, cast


class SocketIOServer(Protocol):
    def emit(
        self,
        event: str,
        data: object | None = None,
        *,
        to: str | None = None,
        room: str | None = None,
        skip_sid: str | None = None,
        namespace: str | None = None,
    ) -> Awaitable[None]: ...


_server: SocketIOServer | None = None


def set_code_te2_socketio_server(server: object) -> None:
    global _server
    _server = cast(SocketIOServer, server)


async def emit_code_te2_socketio(
    event: str,
    data: object | None = None,
    *,
    to: str | None = None,
    room: str | None = None,
    skip_sid: str | None = None,
    namespace: str,
) -> None:
    server = _server
    if server is None:
        raise RuntimeError("code_te2_socketio_not_configured")
    await server.emit(
        event,
        data,
        to=to,
        room=room,
        skip_sid=skip_sid,
        namespace=namespace,
    )


__all__ = ["emit_code_te2_socketio", "set_code_te2_socketio_server"]
