"""Invalidate client contribution caches without changing document authority."""
from __future__ import annotations

from .monaco_editor.editor_rpc_contract import EDITOR_RPC_NOTIFICATION_EXTENSION_CONTRIBUTIONS_CHANGED
from .monaco_editor.editor_rpc_emit import emit_editor_rpc_notification
from .ui_ipc.rpc_contract import UI_IPC_RPC_NOTIFICATION_EXTENSION_CONTRIBUTIONS_CHANGED


async def publish_extension_contributions_changed(reason: str) -> None:
    from .monaco_editor.editor_socketio import EDITOR_SIO
    from .ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

    async def emit(event: str, payload: object) -> None:
        await EDITOR_SIO.emit(event, payload, room="code_te2", namespace="/rpc/editor")

    payload: dict[str, object] = {"reason": reason}
    await emit_editor_rpc_notification(
        emit, EDITOR_RPC_NOTIFICATION_EXTENSION_CONTRIBUTIONS_CHANGED, payload,
    )
    await emit_ui_ipc_rpc_notification(
        UI_IPC_RPC_NOTIFICATION_EXTENSION_CONTRIBUTIONS_CHANGED, payload,
    )
