# pyright: strict
from __future__ import annotations

import logging
from typing import cast

from .client_presentation import client_presentation_room
from .monaco_editor.editor_rpc_contract import EDITOR_RPC_NOTIFICATION_OPEN_STATE_CHANGED
from .monaco_editor.editor_rpc_emit import emit_editor_rpc_notification
from .frontend_rpc_codec import encode_frontend_rpc_message
from .open_state_backend import ClientForegroundPayload, SidecarOpenStatePayload
from .ui_ipc.rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_EVENT,
    UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED,
    UI_IPC_RPC_NOTIFICATION_OPEN_STATE_CHANGED,
)
from .ui_ipc.rpc_contract import build_jsonrpc_notification
from .socketio_runtime import emit_code_te2_socketio
from .worker_services.event_bus import (
    WorkerEvent,
    build_event,
    current_project_generation,
    event_payload_object,
    publish as publish_worker_event,
    record_stale_drop,
    subscribe as subscribe_worker_event,
)

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]
_event_bus_handlers_registered = False


def open_state_payload_from_event(event: WorkerEvent) -> SidecarOpenStatePayload | None:
    raw = event_payload_object(event, "openState")
    if not isinstance(raw.get("projectPath"), str):
        return None
    return cast(SidecarOpenStatePayload, cast(object, dict(raw)))


def client_foreground_payload_from_event(
    event: WorkerEvent,
) -> ClientForegroundPayload | None:
    raw = event_payload_object(event, "clientForeground")
    if not isinstance(raw.get("clientInstanceId"), str):
        return None
    return cast(ClientForegroundPayload, cast(object, dict(raw)))


async def publish_open_state_changed(
    open_state: SidecarOpenStatePayload,
    *,
    client_foreground: ClientForegroundPayload | None = None,
    source: str | None = None,
    request_id: str | None = None,
    project_generation: int | None = None,
) -> None:
    project = open_state["projectPath"]
    resolved_generation = (
        project_generation
        if project_generation is not None
        else current_project_generation(project)
    )
    payload: JsonObject = {"openState": dict(open_state)}
    if isinstance(source, str) and source:
        payload["source"] = source
    if isinstance(request_id, str) and request_id:
        payload["request_id"] = request_id

    print(
        "[open_state] publish "
        f"source={source or ''} "
        f"project={project} "
        f"openFile={open_state.get('openFile')} "
        f"revision={open_state.get('revision')}",
        flush=True,
    )
    await publish_worker_event(
        build_event(
            "OpenStateChanged",
            project_root=project,
            project_generation=resolved_generation,
            source=source or str(open_state.get("reason") or "open_state"),
            correlation_id=request_id,
            payload=payload,
        )
    )
    if client_foreground is not None:
        await publish_client_foreground_changed(
            open_state,
            client_foreground,
            source=source,
            request_id=request_id,
            project_generation=resolved_generation,
        )


async def publish_client_foreground_changed(
    open_state: SidecarOpenStatePayload,
    client_foreground: ClientForegroundPayload,
    *,
    source: str | None = None,
    request_id: str | None = None,
    project_generation: int | None = None,
) -> None:
    project = open_state["projectPath"]
    resolved_generation = (
        project_generation
        if project_generation is not None
        else current_project_generation(project)
    )
    payload: JsonObject = {
        "openState": dict(open_state),
        "clientForeground": dict(client_foreground),
    }
    if isinstance(source, str) and source:
        payload["source"] = source
    if isinstance(request_id, str) and request_id:
        payload["request_id"] = request_id
    await publish_worker_event(
        build_event(
            "ClientForegroundChanged",
            project_root=project,
            project_generation=resolved_generation,
            source=source or str(open_state.get("reason") or "client_foreground"),
            correlation_id=request_id,
            payload=payload,
        )
    )


def register_open_state_event_bus_handlers() -> None:
    """Register projectors for backend-owned open-state facts."""
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    subscribe_worker_event("OpenStateChanged", _handle_open_state_changed_event)
    subscribe_worker_event("ClientForegroundChanged", _handle_client_foreground_changed_event)
    _event_bus_handlers_registered = True


