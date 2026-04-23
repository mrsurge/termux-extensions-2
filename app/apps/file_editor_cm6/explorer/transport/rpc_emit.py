# pyright: strict
from __future__ import annotations

from typing import Protocol, cast

from .rpc_contract import (
    EXPLORER_RPC_NAMESPACE,
    EXPLORER_RPC_NOTIFICATION_EVENT,
    build_jsonrpc_notification,
)


class SocketIOEmitter(Protocol):
    async def emit(
        self,
        event: str,
        data: object,
        *,
        namespace: str | None = None,
    ) -> None: ...


async def emit_explorer_rpc_notification(method: str, params: dict[str, object]) -> None:
    from .socketio_app import EXPLORER_SIO

    sio = cast(SocketIOEmitter, EXPLORER_SIO)
    await sio.emit(
        EXPLORER_RPC_NOTIFICATION_EVENT,
        build_jsonrpc_notification(method, params),
        namespace=EXPLORER_RPC_NAMESPACE,
    )


async def emit_project_explorer_rpc_notification(
    project_path: str | None,
    method: str,
    params: dict[str, object],
) -> None:
    if isinstance(project_path, str) and project_path.strip():
        from .connection_manager import manager

        await manager.broadcast(
            project_path,
            build_jsonrpc_notification(method, params),
        )
        return

    await emit_explorer_rpc_notification(method, params)
