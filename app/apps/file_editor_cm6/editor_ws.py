import hashlib
import os
from pathlib import Path
from typing import Any, Dict, Optional
import time

import socketio

from .stores import _history_store, _preferences_store

_ISSUES_DUMP_WAITING: dict[str, str] = {}
_ISSUES_DUMP_TTL_S = 20.0


def _runtime_meta() -> dict:
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
    if not isinstance(path, str) or not path.strip():
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


def _read_file_payload(project: str, abs_path: str) -> Dict[str, Any]:
    """Return SSOT-derived snapshot for a file (draft cache wins)."""

    payload: Dict[str, Any] = {"path": abs_path}
    prefs = _preferences_store.get_preferences(project)
    payload["preferences"] = prefs

    # Autosave mode is SSOT (PreferencesStore)
    auto_save = None
    try:
        auto_save = bool(prefs.get("editor", {}).get("autoSave"))  # type: ignore[assignment]
    except Exception:
        auto_save = None
    payload["auto_save"] = auto_save

    cached = _history_store.get_cached_document(project, abs_path)
    if cached and cached.get("unsaved"):
        payload.update(
            {
                "has_draft": True,
                "content": cached.get("content", ""),
                "base_sha256": cached.get("base_sha256"),
                "content_sha256": cached.get("content_sha256"),
                "state": "mid_session",
                "unsaved": True,
                "reason": "restore",
            }
        )
        return payload

    try:
        content_bytes = Path(abs_path).read_bytes()
        content = content_bytes.decode("utf-8", errors="replace")
    except Exception:
        content = ""
    sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
    payload.update(
        {
            "has_draft": False,
            "content": content,
            "base_sha256": sha256,
            "content_sha256": sha256,
            "state": "clean",
            "unsaved": False,
            "reason": "disk",
        }
    )
    return payload


class EditorSocketIONamespace(socketio.AsyncNamespace):
    """Dedicated editor Socket.IO namespace.

    Contract:
    - SSOT snapshot on connect (`editor:ssot`).
    - `editor:open_request` -> server validates + broadcasts `editor:open`.
    - `editor:mirror` -> server persists draft cache + broadcasts to other clients.
    """

    async def on_connect(self, sid, environ, auth):
        await self.enter_room(sid, "file_editor_cm6")
        project = _active_project()
        session_state = _history_store.get_session_state()
        prefs = _preferences_store.get_preferences(project) if project else {}

        current_path = session_state.get("currentPath")
        if not current_path and project:
            current_path = _history_store.get_last_file(project)

        snapshot: Dict[str, Any] = {
            "project": project,
            "session_state": session_state,
            "preferences": prefs,
            "currentPath": current_path,
        }

        if project and current_path:
            abs_path = _normalize_abs_path(str(current_path))
            if abs_path and _is_under_project(project, abs_path):
                snapshot["file"] = _read_file_payload(project, abs_path)

        await self.emit("editor:ssot", snapshot, room=sid)

    async def on_disconnect(self, sid):
        try:
            await self.leave_room(sid, "file_editor_cm6")
        except Exception:
            pass

    async def on_editor_cache_state(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            return
        payload = dict(payload)
        payload["source_client"] = sid
        await self.emit("editor:cache_state", payload, room="file_editor_cm6")

    async def on_editor_scroll_state(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            return
        payload = dict(payload)
        payload["source_client"] = sid
        await self.emit("editor:scroll_state", payload, room="file_editor_cm6")

    async def on_editor_draft_state(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            return
        payload = dict(payload)
        payload["source_client"] = sid
        await self.emit("editor:draft_state", payload, room="file_editor_cm6")

    async def on_editor_notify(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            return
        payload = dict(payload)
        payload["source_client"] = sid
        await self.emit("editor:notify", payload, room="file_editor_cm6")

    async def on_editor_ready(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            payload = {}
        payload = dict(payload)
        payload["source_client"] = sid
        await self.emit("editor:ready", payload, room="file_editor_cm6")

    async def on_editor_issues_dump_request(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            payload = {}
        request_id = payload.get("requestId") or payload.get("request_id")
        if not isinstance(request_id, str) or not request_id:
            return
        _ISSUES_DUMP_WAITING[request_id] = sid
        # Attach a timestamp so stale requests can be ignored client-side if desired.
        await self.emit(
            "editor:issues_dump_request",
            {"requestId": request_id, "requestedAtMs": int(time.time() * 1000)},
            room="file_editor_cm6",
        )

    async def on_editor_issues_dump_response(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            return
        request_id = payload.get("requestId") or payload.get("request_id")
        if not isinstance(request_id, str) or not request_id:
            return

        host_sid = _ISSUES_DUMP_WAITING.pop(request_id, None)
        if not host_sid:
            return

        try:
            await self.emit(
                "editor:issues_dump_response",
                {"requestId": request_id, "dump": payload.get("dump")},
                room=host_sid,
            )
        except Exception:
            return

    async def on_editor_open_request(self, sid, data):
        project = _active_project()
        if not project:
            await self.emit("editor:error", {"error": "no_active_project"}, room=sid)
            return
        path = _normalize_abs_path((data or {}).get("path", ""))
        if not path:
            await self.emit("editor:error", {"error": "missing_path"}, room=sid)
            return
        if not _is_under_project(project, path):
            await self.emit("editor:error", {"error": "outside_project"}, room=sid)
            return

        # Update SSOT session state (single-doc model).
        _history_store.update_session_state({"currentPath": path})
        _history_store.set_last_file(project, path)

        payload = _read_file_payload(project, path)
        payload["source_client"] = sid

        await self.emit("editor:open", payload, room="file_editor_cm6")

    async def on_editor_prefs_changed(self, sid, data):
        """Worker-hosted preference updates -> broadcast to editor clients.

        Matches the explorer pattern: clients emit underscore events; server re-broadcasts
        colon events to all connected editor clients.
        """

        payload = data or {}
        if not isinstance(payload, dict):
            return
        payload = dict(payload)
        payload["source_client"] = payload.get("source_client") or sid
        await self.emit("editor:prefs_changed", payload, room="file_editor_cm6")

    async def on_editor_mirror(self, sid, data):
        project = _active_project()
        if not project:
            return
        payload = data or {}
        path = _normalize_abs_path(payload.get("path", ""))
        if not path or not _is_under_project(project, path):
            return

        content = payload.get("content")
        if not isinstance(content, str):
            return

        base_sha256 = payload.get("base_sha256")
        if not isinstance(base_sha256, str) or len(base_sha256) != 64:
            # If client doesn't provide it, treat as "always unsaved".
            base_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()

        meta = _runtime_meta()
        entry = _history_store.upsert_cached_document(
            project_path=project,
            file_path=path,
            content=content,
            base_sha256=base_sha256,
            run_id=meta["run_id"],
            shell_id=meta["shell_id"],
            shell_run_id=meta["shell_run_id"],
            launcher_pid=meta["launcher_pid"],
            worker_pid=meta["worker_pid"],
        )

        await self.emit(
            "editor:mirror",
            {
                "path": path,
                "content": content,
                "base_sha256": base_sha256,
                "content_sha256": entry.get("content_sha256"),
                "unsaved": bool(entry.get("unsaved")),
                "source_client": sid,
            },
            room="file_editor_cm6",
        )
