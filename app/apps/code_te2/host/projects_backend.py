"""Production Projects modal services; transport only delivers these DTOs."""
# pyright: strict
from __future__ import annotations

import asyncio
from pathlib import Path

from ..history_store import HistoryStore
from ..project_sidecar import ProjectSidecar
from ..stores import get_history_store
from ..main_page.backend.project_service import normalize_history_project_path
from .project_backend import handle_host_project_open_request

JsonObject = dict[str, object]


def _known_path(params: JsonObject) -> str:
    raw = params.get("path")
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("path is required")
    path = normalize_history_project_path(raw.strip())
    if not any(entry.get("path") == path for entry in get_history_store().list_projects()):
        raise ValueError("Project is no longer in recent projects; refresh Projects")
    return path


def _is_active(path: str) -> bool:
    active = get_history_store().get_active_project()
    return bool(active and normalize_history_project_path(active) == path)


def _list_projects() -> JsonObject:
    history = get_history_store()
    active = history.get_active_project()
    rows: list[JsonObject] = []
    for entry in history.list_projects():
        path = entry.get("path")
        if not isinstance(path, str) or not path:
            continue
        sidecar_path = ProjectSidecar.get_sidecar_path(path)
        row: JsonObject = {
            "path": path, "label": entry.get("label") or HistoryStore.format_label(path),
            "opened_at": entry.get("opened_at"), "is_active": path == active,
            "sidecar_path": str(sidecar_path), "sidecar_exists": sidecar_path.exists(),
            "session_count": None, "last_boot_at": None, "draft_count": 0,
        }
        if row["sidecar_exists"]:
            try:
                # Inspect an independent snapshot off-loop, not a cached mutable
                # sidecar that another RPC may be updating on the worker loop.
                sidecar = ProjectSidecar(path)
                row.update(session_count=sidecar.session_count, last_boot_at=sidecar.last_boot_at,
                           draft_count=sidecar.get_draft_count())
            except Exception as exc:
                # One unreadable sidecar must not hide all recent projects.
                row["metadata_error"] = str(exc)
        rows.append(row)
    return {"ok": True, "data": rows}


async def handle_projects_list() -> JsonObject:
    # Listing may stat many sidecars; it does not own any state mutation.
    return await asyncio.to_thread(_list_projects)


async def _project_reset_notifications(path: str, source: str) -> None:
    from ..explorer.services.file_ops import mark_draft_cache_dirty, mark_git_cache_dirty
    from ..explorer.services.state_facts import publish_git_diff_base_changed
    from ..diff_helper import invalidate_diff_cache
    from ..monaco_editor.editor_ws import (
        editor_runtime_notify_draft_state_changed, editor_runtime_replay_sidecar_open_state,
    )

    root = Path(path)
    mark_draft_cache_dirty(root)
    mark_git_cache_dirty(root)
    invalidate_diff_cache(root)
    editor_runtime_notify_draft_state_changed(path)
    _ = await editor_runtime_replay_sidecar_open_state(path, reason="no_file", source=source)
    await publish_git_diff_base_changed(root, ref="HEAD", refresh=True, source=source)


async def handle_projects_reset(params: JsonObject, *, source_name: str) -> JsonObject:
    path = _known_path(params)
    if not _is_active(path):
        raise ValueError("Active project changed; refresh Projects and confirm Reset again")
    # Check and persist in one worker-loop turn. Do not yield and accidentally
    # reset a project that changed while a confirmation dialog was open.
    history = get_history_store()
    if not history.reset_project_history(path):
        raise RuntimeError("Project history could not be reset")
    sidecar = ProjectSidecar.load_or_create(path)
    sidecar.clear_recent_files()
    sidecar.clear_session_cache()
    sidecar.clear_tracked_jobs()
    _ = sidecar.set_diff_base("HEAD")
    _ = sidecar.bump_open_state_revision()
    sidecar.save()
    await _project_reset_notifications(path, f"{source_name}:projects_reset")
    return {"ok": True, "data": {"history_reset": True, "is_active": True}}


async def handle_projects_remove(params: JsonObject, *, source_name: str) -> JsonObject:
    del source_name
    path = _known_path(params)
    if _is_active(path):
        raise ValueError("Project is now active; refresh Projects and confirm Reset instead")
    # Only the known sidecar/history entry is removed, never project files.
    sidecar_path = ProjectSidecar.get_sidecar_path(path)
    deleted = sidecar_path.exists()
    sidecar_path.unlink(missing_ok=True)
    # Forget cached state too, or reopening this path can resurrect old drafts.
    ProjectSidecar.load_or_create(path).reload()
    if not get_history_store().remove_project(path):
        raise RuntimeError("Project entry could not be removed")
    return {"ok": True, "data": {"removed": True, "sidecar_deleted": deleted, "is_active": False}}


async def handle_projects_open(params: JsonObject, *, source_name: str) -> JsonObject:
    path = _known_path(params)
    # The established switch service owns all clients, WBA and Explorer state.
    return await handle_host_project_open_request({"path": path}, source_name=source_name)
