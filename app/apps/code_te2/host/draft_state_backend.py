# pyright: strict
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import time
from typing import cast
from urllib.parse import unquote, urlparse

from .. import draft_diff_helper as _draft_diff_helper
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

_compute_draft_diff = cast(
    Callable[[str, str, str], JsonMap],
    _draft_diff_helper.compute_draft_diff,
)


def _string_value(data: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalize_project_path(value: str) -> str:
    return str(Path(value).expanduser().resolve(strict=False))


def _active_project(data: dict[str, object]) -> str:
    explicit = _string_value(data, "projectPath", "project", "projectRoot", "project_root")
    if explicit:
        return _normalize_project_path(explicit)
    history = get_history_store()
    active = history.get_active_project() or editor_runtime_active_project() or str(get_project_root())
    if not active:
        raise ValueError("no active project")
    return _normalize_project_path(str(active))


def _uri_to_path(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "file":
        return value
    return unquote(parsed.path or "")


def _target_value(data: dict[str, object]) -> str:
    target = data.get("target")
    if isinstance(target, str) and target.strip():
        return target.strip()
    if isinstance(target, dict):
        target_map = cast(dict[object, object], target)
        normalized = {str(key): item for key, item in target_map.items() if isinstance(key, str)}
        nested = _string_value(
            normalized,
            "uri",
            "path",
            "targetFile",
            "target_file",
            "file",
            "rel",
        )
        if nested:
            return nested
    return _string_value(
        data,
        "uri",
        "targetFile",
        "target_file",
        "path",
        "file",
        "rel",
    )


def _target_path(data: dict[str, object], project: str) -> str:
    raw_path = _target_value(data)
    if not raw_path:
        raise ValueError("target is required")
    candidate_text = _uri_to_path(raw_path)
    candidate = Path(candidate_text).expanduser()
    if not candidate.is_absolute():
        candidate = Path(project).expanduser() / candidate_text.lstrip("/")
    normalized = editor_runtime_normalize_abs_path(str(candidate))
    if not normalized:
        raise ValueError("target is required")
    if not editor_runtime_is_under_project(project, normalized):
        raise PermissionError("target is outside active project root")
    return normalized


def _rel_path(project: str, target: str) -> str:
    try:
        return Path(target).resolve(strict=False).relative_to(Path(project).resolve(strict=False)).as_posix()
    except Exception:
        return Path(target).name


def _target_payload(project: str, target: str) -> JsonMap:
    return {
        "path": target,
        "rel": _rel_path(project, target),
        "uri": Path(target).resolve(strict=False).as_uri(),
    }


def _entry_string(entry: dict[str, object], key: str) -> str:
    value = entry.get(key)
    return value if isinstance(value, str) else ""


def _entry_int(entry: dict[str, object], key: str) -> int:
    value = entry.get(key)
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def _draft_summary(project: str, entry: dict[str, object]) -> JsonMap:
    target = _entry_string(entry, "file_path")
    return {
        "path": target,
        "rel": _rel_path(project, target) if target else "",
        "uri": Path(target).resolve(strict=False).as_uri() if target else "",
        "unsaved": bool(entry.get("unsaved")),
        "contentLength": _entry_int(entry, "content_length"),
        "contentSha256": _entry_string(entry, "content_sha256"),
        "baseSha256": _entry_string(entry, "base_sha256"),
        "updatedAt": _entry_string(entry, "updated_at"),
    }


def _read_disk_content(target: str) -> str | None:
    try:
        return Path(target).read_text(encoding="utf-8")
    except Exception:
        return None


def _draft_detail(
    project: str,
    target: str,
    entry: dict[str, object] | None,
) -> JsonMap:
    if entry is None:
        return {
            "ok": True,
            "scope": "file",
            "projectPath": project,
            "targetFile": target,
            "target": _target_payload(project, target),
            "rel": _rel_path(project, target),
            "hasDraft": False,
            "draft": None,
        }

    draft = _draft_summary(project, entry)
    content = entry.get("content")
    draft_content = content if isinstance(content, str) else ""
    disk_content = _read_disk_content(target)
    draft_diff: JsonMap = {
        "hunks": [],
        "summary": {"added": 0, "deleted": 0, "tracked": False},
    }
    if disk_content is not None:
        diff_payload = _compute_draft_diff(target, draft_content, disk_content)
        hunks = diff_payload.get("hunks")
        summary = diff_payload.get("summary")
        draft_diff["hunks"] = hunks if isinstance(hunks, list) else []
        draft_diff["summary"] = summary if isinstance(summary, dict) else {"added": 0, "deleted": 0, "tracked": False}
        error = diff_payload.get("error")
        if isinstance(error, str):
            draft_diff["error"] = error
    else:
        draft_diff["error"] = "disk content unavailable"
    draft["diff"] = draft_diff
    draft["hunks"] = draft_diff["hunks"]
    draft["summary"] = draft_diff["summary"]

    return {
        "ok": True,
        "scope": "file",
        "projectPath": project,
        "targetFile": target,
        "target": _target_payload(project, target),
        "rel": _rel_path(project, target),
        "hasDraft": True,
        "draft": draft,
    }


async def handle_sidebar_drafts_list_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    project = _active_project(data)
    entries = get_history_store().list_project_drafts(project)
    drafts = [_draft_summary(project, dict(entry)) for entry in entries]
    return {
        "ok": True,
        "scope": "project",
        "projectPath": project,
        "draftCount": len(drafts),
        "drafts": drafts,
    }


async def handle_sidebar_draft_state_get_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    project = _active_project(data)
    scope = _string_value(data, "scope") or ("file" if _target_value(data) else "project")
    history = get_history_store()

    if scope == "file":
        target = _target_path(data, project)
        entry = history.get_cached_document(project, target)
        return _draft_detail(
            project,
            target,
            dict(entry) if isinstance(entry, dict) else None,
        )

    entries = history.list_project_drafts(project)
    drafts: list[JsonMap] = []
    for entry_obj in entries:
        entry = dict(entry_obj)
        target = _entry_string(entry, "file_path")
        summary = _draft_summary(project, entry)
        if target:
            detail = _draft_detail(
                project,
                target,
                entry,
            )
            draft_obj = detail.get("draft")
            if isinstance(draft_obj, dict):
                detail_map = cast(dict[str, object], draft_obj)
                summary["diff"] = detail_map.get("diff", {"hunks": [], "summary": {"added": 0, "deleted": 0, "tracked": False}})
                summary["hunks"] = detail_map.get("hunks", [])
                summary["summary"] = detail_map.get("summary", {"added": 0, "deleted": 0, "tracked": False})
        drafts.append(summary)
    return {
        "ok": True,
        "scope": "project",
        "projectPath": project,
        "draftCount": len(drafts),
        "drafts": drafts,
    }


async def handle_sidebar_draft_clear_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    project = _active_project(data)
    target = _target_path(data, project)
    request_id = _string_value(data, "requestId", "request_id") or f"sidebar_draft_clear_{int(time.time() * 1000)}"
    source = _string_value(data, "source") or source_name

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
                "reason": "sidebar_draft_clear",
                "document_revision": document_revision,
            },
        )

    reloaded = False
    if cleared:
        reloaded = await editor_runtime_reload_disk_content_if_active(
            target,
            source=source,
            request_id=request_id,
        )

    return {
        "ok": True,
        "projectPath": project,
        "target": _target_payload(project, target),
        "cleared": cleared,
        "reloaded": reloaded,
        "documentRevision": history.get_document_revision(project, target),
        "requestId": request_id,
        "source": source,
    }
