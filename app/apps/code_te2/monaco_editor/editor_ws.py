import hashlib
import asyncio
import os
import time
from pathlib import Path
from collections.abc import Awaitable, Mapping
from typing import Optional, Protocol, cast

from ..stores import get_history_store, get_preferences_store
from ..client_presentation import client_presentation_room
from ..worker_services import git_service as worker_git_service
from ..ui_ipc.rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_EDITOR_CACHE_STATE,
    UI_IPC_RPC_NOTIFICATION_EDITOR_DIAGNOSTICS_COUNTS,
    UI_IPC_RPC_NOTIFICATION_EDITOR_DRAFT_STATE,
    UI_IPC_RPC_NOTIFICATION_EDITOR_NOTIFY,
    UI_IPC_RPC_NOTIFICATION_EDITOR_OPEN_COMPLETE,
    UI_IPC_RPC_NOTIFICATION_EDITOR_READY,
    UI_IPC_RPC_NOTIFICATION_EDITOR_SCROLL_STATE,
    UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHED,
    UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHING,
)
from ..open_state_backend import (
    ClientForegroundPayload,
    SidecarOpenStatePayload,
    list_client_foregrounds,
    read_client_foreground,
    read_sidecar_open_state,
    write_client_document_open,
)
from ..open_state_events import (
    publish_client_foreground_changed,
    publish_open_state_changed,
)
from ..socketio_runtime import emit_code_te2_socketio
from .editor_open_backend import (
    EditorOpenPayload,
    emit_editor_open_from_backend as _emit_editor_open_from_backend_impl,
)
from .editor_client_registry import connected_editor_client_instance_ids
from .editor_backend_services.contracts import RuntimeMeta
from .editor_backend_services.document_materialization_service import (
    materialize_document_payload,
)
from .editor_rpc_contract import (
    EDITOR_RPC_NOTIFICATION_AGENT_EDITS_CHANGED,
    EDITOR_RPC_NOTIFICATION_CACHE_STATE,
    EDITOR_RPC_NOTIFICATION_DIAGNOSTICS_COUNTS,
    EDITOR_RPC_NOTIFICATION_DRAFT_STATE,
    EDITOR_RPC_NOTIFICATION_FILE_JUMP_TO_LINE,
    EDITOR_RPC_NOTIFICATION_FILE_OPENED,
    EDITOR_RPC_NOTIFICATION_FIND_COMMAND,
    EDITOR_RPC_NOTIFICATION_EDIT_COMMAND,
    EDITOR_RPC_NOTIFICATION_GIT_BASELINES,
    EDITOR_RPC_NOTIFICATION_ISSUES_COMMAND,
    EDITOR_RPC_NOTIFICATION_ISSUES_DUMP_REQUEST,
    EDITOR_RPC_NOTIFICATION_MIRROR_UPDATED,
    EDITOR_RPC_NOTIFICATION_NOTIFY,
    EDITOR_RPC_NOTIFICATION_OPEN_COMPLETE,
    EDITOR_RPC_NOTIFICATION_PREFS_CHANGED,
    EDITOR_RPC_NOTIFICATION_PROJECT_SWITCHED,
    EDITOR_RPC_NOTIFICATION_PROJECT_SWITCHING,
    EDITOR_RPC_NOTIFICATION_READY,
    EDITOR_RPC_NOTIFICATION_SAVE_SNAPSHOT_REQUEST,
    EDITOR_RPC_NOTIFICATION_SEARCH_HIGHLIGHT,
    EDITOR_RPC_NOTIFICATION_STATE_SSOT,
    EditorRpcNotification,
)
from .editor_rpc_emit import emit_editor_rpc_notification
import logging as _logging
_wb_log = _logging.getLogger("editor_ws.workbench")

_history_store = get_history_store()
_preferences_store = get_preferences_store()


class ActiveProjectFn(Protocol):
    def __call__(self) -> str | None: ...


class NormalizeAbsPathFn(Protocol):
    def __call__(self, path: str) -> str | None: ...


class IsUnderProjectFn(Protocol):
    def __call__(self, project: str, abs_path: str) -> bool: ...


class ReadFilePayloadFn(Protocol):
    def __call__(self, project: str, abs_path: str) -> EditorOpenPayload: ...


class EmitEditorOpenFn(Protocol):
    def __call__(self, payload: EditorOpenPayload) -> Awaitable[None]: ...


