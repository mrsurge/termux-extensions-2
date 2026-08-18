# pyright: strict
from __future__ import annotations

from pathlib import Path
import time

from ..explorer.services.file_ops import get_project_root
from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..monaco_editor.editor_ws import (
    editor_runtime_active_project,
    editor_runtime_emit_room_event,
    editor_runtime_is_under_project,
    editor_runtime_normalize_abs_path,
    editor_runtime_notify_draft_state_changed,
    editor_runtime_reload_disk_content_if_active,
)
from ..stores import get_history_store


def _string_value(data: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _active_project(data: dict[str, object]) -> str:
    explicit = _string_value(data, "project", "projectRoot", "project_root")
    if explicit:
        return str(Path(explicit).expanduser().resolve(strict=False))
    history = get_history_store()
    active = history.get_active_project() or editor_runtime_active_project() or str(get_project_root())
    if not active:
        raise ValueError("no active project")
    return str(Path(active).expanduser().resolve(strict=False))


def _target_path(data: dict[str, object], project: str) -> str:
    raw_path = _string_value(data, "path", "abs", "file", "rel")
    if not raw_path:
        raise ValueError("path is required")
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        candidate = Path(project).expanduser() / raw_path.lstrip("/")
    normalized = editor_runtime_normalize_abs_path(str(candidate))
    if not normalized:
        raise ValueError("path is required")
    if not editor_runtime_is_under_project(project, normalized):
        raise PermissionError("path is outside active project root")
    return normalized


async def handle_host_draft_discard_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    project = _active_project(data)
    target = _target_path(data, project)
    history = get_history_store()
    cleared = history.clear_cached_document(project, target)

    if cleared:
        document_revision = history.get_document_revision(project, target)
        editor_runtime_notify_draft_state_changed(project)
        await editor_runtime_emit_room_event(
            "editor:cache_state",
            {
                "path": target,
                "state": "clean",
                "unsaved": False,
                "reason": "discard_external",
                "document_revision": document_revision,
            },
        )

    request_id = _string_value(data, "request_id", "requestId") or f"host_draft_discard_{int(time.time() * 1000)}"
    source = _string_value(data, "source") or source_name
    reloaded = False
    if cleared:
        reloaded = await editor_runtime_reload_disk_content_if_active(
            target,
            source=source,
            request_id=request_id,
        )

    return {
        "ok": True,
        "data": {
            "path": target,
            "project": project,
            "cleared": cleared,
            "reloaded": reloaded,
            "request_id": request_id,
            "document_revision": history.get_document_revision(project, target),
        },
    }
