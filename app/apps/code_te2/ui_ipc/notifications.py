"""Outbound UI IPC notifications, independent of namespace request dispatch."""
from __future__ import annotations

from ..client_presentation import client_presentation_room
from ..frontend_rpc_codec import encode_frontend_rpc_message
from ..socketio_runtime import emit_code_te2_socketio
from .rpc_contract import UI_IPC_RPC_NOTIFICATION_EVENT, build_jsonrpc_notification

JsonObject = dict[str, object]


def encode_ui_ipc_notification(method: str, params: JsonObject) -> bytes:
    return encode_frontend_rpc_message(build_jsonrpc_notification(method, params), lane="ui_ipc", method=method)


async def emit_ui_ipc_rpc_notification(
    method: str,
    params: JsonObject,
    *,
    skip_sid: str | None = None,
    to_sid: str | None = None,
    room: str = "ui_ipc",
    client_instance_id: str | None = None,
) -> None:
    envelope = encode_ui_ipc_notification(method, params)
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