_ISSUES_DUMP_WAITING: dict[str, tuple[str, asyncio.Future[dict[str, object]]]] = {}
_ISSUES_DUMP_TTL_S = 20.0
_SAVE_SNAPSHOT_WAITING: dict[str, tuple[str, asyncio.Future[dict[str, object]]]] = {}
_project_switch_seq = 0

# Tracks SHA256 of the most recent editor-initiated save per abs path.
# Used to suppress watcher reload for our own saves.
_LAST_SAVE_SHA: dict[str, str] = {}


def _coerce_generation(raw: object) -> Optional[int]:
    try:
        if raw is None or raw == "":
            return None
        if isinstance(raw, int):
            return raw
        if isinstance(raw, str) and raw.isdigit():
            return int(raw)
        return None
    except Exception:
        return None


def editor_runtime_active_project() -> Optional[str]:
    return _active_project()


def editor_runtime_is_under_project(project: str, abs_path: str) -> bool:
    return _is_under_project(project, abs_path)


def editor_runtime_coerce_generation(raw: object) -> Optional[int]:
    return _coerce_generation(raw)


def _runtime_meta() -> RuntimeMeta:
    return {
        "run_id": os.getenv("TE_RUN_ID", "unknown"),
        "shell_id": os.getenv("TE_FRAMEWORK_SHELL_ID", "unknown"),
        "shell_run_id": os.getenv("TE_FRAMEWORK_SHELL_RUN_ID", "unknown"),
        "launcher_pid": int(os.getenv("TE_LAUNCHER_PID", "0")),
        "worker_pid": os.getpid(),
    }


def _active_project() -> Optional[str]:
    project = _history_store.get_active_project()
    if not project:
        return None
    try:
        p = str(Path(project).expanduser().resolve(strict=False))
        return p
    except Exception:
        return project


def _normalize_abs_path(path: str) -> Optional[str]:
    if not path.strip():
        return None
    try:
        return str(Path(path).expanduser().resolve(strict=False))
    except Exception:
        return path.strip()


def _is_under_project(project: str, abs_path: str) -> bool:
    try:
        root = Path(project).expanduser().resolve(strict=False)
        p = Path(abs_path).expanduser().resolve(strict=False)
        if p == root:
            return True
        return str(p).startswith(str(root) + os.sep)
    except Exception:
        return False


async def _emit_open_state_changed(
    open_state: SidecarOpenStatePayload,
    *,
    client_foreground: ClientForegroundPayload | None = None,
    source: str | None = None,
    request_id: str | None = None,
    project_generation: int | None = None,
) -> None:
    await publish_open_state_changed(
        open_state,
        client_foreground=client_foreground,
        source=source,
        request_id=request_id,
        project_generation=project_generation,
    )


def _next_project_switch_id() -> str:
    global _project_switch_seq
    _project_switch_seq += 1
    return f"project_switch_{int(time.time() * 1000)}_{_project_switch_seq}"


async def _emit_project_switch_notification(
    *,
    phase: str,
    project: str,
    display_path: str | None = None,
    source: str | None = None,
    reason: str | None = None,
    switch_id: str | None = None,
    status: str | None = None,
    error: str | None = None,
    open_state: dict[str, object] | None = None,
    adapter_status: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "phase": phase,
        "operation": "project_open",
        "projectPath": project,
        "displayPath": display_path or project,
        "switchId": switch_id or _next_project_switch_id(),
        "ts": int(time.time() * 1000),
    }
    if isinstance(source, str) and source:
        payload["source"] = source
    if isinstance(reason, str) and reason:
        payload["reason"] = reason
    if isinstance(status, str) and status:
        payload["status"] = status
    if isinstance(error, str) and error:
        payload["error"] = error
    if isinstance(adapter_status, str) and adapter_status:
        payload["adapterStatus"] = adapter_status
    if open_state is not None:
        payload["openState"] = dict(open_state)

    if phase == "begin":
        editor_method = EDITOR_RPC_NOTIFICATION_PROJECT_SWITCHING
        ui_method = UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHING
    else:
        editor_method = EDITOR_RPC_NOTIFICATION_PROJECT_SWITCHED
        ui_method = UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHED

    print(
        "[project_switch] emit "
        f"phase={phase} project={project} switchId={payload['switchId']} "
        f"status={status or ''} adapterStatus={adapter_status or ''}",
        flush=True,
    )

    try:
        await _emit_editor_rpc_notification_to_room(
            editor_method,
            payload,
            room="code_te2",
        )
    except Exception:
        pass
    try:
        await _emit_ui_ipc_editor_notification(ui_method, payload)
    except Exception:
        pass
    return payload


