# pyright: strict
from __future__ import annotations

import time
from pathlib import Path

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
from ..monaco_editor.editor_view_state_backend import (
    build_editor_git_baselines_payload,
    build_editor_jump_to_line_payload,
)
from ..stores import get_history_store


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
    payload = build_editor_jump_to_line_payload(
        {**data, "path": path},
        source_client=source_name,
        active_project=editor_runtime_active_project,
        normalize_abs_path=editor_runtime_normalize_abs_path,
        is_under_project=editor_runtime_is_under_project,
        record_file_activity=editor_runtime_record_file_activity,
    )
    await editor_runtime_emit_room_event("editor:jump_to_line", payload)
    return {
        "ok": True,
        "path": path,
        "line": payload.get("line", 1),
        "column": payload.get("column", 1),
    }


async def handle_host_editor_git_baselines_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    project = _active_project_or_raise()
    path = _resolve_editor_path(data, project)
    payload = build_editor_git_baselines_payload(
        {**data, "path": path},
        source_client=source_name,
        active_project=editor_runtime_active_project,
        normalize_abs_path=editor_runtime_normalize_abs_path,
        is_under_project=editor_runtime_is_under_project,
        read_disk_text=editor_runtime_read_disk_text,
        git_head_text=editor_runtime_git_head_text,
    )
    await editor_runtime_emit_room_event("editor:git_baselines", payload)
    return {"ok": True, "path": path, "tracked": bool(payload.get("tracked"))}


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


async def handle_host_editor_command_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    command = str(data.get("command") or "").strip()
    allowed = {"undo", "redo", "cut", "copy", "paste", "selectAll"}
    if command not in allowed:
        raise ValueError("unsupported editor command")
    await editor_runtime_emit_room_event(
        "editor:edit_cmd",
        {"command": command, "source_client": source_name},
    )
    return {"ok": True, "command": command}


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
    from ..ui_ipc.sidebar_ws import emit_sidebar_mention_targeted

    path = data.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ValueError("missing path for diagnostics mention")

    payload: JsonMap = {"path": path.strip(), "source": "diagnostics"}
    payload["target"] = data.get("target", {})
    for key in ("lineNo", "endLineNo", "col", "endCol", "content"):
        value = data.get(key)
        if value is not None:
            payload[key] = value

    return await emit_sidebar_mention_targeted(payload)
