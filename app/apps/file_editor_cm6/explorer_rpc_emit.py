# pyright: strict
from __future__ import annotations

from .explorer_rpc_contract import (
    EXPLORER_RPC_NAMESPACE,
    EXPLORER_RPC_NOTIFICATION_EVENT,
    build_jsonrpc_notification,
)


async def emit_explorer_rpc_notification(method: str, params: dict[str, object]) -> None:
    from .explorer_socketio import EXPLORER_SIO

    await EXPLORER_SIO.emit(
        EXPLORER_RPC_NOTIFICATION_EVENT,
        build_jsonrpc_notification(method, params),
        namespace=EXPLORER_RPC_NAMESPACE,
    )