async def editor_runtime_emit_project_switching(
    project: str,
    *,
    display_path: str | None = None,
    source: str | None = None,
    reason: str | None = None,
) -> dict[str, object]:
    return await _emit_project_switch_notification(
        phase="begin",
        project=project,
        display_path=display_path,
        source=source,
        reason=reason,
    )


async def editor_runtime_emit_project_switched(
    project: str,
    *,
    display_path: str | None = None,
    source: str | None = None,
    reason: str | None = None,
    switch_id: str | None = None,
    status: str = "ready",
    error: str | None = None,
    open_state: dict[str, object] | None = None,
    adapter_status: str | None = None,
) -> dict[str, object]:
    return await _emit_project_switch_notification(
        phase="end",
        project=project,
        display_path=display_path,
        source=source,
        reason=reason,
        switch_id=switch_id,
        status=status,
        error=error,
        open_state=open_state,
        adapter_status=adapter_status,
    )


def _notify_draft_state_changed_safe(project: str) -> None:
    try:
        from ..explorer.services.runtime_notifications import notify_draft_state_changed

        notify_draft_state_changed(project)
    except Exception:
        pass


def editor_runtime_normalize_abs_path(path: str) -> Optional[str]:
    return _normalize_abs_path(path)


def editor_runtime_read_file_payload(project: str, abs_path: str) -> EditorOpenPayload:
    return _read_file_payload(project, abs_path)


def editor_runtime_record_sidecar_open_file(
    project: str,
    abs_path: str,
    *,
    client_instance_id: str,
    reason: str = "file_open",
) -> tuple[SidecarOpenStatePayload, ClientForegroundPayload]:
    return write_client_document_open(
        project,
        abs_path,
        client_instance_id,
        reason=reason,
    )


async def editor_runtime_emit_open_state_changed(
    open_state: SidecarOpenStatePayload,
    *,
    client_foreground: ClientForegroundPayload | None = None,
    source: str | None = None,
    request_id: str | None = None,
    project_generation: int | None = None,
) -> None:
    await _emit_open_state_changed(
        open_state,
        client_foreground=client_foreground,
        source=source,
        request_id=request_id,
        project_generation=project_generation,
    )


def editor_runtime_meta() -> RuntimeMeta:
    return _runtime_meta()


def editor_runtime_notify_draft_state_changed(project: str) -> None:
    _notify_draft_state_changed_safe(project)


async def editor_runtime_reload_disk_content_if_active(
    abs_path: str,
    *,
    source: str,
    request_id: str | None = None,
) -> bool:
    project = _active_project()
    target = _normalize_abs_path(abs_path)
    if not project or not target or not _is_under_project(project, target):
        return False

    payload = _read_file_payload(project, target)
    payload["source"] = source
    payload["reason"] = "discard_external"
    payload["request_id"] = request_id or f"draft_discard_{int(time.time() * 1000)}"
    emitted = False
    for foreground in list_client_foregrounds(
        project,
        reason="disk_content_reload",
    ):
        if _normalize_abs_path(foreground["path"] or "") != target:
            continue
        await editor_runtime_emit_room_event(
            "editor:open",
            payload,
            client_instance_id=foreground["clientInstanceId"],
        )
        emitted = True
    return emitted


def editor_runtime_record_save_sha(abs_path: str, sha256: str) -> None:
    _LAST_SAVE_SHA[abs_path] = sha256


def editor_runtime_read_disk_text(path: str) -> str:
    return _read_disk_text(path)


def editor_runtime_git_head_text(project: str, abs_path: str) -> str | None:
    return _git_head_text(project, abs_path)


def editor_runtime_record_file_activity(project: str, abs_path: str, *, scroll_line: float | None = None) -> None:
    if scroll_line is not None:
        _history_store.update_file_scroll_line(project, abs_path, scroll_line)


def editor_runtime_get_cached_document(project: str, abs_path: str) -> dict[str, object] | None:
    return _history_store.get_cached_document(project, abs_path)


