# pyright: strict
from __future__ import annotations

from .editor_rpc_contract import (
    EDITOR_RPC_METHOD_BLUR,
    EDITOR_RPC_METHOD_FOCUS,
    EDITOR_RPC_METHOD_HOST_SAVE,
)
from ..ui_ipc.rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_EDITOR_BLUR,
    UI_IPC_RPC_NOTIFICATION_EDITOR_FOCUS,
    UI_IPC_RPC_NOTIFICATION_EDITOR_SAVE,
)

JsonObject = dict[str, object]


async def handle_editor_host_action(method: str, params: JsonObject) -> JsonObject:
    from ..ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

    if method == EDITOR_RPC_METHOD_HOST_SAVE:
        await emit_ui_ipc_rpc_notification(UI_IPC_RPC_NOTIFICATION_EDITOR_SAVE, params)
        return {"ok": True}
    if method == EDITOR_RPC_METHOD_FOCUS:
        await emit_ui_ipc_rpc_notification(UI_IPC_RPC_NOTIFICATION_EDITOR_FOCUS, params)
        return {"ok": True}
    if method == EDITOR_RPC_METHOD_BLUR:
        await emit_ui_ipc_rpc_notification(UI_IPC_RPC_NOTIFICATION_EDITOR_BLUR, params)
        return {"ok": True}
    raise ValueError(f"Unsupported editor host action: {method}")
