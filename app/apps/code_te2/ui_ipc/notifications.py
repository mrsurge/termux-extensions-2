"""Outbound UI IPC notifications, independent of namespace request dispatch."""
from __future__ import annotations

from ..client_presentation import client_presentation_room
from ..socketio_runtime import emit_code_te2_socketio
from .rpc_contract import UI_IPC_RPC_NOTIFICATION_EVENT, build_jsonrpc_notification

JsonObject = dict[str, object]


def build_ui_ipc_notification(method: str, params: JsonObject) -> JsonObject:
    return dict(build_jsonrpc_notification(method, params))


async def emit_ui_ipc_rpc_notification(
    method: str,
    params: JsonObject,
    *,
    skip_sid: str | None = None,
    to_sid: str | None = None,
    room: str = "ui_ipc",
    client_instance_id: str | None = None,
) -> None:
    envelope = build_ui_ipc_notification(method, params)
    target_room = (
        client_presentation_room(client_instance_id)
        if client_instance_id is not None
        else room
    )
    if to_sid:
        await emit_code_te2_socketio(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            envelope,
            namespace="/ui_ipc",
            to=to_sid,
        )
    else:
        await emit_code_te2_socketio(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            envelope,
            namespace="/ui_ipc",
            room=target_room,
            skip_sid=skip_sid,
        )