async def editor_runtime_request_save_snapshot(
    request_id: str,
    *,
    client_instance_id: str,
    timeout_s: float = 3.0,
) -> dict[str, object]:
    loop = asyncio.get_running_loop()
    fut: asyncio.Future[dict[str, object]] = loop.create_future()
    waiting = (client_instance_id, fut)
    _SAVE_SNAPSHOT_WAITING[request_id] = waiting
    try:
        await _emit_editor_rpc_notification_to_room(
            EDITOR_RPC_NOTIFICATION_SAVE_SNAPSHOT_REQUEST,
            {"requestId": request_id, "request_id": request_id, "requestedAtMs": int(time.time() * 1000)},
            room=client_presentation_room(client_instance_id),
        )
        return await asyncio.wait_for(fut, timeout=timeout_s)
    finally:
        if _SAVE_SNAPSHOT_WAITING.get(request_id) is waiting:
            _SAVE_SNAPSHOT_WAITING.pop(request_id, None)


def editor_runtime_resolve_save_snapshot_response(data: dict[str, object]) -> None:
    request_id = data.get("requestId") or data.get("request_id")
    source_client = data.get("source_client")
    if not isinstance(request_id, str) or not isinstance(source_client, str):
        return
    waiting = _SAVE_SNAPSHOT_WAITING.get(request_id)
    if waiting is None or waiting[0] != source_client or waiting[1].done():
        return
    waiting[1].set_result(dict(data))


async def editor_runtime_request_issues_dump(
    request_id: str,
    *,
    client_instance_id: str,
    timeout_s: float = 10.0,
) -> dict[str, object]:
    loop = asyncio.get_running_loop()
    fut: asyncio.Future[dict[str, object]] = loop.create_future()
    waiting = (client_instance_id, fut)
    _ISSUES_DUMP_WAITING[request_id] = waiting
    try:
        await editor_runtime_emit_room_event(
            "editor:issues_dump_request",
            {"requestId": request_id, "requestedAtMs": int(time.time() * 1000)},
            client_instance_id=client_instance_id,
        )
        return await asyncio.wait_for(fut, timeout=timeout_s)
    finally:
        if _ISSUES_DUMP_WAITING.get(request_id) is waiting:
            _ISSUES_DUMP_WAITING.pop(request_id, None)


def editor_runtime_build_connect_snapshot(
    *,
    role: str = "",
    client_instance_id: str | None,
    reason: str = "reconnect",
) -> dict[str, object]:
    project = _active_project()
    session_state = _history_store.get_session_state()
    prefs = _preferences_store.get_preferences(project) if project else {}
    open_state: SidecarOpenStatePayload | None = None
    current_path: object = None
    client_foreground: dict[str, object] | None = None
    if project and client_instance_id is not None:
        try:
            open_state = read_sidecar_open_state(project, reason=reason)
            client_foreground = dict(
                read_client_foreground(project, client_instance_id, reason=reason)
            )
            current_path = client_foreground.get("path")
        except Exception:
            current_path = None

    snapshot: dict[str, object] = {
        "project": project,
        "session_state": session_state,
        "preferences": prefs,
        "currentPath": current_path,
    }
    if client_instance_id is not None:
        snapshot["clientInstanceId"] = client_instance_id
    if open_state is not None:
        snapshot["openState"] = dict(open_state)
    if client_foreground is not None:
        snapshot["clientForeground"] = client_foreground
    if role != "host" and project and current_path:
        abs_path = _normalize_abs_path(str(current_path))
        if abs_path and _is_under_project(project, abs_path):
            connect_request_id = f"diag_{int(time.time() * 1000)}_rpc"
            snapshot["file"] = _read_file_payload(project, abs_path)
            snapshot["file"]["request_id"] = connect_request_id
    return snapshot


async def editor_runtime_replay_sidecar_open_state(
    project: str,
    *,
    reason: str = "sidecar_replay",
    source: str | None = None,
    project_generation: int | None = None,
) -> dict[str, object]:
    """Project the new shared project and each live client's own foreground."""
    resolved_source = source or reason
    open_state = read_sidecar_open_state(project, reason=reason)
    await publish_open_state_changed(
        open_state,
        source=resolved_source,
        project_generation=project_generation,
    )

    for client_instance_id in connected_editor_client_instance_ids():
        snapshot = editor_runtime_build_connect_snapshot(
            client_instance_id=client_instance_id,
            reason=reason,
        )
        file_obj = snapshot.get("file")
        if isinstance(file_obj, dict):
            file_obj["reason"] = reason
            file_obj["request_id"] = (
                f"project_switch_{int(time.time() * 1000)}_{client_instance_id}"
            )
        await _emit_editor_rpc_notification_to_room(
            EDITOR_RPC_NOTIFICATION_STATE_SSOT,
            snapshot,
            room=client_presentation_room(client_instance_id),
        )
        client_foreground_obj = snapshot.get("clientForeground")
        if isinstance(client_foreground_obj, dict):
            await publish_client_foreground_changed(
                open_state,
                cast(
                    ClientForegroundPayload,
                    cast(object, client_foreground_obj),
                ),
                source=resolved_source,
                project_generation=project_generation,
            )

    return dict(open_state)


