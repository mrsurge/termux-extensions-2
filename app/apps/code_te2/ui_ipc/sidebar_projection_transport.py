# pyright: strict
from __future__ import annotations

import logging
from ..socketio_runtime import emit_code_te2_socketio
from .sidebar_projection_service import SidebarProjection, SidebarProjectionScope
from .sidebar_rpc_contract import SIDEBAR_IPC_RPC_NOTIFICATION_EVENT, build_jsonrpc_notification

JsonObject = dict[str, object]
logger = logging.getLogger(__name__)

def _client_room(client_id: str) -> str:
    return f"sidebar:client:{client_id}"


async def _emit_ui_sidebar_notification(method: str, payload: JsonObject) -> None:
    try:
        from .notifications import emit_ui_ipc_rpc_notification

        await emit_ui_ipc_rpc_notification(method, payload)
    except Exception as exc:
        logger.debug("[sidebar_window_events] ui emit failed method=%s error=%s", method, exc)


async def _emit_sidebar_notification(
    method: str,
    payload: JsonObject,
    *,
    scope: SidebarProjectionScope,
    client_id: str | None = None,
    skip_sid: str | None = None,
) -> None:
    try:
        room = _client_room(client_id) if scope == "client" and isinstance(client_id, str) and client_id else "sidebar_ipc"
        await emit_code_te2_socketio(
            SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
            build_jsonrpc_notification(method, payload),
            namespace="/sidebar_ipc",
            room=room,
            skip_sid=skip_sid,
        )
    except Exception as exc:
        logger.debug(
            "[sidebar_window_events] sidebar emit failed method=%s scope=%s client=%s error=%s",
            method,
            scope,
            client_id or "",
            exc,
        )

# Ledger delivery is best-effort per notification, unlike direct registration.
async def deliver_window_fact_projection(projection: SidebarProjection) -> None:
    if projection.lane == "ui":
        await _emit_ui_sidebar_notification(projection.method, projection.payload)
    else:
        await _emit_sidebar_notification(
            projection.method, projection.payload,
            scope="client" if projection.scope == "client" else "global",
            client_id=projection.target, skip_sid=projection.exclude_connection,
        )
