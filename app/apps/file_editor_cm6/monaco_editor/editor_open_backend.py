# pyright: strict
from __future__ import annotations

from typing import Any, Awaitable, Callable, Optional, TypedDict


class EditorOpenFields(TypedDict):
    project: str
    path: str
    request_id: str
    line: int | None
    column: int | None
    scroll_y: str | None
    focus: bool | None
    scroll_to_top: bool | None


class EditorOpenPayload(TypedDict, total=False):
    path: str
    source_client: str
    request_id: str
    line: int
    column: int
    scroll_y: str
    focus: bool
    scroll_to_top: bool
    source: str
    content: str
    base_sha256: str
    content_sha256: str
    state: str
    unsaved: bool
    auto_save: bool | None
    has_draft: bool
    reason: str
    scroll_line: float


def coerce_editor_open_request_fields(
    payload_in: dict[str, Any],
    request_id: str,
    *,
    active_project: Callable[[], Optional[str]],
    normalize_abs_path: Callable[[str], Optional[str]],
    is_under_project: Callable[[str, str], bool],
) -> EditorOpenFields:
    path = normalize_abs_path(str(payload_in.get("path", "")))
    if not path:
        raise ValueError("missing_path")

    project = active_project()
    if not project:
        raise ValueError("no_active_project")
    if not is_under_project(project, path):
        raise ValueError("outside_project")

    line = payload_in.get("line")
    column = payload_in.get("column")
    scroll_y = payload_in.get("scroll_y") or payload_in.get("scrollY")
    focus = payload_in.get("focus")
    scroll_to_top = payload_in.get("scroll_to_top") or payload_in.get("scrollToTop")

    if isinstance(line, str) and line.isdigit():
        line = int(line)
    if isinstance(column, str) and column.isdigit():
        column = int(column)
    if not isinstance(line, int):
        line = None
    if not isinstance(column, int):
        column = None
    if line is not None and line < 1:
        line = 1
    if column is not None and column < 1:
        column = 1
    if scroll_y is not None and not isinstance(scroll_y, str):
        scroll_y = None
    if focus is not None and not isinstance(focus, bool):
        focus = None
    if scroll_to_top is not None and not isinstance(scroll_to_top, bool):
        scroll_to_top = None

    return {
        "project": project,
        "path": path,
        "request_id": request_id,
        "line": line,
        "column": column,
        "scroll_y": scroll_y,
        "focus": focus,
        "scroll_to_top": scroll_to_top,
    }


async def emit_editor_open_from_backend(
    payload_in: dict[str, Any] | None,
    *,
    source_client: str,
    request_id: str,
    active_project: Callable[[], Optional[str]],
    normalize_abs_path: Callable[[str], Optional[str]],
    is_under_project: Callable[[str, str], bool],
    read_file_payload: Callable[[str, str], dict[str, Any]],
    update_session_state: Callable[[dict[str, object]], None],
    set_last_file: Callable[[str, str], None],
    emit_editor_open: Callable[[EditorOpenPayload], Awaitable[None]],
    broadcast_active_file_update: Callable[[str, str], Awaitable[None]],
    emit_host_active_file_changed: Callable[..., Awaitable[None]],
) -> EditorOpenPayload:
    normalized = payload_in if isinstance(payload_in, dict) else {}
    fields = coerce_editor_open_request_fields(
        normalized,
        request_id,
        active_project=active_project,
        normalize_abs_path=normalize_abs_path,
        is_under_project=is_under_project,
    )
    project = fields["project"]
    path = fields["path"]

    update_session_state({"currentPath": path})
    set_last_file(project, path)

    payload = read_file_payload(project, path)
    payload["source_client"] = source_client
    payload["request_id"] = request_id

    line = fields["line"]
    column = fields["column"]
    scroll_y = fields["scroll_y"]
    focus = fields["focus"]
    scroll_to_top = fields["scroll_to_top"]

    if line is not None:
        payload.pop("scroll_line", None)
        payload["line"] = line
    if column is not None:
        payload["column"] = column
    if scroll_y is not None:
        payload["scroll_y"] = scroll_y
    if focus is not None:
        payload["focus"] = focus
    if scroll_to_top is not None:
        payload["scroll_to_top"] = scroll_to_top

    await emit_editor_open(payload)
    await broadcast_active_file_update(project, path)
    await emit_host_active_file_changed(
        project,
        path,
        source=str(normalized.get("source") or source_client or ""),
        request_id=request_id,
    )
    return payload