async def _emit_editor_rpc_notification_to_room(
    method: EditorRpcNotification,
    payload: dict[str, object],
    *,
    room: str,
) -> None:
    async def _emit(event_name: str, notification_payload: bytes) -> None:
        await emit_code_te2_socketio(
            event_name,
            notification_payload,
            room=room,
            namespace="/rpc/editor",
        )

    await emit_editor_rpc_notification(
        _emit,
        method,
        payload,
    )


def _rpc_notification_for_legacy_event(event_name: str) -> EditorRpcNotification | None:
    mapping: dict[str, EditorRpcNotification] = {
        "editor:open": EDITOR_RPC_NOTIFICATION_FILE_OPENED,
        "editor:jump_to_line": EDITOR_RPC_NOTIFICATION_FILE_JUMP_TO_LINE,
        "editor:git_baselines": EDITOR_RPC_NOTIFICATION_GIT_BASELINES,
        "editor:mirror": EDITOR_RPC_NOTIFICATION_MIRROR_UPDATED,
        "editor:cache_state": EDITOR_RPC_NOTIFICATION_CACHE_STATE,
        "editor:draft_state": EDITOR_RPC_NOTIFICATION_DRAFT_STATE,
        "editor:prefs_changed": EDITOR_RPC_NOTIFICATION_PREFS_CHANGED,
        "editor:notify": EDITOR_RPC_NOTIFICATION_NOTIFY,
        "editor:open_complete": EDITOR_RPC_NOTIFICATION_OPEN_COMPLETE,
        "editor:diagnostics_counts": EDITOR_RPC_NOTIFICATION_DIAGNOSTICS_COUNTS,
        "editor:ready": EDITOR_RPC_NOTIFICATION_READY,
        "editor:issues_dump_request": EDITOR_RPC_NOTIFICATION_ISSUES_DUMP_REQUEST,
        "editor:issues_cmd": EDITOR_RPC_NOTIFICATION_ISSUES_COMMAND,
        "editor:find_cmd": EDITOR_RPC_NOTIFICATION_FIND_COMMAND,
        "editor:edit_cmd": EDITOR_RPC_NOTIFICATION_EDIT_COMMAND,
        "editor:search_highlight": EDITOR_RPC_NOTIFICATION_SEARCH_HIGHLIGHT,
        "editor:agent_edits_changed": EDITOR_RPC_NOTIFICATION_AGENT_EDITS_CHANGED,
    }
    return mapping.get(event_name)


def _ui_ipc_notification_for_legacy_event(event_name: str) -> str | None:
    mapping: dict[str, str] = {
        "editor:cache_state": UI_IPC_RPC_NOTIFICATION_EDITOR_CACHE_STATE,
        "editor:draft_state": UI_IPC_RPC_NOTIFICATION_EDITOR_DRAFT_STATE,
        "editor:notify": UI_IPC_RPC_NOTIFICATION_EDITOR_NOTIFY,
        "editor:open_complete": UI_IPC_RPC_NOTIFICATION_EDITOR_OPEN_COMPLETE,
        "editor:diagnostics_counts": UI_IPC_RPC_NOTIFICATION_EDITOR_DIAGNOSTICS_COUNTS,
        "editor:ready": UI_IPC_RPC_NOTIFICATION_EDITOR_READY,
    }
    return mapping.get(event_name)


async def _emit_ui_ipc_editor_notification(
    method: str,
    payload: dict[str, object],
    *,
    client_instance_id: str | None = None,
) -> None:
    try:
        from ..ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

        await emit_ui_ipc_rpc_notification(
            method,
            payload,
            client_instance_id=client_instance_id,
        )
    except Exception as exc:
        _wb_log.warning("[ui_ipc_bridge] failed method=%s err=%s", method, exc)


_CLIENT_SCOPED_EDITOR_EVENTS = {
    "editor:open",
    "editor:jump_to_line",
    "editor:git_baselines",
    "editor:notify",
    "editor:open_complete",
    "editor:diagnostics_counts",
    "editor:ready",
    "editor:issues_dump_request",
    "editor:issues_cmd",
    "editor:find_cmd",
    "editor:edit_cmd",
    "editor:search_highlight",
}


