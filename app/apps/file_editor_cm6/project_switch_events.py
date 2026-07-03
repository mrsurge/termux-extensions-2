# pyright: strict
from __future__ import annotations

import logging
import time

from .monaco_editor.editor_rpc_contract import (
    EditorRpcNotification,
    EDITOR_RPC_NOTIFICATION_PROJECT_SWITCHED,
    EDITOR_RPC_NOTIFICATION_PROJECT_SWITCHING,
)
from .monaco_editor.editor_rpc_emit import emit_editor_rpc_notification
from .ui_ipc.rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHED,
    UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHING,
)
from .worker_services.event_bus import (
    JsonObject,
    WorkerEvent,
    event_payload_object,
    subscribe as subscribe_worker_event,
)

logger = logging.getLogger(__name__)

_event_bus_handlers_registered = False


def register_project_switch_event_bus_handlers() -> None:
    """Register surface projectors for backend project-switch facts."""
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    subscribe_worker_event("ProjectSwitchStarted", _handle_project_switch_started_event)
    subscribe_worker_event("ProjectSwitchFinished", _handle_project_switch_finished_event)
    _event_bus_handlers_registered = True


async def _handle_project_switch_started_event(event: WorkerEvent) -> None:
    # Project-switch lifecycle is a control-plane fact. The actual editor file
    # open and WBA language-feature paths stay on their direct lanes.
    await _emit_project_switch_notification(event, phase="begin")


async def _handle_project_switch_finished_event(event: WorkerEvent) -> None:
    await _emit_project_switch_notification(event, phase="end")


async def _emit_project_switch_notification(
    event: WorkerEvent,
    *,
    phase: str,
) -> None:
    project = event.get("project_root")
    if not project:
        return

    payload = _project_switch_payload(event, phase=phase, project=project)
    if phase == "begin":
        editor_method: EditorRpcNotification = EDITOR_RPC_NOTIFICATION_PROJECT_SWITCHING
        ui_method = UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHING
    else:
        editor_method = EDITOR_RPC_NOTIFICATION_PROJECT_SWITCHED
        ui_method = UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHED

    logger.info(
        "[project_switch_events] emit phase=%s project=%s switchId=%s status=%s adapterStatus=%s",
        phase,
        project,
        payload.get("switchId"),
        payload.get("status") or "",
        payload.get("adapterStatus") or "",
    )

    await _emit_editor_project_switch(editor_method, payload)
    await _emit_ui_project_switch(ui_method, payload)
    if phase == "begin":
        await _emit_explorer_search_reset(payload)


def _project_switch_payload(
    event: WorkerEvent,
    *,
    phase: str,
    project: str,
) -> JsonObject:
    raw_payload = event["payload"]
    display_path = _event_text(event, "displayPath") or project
    switch_id = (
        event.get("correlation_id")
        or _event_text(event, "switchId")
        or f"project_switch_{event['emitted_at_ms']}"
    )
    payload: JsonObject = {
        "phase": phase,
        "operation": "project_open",
        "projectPath": project,
        "displayPath": display_path,
        "switchId": switch_id,
        "ts": event["emitted_at_ms"] or int(time.time() * 1000),
    }
    for key in ("source", "reason", "status", "error", "adapterStatus"):
        value = raw_payload.get(key)
        if isinstance(value, str) and value:
            payload[key] = value
    open_state = event_payload_object(event, "openState")
    if open_state:
        payload["openState"] = open_state
    return payload


def _event_text(event: WorkerEvent, key: str) -> str | None:
    value = event["payload"].get(key)
    return value if isinstance(value, str) and value else None


async def _emit_editor_project_switch(
    method: EditorRpcNotification,
    payload: JsonObject,
) -> None:
    try:
        from .monaco_editor.editor_socketio import EDITOR_SIO

        async def _emit(event_name: str, notification_payload: JsonObject) -> None:
            await EDITOR_SIO.emit(  # pyright: ignore[reportUnknownMemberType]
                event_name,
                notification_payload,
                room="file_editor_cm6",
                namespace="/rpc/editor",
            )

        await emit_editor_rpc_notification(
            _emit,
            method,
            payload,
        )
    except Exception as exc:
        logger.debug("[project_switch_events] editor emit failed: %s", exc)


async def _emit_ui_project_switch(method: str, payload: JsonObject) -> None:
    try:
        from .ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

        await emit_ui_ipc_rpc_notification(method, payload)
    except Exception as exc:
        logger.debug("[project_switch_events] ui emit failed: %s", exc)


async def _emit_explorer_search_reset(payload: JsonObject) -> None:
    try:
        from .explorer.transport.rpc_emit import emit_explorer_rpc_notification

        await emit_explorer_rpc_notification(
            "explorer.search.reset",
            {
                "reason": "projectSwitch",
                "projectPath": payload.get("projectPath") or "",
                "switchId": payload.get("switchId") or "",
                "source": payload.get("source") or "",
                "phase": payload.get("phase") or "begin",
            },
        )
    except Exception as exc:
        logger.debug("[project_switch_events] explorer search reset emit failed: %s", exc)
