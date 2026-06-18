# pyright: strict
from __future__ import annotations

import logging
from pathlib import Path

from .monaco_editor.editor_rpc_contract import EDITOR_RPC_NOTIFICATION_ADAPTER_STATE
from .monaco_editor.editor_rpc_emit import emit_editor_rpc_notification
from .ui_ipc.rpc_contract import UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE
from .worker_services.event_bus import (
    JsonObject,
    WorkerEvent,
    build_event,
    current_project_generation,
    event_payload_object,
    publish as publish_worker_event,
    record_stale_drop,
    subscribe as subscribe_worker_event,
)

logger = logging.getLogger(__name__)

_event_bus_handlers_registered = False


def register_adapter_lifecycle_event_bus_handlers() -> None:
    """Register backend projectors for adapter lifecycle and state facts."""
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    subscribe_worker_event("AdapterStateChanged", _handle_adapter_state_changed_event)
    subscribe_worker_event("AdapterWorkspaceReady", _handle_adapter_workspace_ready_event)
    _event_bus_handlers_registered = True


async def publish_adapter_state_changed(
    state: JsonObject,
    *,
    project_root: str | Path | None = None,
    source: str,
    correlation_id: str | None = None,
) -> None:
    normalized_project = _normalize_project_root(project_root)
    await publish_worker_event(
        build_event(
            "AdapterStateChanged",
            project_root=normalized_project,
            project_generation=current_project_generation(normalized_project)
            if normalized_project is not None
            else None,
            source=source,
            correlation_id=correlation_id,
            payload={"state": dict(state)},
        )
    )


async def publish_adapter_session_reset(
    payload: JsonObject,
    *,
    project_root: str | Path | None = None,
    source: str,
    correlation_id: str | None = None,
) -> None:
    normalized_project = _normalize_project_root(project_root)
    await publish_worker_event(
        build_event(
            "AdapterSessionReset",
            project_root=normalized_project,
            project_generation=current_project_generation(normalized_project)
            if normalized_project is not None
            else None,
            source=source,
            correlation_id=correlation_id,
            payload=dict(payload),
        )
    )


async def publish_adapter_workspace_ready(
    payload: JsonObject,
    *,
    project_root: str | Path,
    source: str,
    correlation_id: str | None = None,
) -> None:
    normalized_project = _normalize_project_root(project_root)
    if normalized_project is None:
        return
    await publish_worker_event(
        build_event(
            "AdapterWorkspaceReady",
            project_root=normalized_project,
            project_generation=current_project_generation(normalized_project),
            source=source,
            correlation_id=correlation_id,
            payload=dict(payload),
        )
    )


async def _handle_adapter_state_changed_event(event: WorkerEvent) -> None:
    # Adapter state is backend-owned store data. Editor/UI consume a projected
    # notification while direct WBA language-feature traffic stays untouched.
    project = event.get("project_root")
    generation = event.get("project_generation")
    if (
        project
        and generation is not None
        and current_project_generation(project) != generation
    ):
        record_stale_drop("adapter_lifecycle_events:adapter_state", event["type"])
        logger.debug(
            "[adapter_lifecycle_events] dropped stale adapter state project=%s generation=%s current=%s",
            project,
            generation,
            current_project_generation(project),
        )
        return

    state = event_payload_object(event, "state")
    if not state:
        return
    await _emit_editor_adapter_state(state)
    await _emit_ui_adapter_state(state)


async def _handle_adapter_workspace_ready_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project:
        return
    generation = event.get("project_generation")
    if generation is not None and current_project_generation(project) != generation:
        record_stale_drop("adapter_lifecycle_events:workspace_ready", event["type"])
        logger.debug(
            "[adapter_lifecycle_events] dropped stale workspace ready project=%s generation=%s current=%s",
            project,
            generation,
            current_project_generation(project),
        )
        return
    try:
        from .diagnostics_bridge import reset_diagnostics_projection_for_project

        await reset_diagnostics_projection_for_project(
            project,
            project_generation=generation,
        )
    except Exception as exc:
        logger.warning(
            "[adapter_lifecycle_events] workspace ready diagnostics reset failed project=%s error=%s",
            project,
            exc,
        )


async def _emit_editor_adapter_state(payload: JsonObject) -> None:
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
            EDITOR_RPC_NOTIFICATION_ADAPTER_STATE,
            payload,
        )
    except Exception as exc:
        logger.debug("[adapter_lifecycle_events] editor adapter-state emit failed: %s", exc)


async def _emit_ui_adapter_state(payload: JsonObject) -> None:
    try:
        from .ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

        await emit_ui_ipc_rpc_notification(
            UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE,
            payload,
        )
    except Exception as exc:
        logger.debug("[adapter_lifecycle_events] ui adapter-state emit failed: %s", exc)


def _normalize_project_root(project_root: str | Path | None) -> str | None:
    if project_root is None:
        return None
    try:
        return str(Path(project_root).expanduser().resolve(strict=False))
    except Exception:
        return str(project_root)