async def editor_runtime_emit_room_event(
    event_name: str,
    payload: Mapping[str, object],
    *,
    client_instance_id: str | None = None,
) -> None:
    event_payload = dict(payload)
    room = "code_te2"
    if event_name in _CLIENT_SCOPED_EDITOR_EVENTS:
        if client_instance_id is None:
            raise ValueError(f"client_identity_required:{event_name}")
        room = client_presentation_room(client_instance_id)
    rpc_notification = _rpc_notification_for_legacy_event(event_name)
    if rpc_notification:
        await _emit_editor_rpc_notification_to_room(rpc_notification, event_payload, room=room)
    ui_ipc_notification = _ui_ipc_notification_for_legacy_event(event_name)
    if ui_ipc_notification:
        await _emit_ui_ipc_editor_notification(
            ui_ipc_notification,
            event_payload,
            client_instance_id=client_instance_id if room != "code_te2" else None,
        )


async def editor_runtime_handle_scroll_state(source_client: str, data: dict[str, object]) -> None:
    payload = dict(data)
    project = _active_project()
    if project:
        try:
            path_obj = payload.get("path")
            path = _normalize_abs_path(path_obj if isinstance(path_obj, str) else "")
        except Exception:
            path = None
        line = payload.get("line")
        if isinstance(line, str) and line.isdigit():
            line = int(line)
        if path and _is_under_project(project, path) and isinstance(line, (int, float)) and line and line > 0:
            try:
                _history_store.update_file_scroll_line(project, path, float(line))
            except Exception:
                pass

    payload["source_client"] = payload.get("source_client") or source_client
    await _emit_ui_ipc_editor_notification(
        UI_IPC_RPC_NOTIFICATION_EDITOR_SCROLL_STATE,
        payload,
    )


async def editor_runtime_handle_model_ready(source_client: str, data: dict[str, object]) -> None:
    path = _normalize_abs_path(str(data.get("path") or "")) or ""
    if not path:
        return
    generation = _coerce_generation(data.get("generation"))
    generation_key = str(generation) if generation is not None else "-"
    _wb_log.info(
        "[model_ready] sid=%s path=%s generation=%s source=%s",
        source_client,
        path,
        generation_key,
        str(data.get("source") or ""),
    )


async def editor_runtime_handle_issues_dump_response(source_client: str, data: dict[str, object]) -> None:
    request_id = data.get("requestId") or data.get("request_id")
    if not isinstance(request_id, str) or not request_id:
        return

    waiting = _ISSUES_DUMP_WAITING.get(request_id)
    if waiting is None or waiting[0] != source_client:
        return
    _ISSUES_DUMP_WAITING.pop(request_id, None)

    response_payload: dict[str, object] = {"requestId": request_id, "dump": data.get("dump")}
    future = waiting[1]
    if not future.done():
        future.set_result(response_payload)


async def editor_runtime_handle_breadcrumb_navigate(source_client: str, data: dict[str, object]) -> None:
    del source_client
    abs_path_obj = data.get("path", "")
    abs_path = abs_path_obj if isinstance(abs_path_obj, str) else ""
    open_drawer = data.get("open_drawer", False)
    if not abs_path:
        return

    project = _active_project()
    rel = abs_path
    is_external = True
    if project and abs_path.startswith(project):
        rel = abs_path[len(project):]
        if rel.startswith("/"):
            rel = rel[1:]
        if not rel:
            rel = "."
        is_external = False

    try:
        from ..explorer.transport.rpc_emit import emit_project_explorer_rpc_notification

        _wb_log.info("[bc-navigate] rel=%s abs=%s external=%s drawer=%s", rel, abs_path, is_external, open_drawer)
        await emit_project_explorer_rpc_notification(
            project,
            "explorer.navigate",
            {"rel": rel, "abs_path": abs_path, "is_external": is_external, "open_drawer": open_drawer},
        )
        _wb_log.info("[bc-navigate] emit OK")
    except Exception as exc:
        _wb_log.error("[bc-navigate] emit FAILED: %s", exc)


async def emit_editor_search_highlight_from_backend(
    payload: dict[str, object],
    *,
    client_instance_id: str,
) -> None:
    await editor_runtime_emit_room_event(
        "editor:search_highlight",
        payload,
        client_instance_id=client_instance_id,
    )


