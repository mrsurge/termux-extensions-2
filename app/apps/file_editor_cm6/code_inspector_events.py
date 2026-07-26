# pyright: strict
from __future__ import annotations

import logging

from .code_inspector_backend import clear_code_inspector_projection
from .ui_ipc.rpc_contract import UI_IPC_RPC_NOTIFICATION_CODE_INSPECTOR_CHANGED
from .worker_services.event_bus import (
    WorkerEvent,
    current_project_generation,
    event_payload_object,
    record_stale_drop,
    subscribe as subscribe_worker_event,
)

logger = logging.getLogger(__name__)
_event_bus_handlers_registered = False


def register_code_inspector_event_bus_handlers() -> None:
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    subscribe_worker_event("CodeInspectorChanged", _handle_code_inspector_changed)
    subscribe_worker_event("ProjectSwitchStarted", _handle_project_switch_started)
    subscribe_worker_event("AdapterSessionReset", _handle_adapter_session_reset)
    _event_bus_handlers_registered = True


async def _handle_code_inspector_changed(event: WorkerEvent) -> None:
    project = event.get("project_root")
    generation = event.get("project_generation")
    if (
        project
        and generation is not None
        and current_project_generation(project) != generation
    ):
        record_stale_drop("code_inspector_events:projector", event["type"])
        return
    payload: dict[str, object] = {
        "projection": event_payload_object(event, "projection")
        if isinstance(event["payload"].get("projection"), dict)
        else None,
    }
    reason = event["payload"].get("reason")
    if isinstance(reason, str) and reason:
        payload["reason"] = reason
    try:
        from .ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

        await emit_ui_ipc_rpc_notification(
            UI_IPC_RPC_NOTIFICATION_CODE_INSPECTOR_CHANGED,
            payload,
        )
    except Exception as exc:
        logger.debug("[code_inspector] UI projection failed: %s", exc)


async def _handle_project_switch_started(_event: WorkerEvent) -> None:
    await clear_code_inspector_projection(
        reason="project_switch",
        source="code_inspector.project_switch",
    )


async def _handle_adapter_session_reset(_event: WorkerEvent) -> None:
    await clear_code_inspector_projection(
        reason="adapter_session_reset",
        source="code_inspector.adapter_reset",
    )