async def _handle_open_state_changed_event(event: WorkerEvent) -> None:
    # Open-state is a control-plane fact. The editor content-open path stays
    # direct; this projector only fans out the sidecar-backed active-file state.
    project = event.get("project_root")
    if not project:
        return
    generation = event.get("project_generation")
    if generation is not None and current_project_generation(project) != generation:
        record_stale_drop("open_state_events:projector", event["type"])
        logger.debug(
            "[open_state_events] dropped stale open-state fact project=%s generation=%s current=%s",
            project,
            generation,
            current_project_generation(project),
        )
        return

    open_state = open_state_payload_from_event(event)
    if open_state is None:
        return

    source = _event_text(event, "source") or event["source"]
    request_id = _event_text(event, "request_id") or event.get("correlation_id")
    payload = _surface_payload(open_state, source=source, request_id=request_id)
    await _emit_editor_open_state(payload)
    await _emit_ui_open_state(payload)


async def _handle_client_foreground_changed_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project:
        return
    generation = event.get("project_generation")
    if generation is not None and current_project_generation(project) != generation:
        record_stale_drop("open_state_events:client_projector", event["type"])
        return

    open_state = open_state_payload_from_event(event)
    client_foreground = client_foreground_payload_from_event(event)
    if open_state is None or client_foreground is None:
        return
    source = _event_text(event, "source") or event["source"]
    request_id = _event_text(event, "request_id") or event.get("correlation_id")
    await _emit_host_active_file_changed(
        client_foreground,
        open_state=open_state,
        source=source,
        request_id=request_id,
    )


def _event_text(event: WorkerEvent, key: str) -> str | None:
    value = event["payload"].get(key)
    return value if isinstance(value, str) and value else None


def _surface_payload(
    open_state: SidecarOpenStatePayload,
    *,
    source: str | None,
    request_id: str | None,
) -> JsonObject:
    payload: JsonObject = dict(open_state)
    if isinstance(source, str) and source:
        payload["source"] = source
    if isinstance(request_id, str) and request_id:
        payload["request_id"] = request_id
    return payload


async def _emit_editor_open_state(payload: JsonObject) -> None:
    try:
        async def _emit(event_name: str, notification_payload: bytes) -> None:
            await emit_code_te2_socketio(
                event_name,
                notification_payload,
                room="code_te2",
                namespace="/rpc/editor",
            )

        await emit_editor_rpc_notification(
            _emit,
            EDITOR_RPC_NOTIFICATION_OPEN_STATE_CHANGED,
            payload,
        )
    except Exception:
        pass


async def _emit_ui_open_state(payload: JsonObject) -> None:
    try:
        method = UI_IPC_RPC_NOTIFICATION_OPEN_STATE_CHANGED
        await emit_code_te2_socketio(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            encode_frontend_rpc_message(
                build_jsonrpc_notification(method, payload),
                lane="ui_ipc",
                method=method,
            ),
            namespace="/ui_ipc",
            room="ui_ipc",
        )
    except Exception:
        pass


async def _emit_host_active_file_changed(
    client_foreground: ClientForegroundPayload,
    *,
    open_state: SidecarOpenStatePayload,
    source: str | None,
    request_id: str | None,
) -> None:
    try:
        from .explorer.transport.connection_manager import abs_to_rel

        project = client_foreground["projectPath"]
        abs_path = client_foreground["path"]
        rel = abs_to_rel(abs_path, project) if abs_path else None
        payload: JsonObject = {
            "path": abs_path,
            "rel": rel,
            "openState": dict(open_state),
            "clientForeground": dict(client_foreground),
        }
        if isinstance(source, str) and source:
            payload["source"] = source
        if isinstance(request_id, str) and request_id:
            payload["request_id"] = request_id
        method = UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED
        await emit_code_te2_socketio(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            encode_frontend_rpc_message(
                build_jsonrpc_notification(method, payload),
                lane="ui_ipc",
                method=method,
            ),
            namespace="/ui_ipc",
            room=client_presentation_room(client_foreground["clientInstanceId"]),
        )
    except Exception:
        pass