async def emit_editor_open_from_backend(
    payload_in: dict[str, object] | None,
    *,
    source_client: str,
    request_id: str,
    active_project: ActiveProjectFn | None = None,
    normalize_abs_path: NormalizeAbsPathFn | None = None,
    is_under_project: IsUnderProjectFn | None = None,
    read_file_payload: ReadFilePayloadFn | None = None,
    emit_editor_open: EmitEditorOpenFn | None = None,
) -> EditorOpenPayload:
    return await _emit_editor_open_from_backend_impl(
        payload_in,
        source_client=source_client,
        request_id=request_id,
        active_project=active_project or _active_project,
        normalize_abs_path=normalize_abs_path or _normalize_abs_path,
        is_under_project=is_under_project or _is_under_project,
        read_file_payload=read_file_payload or _read_file_payload,
        emit_editor_open=emit_editor_open
        or (
            lambda open_payload: editor_runtime_emit_room_event(
                "editor:open",
                open_payload,
                client_instance_id=source_client,
            )
        ),
        record_sidecar_open_file=editor_runtime_record_sidecar_open_file,
        emit_open_state_changed=editor_runtime_emit_open_state_changed,
    )


def _read_file_payload(project: str, abs_path: str) -> EditorOpenPayload:
    """Return SSOT-derived snapshot for a file (draft cache wins)."""

    payload: EditorOpenPayload = {"path": abs_path}
    prefs = _preferences_store.get_preferences(project)
    payload["preferences"] = prefs

    # Autosave mode is SSOT (PreferencesStore)
    auto_save = None
    try:
        editor_prefs_obj = prefs.get("editor")
        if isinstance(editor_prefs_obj, dict):
            editor_prefs = cast(dict[str, object], editor_prefs_obj)
            auto_save_raw = editor_prefs.get("autoSave")
            auto_save = auto_save_raw if isinstance(auto_save_raw, bool) else None
        else:
            auto_save = None
    except Exception:
        auto_save = None
    payload["auto_save"] = auto_save

    # Top-visible-line restore (project sidecar / HistoryStore).
    try:
        scroll_line = _history_store.get_file_scroll_line(project, abs_path)
    except Exception:
        scroll_line = None
    if isinstance(scroll_line, (int, float)) and scroll_line and scroll_line > 0:
        payload["scroll_line"] = float(scroll_line)

    cached = _history_store.get_cached_document(project, abs_path)
    materialized = materialize_document_payload(abs_path, cached)
    payload["content"] = materialized["content"]
    payload["has_draft"] = materialized["has_draft"]
    payload["state"] = materialized["state"]
    payload["unsaved"] = materialized["unsaved"]
    payload["reason"] = materialized["reason"]
    if "base_sha256" in materialized:
        payload["base_sha256"] = materialized["base_sha256"]
    if "content_sha256" in materialized:
        payload["content_sha256"] = materialized["content_sha256"]
    cached_revision = cached.get("document_revision") if cached else None
    payload["document_revision"] = (
        cached_revision
        if isinstance(cached_revision, int) and cached_revision >= 0
        else _history_store.get_document_revision(project, abs_path)
    )
    return payload


def _read_disk_text(abs_path: str) -> str:
    try:
        content_bytes = Path(abs_path).read_bytes()
        return content_bytes.decode("utf-8", errors="replace")
    except Exception:
        return ""


