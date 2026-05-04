# pyright: strict
from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Protocol, cast

from ..explorer.services.file_ops import get_project_root
from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..monaco_editor.editor_ws import (
    editor_runtime_active_project,
    editor_runtime_emit_room_event,
    editor_runtime_git_head_text,
    editor_runtime_is_under_project,
    editor_runtime_normalize_abs_path,
    editor_runtime_read_disk_text,
    editor_runtime_record_file_activity,
    editor_runtime_request_issues_dump,
)
from ..stores import get_history_store


class SocketIOEmitter(Protocol):
    async def emit(
        self,
        event: str,
        data: object,
        *,
        room: str | None = None,
        namespace: str | None = None,
    ) -> None: ...


def _coerce_positive_int(value: object, *, default: int | None = None) -> int | None:
    if isinstance(value, int):
        return value if value > 0 else default
    if isinstance(value, str) and value.isdigit():
        parsed = int(value)
        return parsed if parsed > 0 else default
    return default


def _coerce_optional_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _active_project_or_raise() -> str:
    project = editor_runtime_active_project() or str(get_project_root())
    if not project:
        raise ValueError("no active project")
    return project


def _resolve_editor_path(data: dict[str, object], project: str) -> str:
    history = get_history_store()
    raw_path = str(
        data.get("path")
        or data.get("currentPath")
        or history.get_last_file(project)
        or history.get_session_state().get("currentPath")
        or ""
    ).strip()
    if not raw_path:
        raise ValueError("missing path")

    candidate = Path(raw_path).expanduser() if raw_path.startswith("/") else Path(project).expanduser() / raw_path
    normalized = editor_runtime_normalize_abs_path(str(candidate))
    if not normalized:
        raise ValueError("missing path")
    if not editor_runtime_is_under_project(project, normalized):
        raise PermissionError("path is outside active project root")
    return normalized


async def handle_host_editor_jump_to_line_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    project = _active_project_or_raise()
    path = _resolve_editor_path(data, project)
    line = _coerce_positive_int(data.get("line"))
    if line is None:
        raise ValueError("missing line")
    column = _coerce_positive_int(data.get("column"), default=1) or 1
    scroll_y = data.get("scroll_y") or data.get("scrollY")
    if not isinstance(scroll_y, str):
        scroll_y = None
    focus = _coerce_optional_bool(data.get("focus"))
    scroll_to_top_value = data.get("scroll_to_top") if "scroll_to_top" in data else data.get("scrollToTop")
    scroll_to_top = _coerce_optional_bool(scroll_to_top_value)

    editor_runtime_record_file_activity(project, path, scroll_line=float(line))
    payload: JsonMap = {
        "path": path,
        "line": line,
        "column": column,
        "scroll_y": scroll_y,
        "focus": focus,
        "scroll_to_top": scroll_to_top,
        "source_client": source_name,
    }
    await editor_runtime_emit_room_event("editor:jump_to_line", payload)
    return {"ok": True, "path": path, "line": line, "column": column}


async def handle_host_editor_git_baselines_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    project = _active_project_or_raise()
    path = _resolve_editor_path(data, project)

    disk = editor_runtime_read_disk_text(path)
    disk_sha = hashlib.sha256(disk.encode("utf-8")).hexdigest()
    head = editor_runtime_git_head_text(project, path)
    head_sha = hashlib.sha256(head.encode("utf-8")).hexdigest() if isinstance(head, str) else None

    payload: JsonMap = {
        "path": path,
        "tracked": bool(head is not None),
        "base_ref": "HEAD",
        "disk_content": disk,
        "disk_sha256": disk_sha,
        "head_content": head,
        "head_sha256": head_sha,
        "source_client": source_name,
    }
    await editor_runtime_emit_room_event("editor:git_baselines", payload)
    return {"ok": True, "path": path, "tracked": bool(head is not None)}


async def handle_host_editor_find_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    action_obj = data.get("action")
    action = str(action_obj or ("replace" if data.get("replace") else "find"))
    if action not in {"find", "replace"}:
        action = "find"
    reason = str(data.get("reason") or "host")
    await editor_runtime_emit_room_event(
        "editor:find_cmd",
        {"action": action, "reason": reason, "source_client": source_name},
    )
    return {"ok": True, "action": action}


async def handle_host_editor_issues_command_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    action = str(data.get("action") or "")
    if not action:
        raise ValueError("missing action")
    await editor_runtime_emit_room_event(
        "editor:issues_cmd",
        {"action": action, "source_client": source_name},
    )
    return {"ok": True, "action": action}


async def handle_host_editor_issues_dump_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    request_id = str(data.get("request_id") or data.get("requestId") or f"host_issues_dump_{int(time.time() * 1000)}")
    timeout_s_obj = data.get("timeout_s")
    timeout_s = float(timeout_s_obj) if isinstance(timeout_s_obj, (int, float)) and timeout_s_obj > 0 else 10.0
    response = await editor_runtime_request_issues_dump(request_id, timeout_s=timeout_s)
    return {
        "ok": True,
        "request_id": request_id,
        "requestId": request_id,
        "dump": response.get("dump"),
        "source_client": source_name,
    }


async def handle_host_diagnostics_mention_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    from ..ui_ipc.ui_ipc_socketio import UI_IPC_SIO

    path = data.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ValueError("missing path for diagnostics mention")

    payload: JsonMap = {"path": path.strip(), "source": "diagnostics"}
    for key in ("lineNo", "endLineNo", "col", "endCol", "content"):
        value = data.get(key)
        if value is not None:
            payload[key] = value

    ui_ipc_sio = cast(SocketIOEmitter, UI_IPC_SIO)
    await ui_ipc_sio.emit(
        "sidebar:mention",
        payload,
        namespace="/sidebar_ipc",
        room="sidebar_ipc",
    )
    return {"ok": True}
