# pyright: strict
from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import Protocol

from .contracts import EditorOpenFields, EditorOpenPayload
from .payload_utils import get_opt_int, get_opt_str, get_str
from ...open_state_backend import SidecarOpenStatePayload


class EmitHostActiveFileChangedFn(Protocol):
    def __call__(
        self,
        project: str,
        abs_path: str | None,
        *,
        source: str | None = None,
        request_id: str | None = None,
    ) -> Awaitable[None]: ...


class RecordSidecarOpenFileFn(Protocol):
    def __call__(
        self,
        project: str,
        abs_path: str,
        *,
        reason: str,
    ) -> SidecarOpenStatePayload: ...


class EmitOpenStateChangedFn(Protocol):
    def __call__(
        self,
        open_state: SidecarOpenStatePayload,
        *,
        source: str | None = None,
        request_id: str | None = None,
    ) -> Awaitable[None]: ...


def coerce_editor_open_request_fields(
    payload_in: Mapping[str, object],
    request_id: str,
    *,
    active_project: Callable[[], str | None],
    normalize_abs_path: Callable[[str], str | None],
    is_under_project: Callable[[str, str], bool],
) -> EditorOpenFields:
    path = normalize_abs_path(get_str(payload_in, "path", ""))
    if not path:
        raise ValueError("missing_path")

    project = active_project()
    if not project:
        raise ValueError("no_active_project")
    if not is_under_project(project, path):
        raise ValueError("outside_project")

    line = get_opt_int(payload_in, "line")
    column = get_opt_int(payload_in, "column")
    scroll_y = get_opt_str(payload_in, "scroll_y") or get_opt_str(payload_in, "scrollY")
    focus = payload_in.get("focus")
    scroll_to_top_raw: object | None = payload_in.get("scroll_to_top") if "scroll_to_top" in payload_in else payload_in.get("scrollToTop")

    if line is not None and line < 1:
        line = 1
    if column is not None and column < 1:
        column = 1
    if focus is not None and not isinstance(focus, bool):
        focus = None
    scroll_to_top_bool = scroll_to_top_raw if isinstance(scroll_to_top_raw, bool) else None

    return {
        "project": project,
        "path": path,
        "request_id": request_id,
        "line": line,
        "column": column,
        "scroll_y": scroll_y,
        "focus": focus if isinstance(focus, bool) else None,
        "scroll_to_top": scroll_to_top_bool,
    }


async def emit_editor_open_from_backend(
    payload_in: Mapping[str, object] | None,
    *,
    source_client: str,
    request_id: str,
    active_project: Callable[[], str | None],
    normalize_abs_path: Callable[[str], str | None],
    is_under_project: Callable[[str, str], bool],
    read_file_payload: Callable[[str, str], EditorOpenPayload],
    update_session_state: Callable[[dict[str, object]], object],
    set_last_file: Callable[[str, str], object],
    emit_editor_open: Callable[[EditorOpenPayload], Awaitable[None]],
    broadcast_active_file_update: Callable[[str, str], Awaitable[None]],
    emit_host_active_file_changed: EmitHostActiveFileChangedFn,
    record_sidecar_open_file: RecordSidecarOpenFileFn,
    emit_open_state_changed: EmitOpenStateChangedFn,
) -> EditorOpenPayload:
    del set_last_file, broadcast_active_file_update, emit_host_active_file_changed
    normalized = dict(payload_in) if isinstance(payload_in, Mapping) else {}
    fields = coerce_editor_open_request_fields(
        normalized,
        request_id,
        active_project=active_project,
        normalize_abs_path=normalize_abs_path,
        is_under_project=is_under_project,
    )
    project = fields["project"]
    path = fields["path"]

    open_state = record_sidecar_open_file(project, path, reason="file_open")
    update_session_state({"currentPath": path})

    payload = read_file_payload(project, path)
    payload["source_client"] = source_client
    payload["request_id"] = request_id
    explicit_reason = get_str(normalized, "reason", "")
    if explicit_reason:
        payload["reason"] = explicit_reason

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
    source = get_str(normalized, "source", source_client)
    await emit_open_state_changed(open_state, source=source, request_id=request_id)
    return payload