async def handle_external_file_change(changed_abs_path: str) -> bool:
    """Called when a watcher event indicates the active file changed on disk.

    Compares disk SHA against the last known base_sha256.  If different:
      - clears any draft for the file
      - broadcasts editor:open with reason="external_change"
    Returns True if a reload was broadcast, False otherwise.
    """
    project = _active_project()
    if not project:
        return False

    changed_norm = _normalize_abs_path(changed_abs_path)
    if not changed_norm:
        return False
    foregrounds = [
        foreground
        for foreground in list_client_foregrounds(
            project,
            reason="external_file_change",
        )
        if _normalize_abs_path(foreground["path"] or "") == changed_norm
    ]
    if not foregrounds:
        return False
    active_norm = changed_norm

    # Read fresh disk content
    try:
        disk_bytes = Path(active_norm).read_bytes()
        disk_text = disk_bytes.decode("utf-8", errors="replace")
    except FileNotFoundError:
        return False
    except Exception:
        return False

    disk_sha = hashlib.sha256(disk_text.encode("utf-8")).hexdigest()

    # Suppress watcher event triggered by our own save
    suppressed_sha = _LAST_SAVE_SHA.get(active_norm)
    if suppressed_sha and suppressed_sha == disk_sha:
        _LAST_SAVE_SHA.pop(active_norm, None)
        return False

    # Check against cached draft / last known SHA
    cached = _history_store.get_cached_document(project, active_norm)
    last_sha = None
    if cached:
        last_sha = cached.get("base_sha256") or cached.get("content_sha256")

    # For clean files (no draft), the watcher event itself is evidence of a
    # change — reload unconditionally so the editor stays current.
    # For draft files, verify the SHA actually differs from what we know.
    if last_sha and disk_sha == last_sha:
        return False  # No actual change

    # External edit confirmed — clear draft if present
    cleared_draft = False
    if cached and cached.get("unsaved"):
        try:
            cleared_draft = _history_store.clear_cached_document(project, active_norm)
            print(f"[editor_ws] external change: cleared draft for {active_norm}", flush=True)
        except Exception as e:
            print(f"[editor_ws] external change: draft clear failed: {e}", flush=True)

        try:
            from ..explorer.services.file_ops import mark_draft_cache_dirty
            mark_draft_cache_dirty()
        except Exception:
            pass

    if not cleared_draft:
        _ = _history_store.advance_document_revision(project, active_norm)

    # Reload only the clients presenting this document.
    try:
        payload = _read_file_payload(project, active_norm)
        payload["reason"] = "external_change"
        payload["request_id"] = f"ext_{int(time.time() * 1000)}"
        for foreground in foregrounds:
            await editor_runtime_emit_room_event(
                "editor:open",
                payload,
                client_instance_id=foreground["clientInstanceId"],
            )
        print(f"[editor_ws] external change: broadcast editor:open for {active_norm}", flush=True)
    except Exception as e:
        print(f"[editor_ws] external change: broadcast failed: {e}", flush=True)
        return False

    # Mark git cache dirty for explorer decorations
    try:
        from ..explorer.services.file_ops import mark_git_cache_dirty
        mark_git_cache_dirty()
    except Exception:
        pass

    return True


async def broadcast_git_baselines_for_active_file() -> bool:
    """Push fresh baselines for each client's active document.

    Called when git state changes (commits, checkouts, etc.) so the diff
    editor's original model updates even in draft mode where autosave
    doesn't trigger the refresh.
    """
    print("[git_baselines_push] broadcast_git_baselines_for_active_file called", flush=True)
    project = _active_project()
    if not project:
        print("[git_baselines_push] no active project, skipping", flush=True)
        return False

    foregrounds = list_client_foregrounds(project, reason="git_baselines_push")
    if not foregrounds:
        print("[git_baselines_push] no client foregrounds, skipping", flush=True)
        return False
    emitted = False
    try:
        payloads: dict[str, dict[str, object]] = {}
        for foreground in foregrounds:
            active_norm = _normalize_abs_path(foreground["path"] or "")
            if not active_norm or not _is_under_project(project, active_norm):
                continue
            payload = payloads.get(active_norm)
            if payload is None:
                disk = _read_disk_text(active_norm)
                disk_sha = hashlib.sha256(disk.encode("utf-8")).hexdigest()
                head = _git_head_text(project, active_norm)
                head_sha = (
                    hashlib.sha256(head.encode("utf-8")).hexdigest()
                    if isinstance(head, str)
                    else None
                )
                payload = cast(dict[str, object], {
                    "path": active_norm,
                    "tracked": bool(head is not None),
                    "base_ref": "HEAD",
                    "disk_content": disk,
                    "disk_sha256": disk_sha,
                    "head_content": head,
                    "head_sha256": head_sha,
                })
                payloads[active_norm] = payload
            await editor_runtime_emit_room_event(
                "editor:git_baselines",
                payload,
                client_instance_id=foreground["clientInstanceId"],
            )
            emitted = True
        return emitted
    except Exception as e:
        print(f"[git_baselines_push] FAILED: {e}", flush=True)
        return False


def _git_head_text(project_root: str, abs_path: str) -> Optional[str]:
    """Return the file content at HEAD (or None if untracked / no commits)."""

    try:
        root = Path(project_root).expanduser().resolve(strict=False)
        p = Path(abs_path).expanduser().resolve(strict=False)
    except Exception:
        return None

    # Compute a repo-relative path for `git show HEAD:<path>`.
    try:
        rel = p.relative_to(root).as_posix()
    except Exception:
        return None

    if not rel:
        return None
    return worker_git_service.read_head_blob_text(root, rel)
