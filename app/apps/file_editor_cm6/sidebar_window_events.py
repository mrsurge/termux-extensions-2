# pyright: strict
from __future__ import annotations

import logging
from typing import Awaitable, Literal, Protocol, cast

from .ui_ipc.rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED,
)
from .ui_ipc.sidebar_rpc_contract import (
    SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED,
    build_jsonrpc_notification,
)
from .worker_services.event_bus import (
    JsonObject,
    WorkerEvent,
    build_event,
    event_payload_object,
    publish as publish_worker_event,
    subscribe as subscribe_worker_event,
)

logger = logging.getLogger(__name__)

SidebarProjectionScope = Literal["client", "global"]
_event_bus_handlers_registered = False


class _SidebarNamespace(Protocol):
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


def register_sidebar_window_event_bus_handlers() -> None:
    """Register sidebar window state projectors for backend ledger facts."""
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    subscribe_worker_event("SidebarWindowStateChanged", _handle_sidebar_window_state_changed_event)
    _event_bus_handlers_registered = True


async def publish_sidebar_window_state_changed(
    state: JsonObject,
    *,
    source: str,
    sidebar_scope: SidebarProjectionScope = "global",
    activated_scope: SidebarProjectionScope | None = None,
    client_id: str | None = None,
    activated: JsonObject | None = None,
    readiness: JsonObject | None = None,
    correlation_id: str | None = None,
    skip_sidebar_sid: str | None = None,
) -> None:
    payload: JsonObject = {
        "state": dict(state),
        "sidebarScope": sidebar_scope,
    }
    if isinstance(client_id, str) and client_id:
        payload["clientId"] = client_id
        payload["client_id"] = client_id
    if activated_scope in {"client", "global"}:
        payload["activatedScope"] = activated_scope
    if isinstance(activated, dict) and activated:
        payload["activated"] = dict(activated)
    if isinstance(readiness, dict) and readiness:
        payload["readiness"] = dict(readiness)
    if isinstance(skip_sidebar_sid, str) and skip_sidebar_sid:
        payload["skipSidebarSid"] = skip_sidebar_sid

    raw_slots = state.get("slots")
    slot_count = len(raw_slots) if isinstance(raw_slots, dict) else 0
    logger.info(
        "[sidebar_window_events] publish source=%s scope=%s client=%s slots=%s",
        source,
        sidebar_scope,
        client_id or "",
        slot_count,
    )
    await publish_worker_event(
        build_event(
            "SidebarWindowStateChanged",
            source=source,
            correlation_id=correlation_id,
            payload=payload,
        )
    )


async def _handle_sidebar_window_state_changed_event(event: WorkerEvent) -> None:
    # Sidebar window state is a backend ledger fact. Local shortcut selection and
    # focus-only behavior stay direct in the sidebar lane.
    state = event_payload_object(event, "state")
    if not state:
        return

    client_id = _event_text(event, "clientId") or _event_text(event, "client_id")
    scope = _projection_scope(event)
    skip_sidebar_sid = _event_text(event, "skipSidebarSid")
    activated = event_payload_object(event, "activated")
    readiness = event_payload_object(event, "readiness")
    activated_scope = _projection_scope(event, key="activatedScope")

    if activated:
        await _emit_ui_sidebar_notification(
            UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED,
            activated,
        )
        await _emit_sidebar_notification(
            SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED,
            activated,
            client_id=client_id,
            scope=activated_scope,
            skip_sid=skip_sidebar_sid,
        )
    if readiness:
        await _emit_ui_sidebar_notification(
            UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED,
            readiness,
        )
        await _emit_sidebar_notification(
            SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED,
            readiness,
            scope="global",
            skip_sid=skip_sidebar_sid,
        )

    await _emit_ui_sidebar_notification(
        UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
        state,
    )
    await _emit_sidebar_notification(
        SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED,
        state,
        client_id=client_id,
        scope=scope,
        skip_sid=skip_sidebar_sid,
    )


def _event_text(event: WorkerEvent, key: str) -> str | None:
    value = event["payload"].get(key)
    return value if isinstance(value, str) and value else None


def _projection_scope(event: WorkerEvent, *, key: str = "sidebarScope") -> SidebarProjectionScope:
    raw = _event_text(event, key)
    return "client" if raw == "client" else "global"


def _client_room(client_id: str) -> str:
    return f"sidebar:client:{client_id}"


async def _emit_ui_sidebar_notification(method: str, payload: JsonObject) -> None:
    try:
        from .ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

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
        from .ui_ipc.ui_ipc_socketio import UI_IPC_SIO

        sio = cast(_SidebarNamespace, UI_IPC_SIO)
        room = _client_room(client_id) if scope == "client" and isinstance(client_id, str) and client_id else "sidebar_ipc"
        await sio.emit(
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
