import hashlib
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Optional

import anyio
import socketio

from ..draft_diff_helper import compute_draft_diff
from ..core_read import emit_diff_changed, init_watcher, push_save_ack
from ..core_write import BaseMismatchError, _get_file_meta, write_full
from ..diff_helper import invalidate_diff_cache
from ..explorer_helper import _normalize_rel_path, mark_draft_cache_dirty, mark_git_cache_dirty
from ..git_helper import _run_git_optional, is_git_repository
from ..stores import _history_store, _preferences_store

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


def _read_disk_text(abs_path: str) -> str:
    try:
        content_bytes = Path(abs_path).read_bytes()
        return content_bytes.decode("utf-8", errors="replace")
    except Exception:
        return ""


def _git_head_text(project_root: str, abs_path: str) -> Optional[str]:
    """Return the file content at HEAD (or None if untracked / no commits)."""

    try:
        root = Path(project_root).expanduser().resolve(strict=False)
        p = Path(abs_path).expanduser().resolve(strict=False)
    except Exception:
        return None

    if not is_git_repository(root):
        return None

    # Compute a repo-relative path for `git show HEAD:<path>`.
    try:
        rel = p.relative_to(root).as_posix()
    except Exception:
        return None

    if not rel:
        return None

    # If the repo has no commits, HEAD doesn't exist.
    head = _run_git_optional(root, "rev-parse", "--verify", "HEAD")
    if head is None:
        return None

    # `git show` returns non-zero for untracked paths.
    # IMPORTANT: do not strip output; we want the exact blob content.
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), "show", f"HEAD:{rel}"],
            check=False,
            capture_output=True,
            timeout=20,
        )
    except Exception:
        return None
    if completed.returncode != 0:
        return None
    try:
        return completed.stdout.decode("utf-8", errors="replace")
    except Exception:
        return completed.stdout.decode(errors="replace")


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

    async def on_editor_git_baselines_request(self, sid, data):
        """Return HEAD snapshot + disk snapshot for pinned Git diff baselines.

        This does NOT consider the current draft buffer. The contract is:
          - HEAD snapshot (original)
          - Disk snapshot (modified baseline)
        The client may edit a separate live model while keeping the diff baselines pinned.
        """

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

        disk = _read_disk_text(path)
        disk_sha = hashlib.sha256(disk.encode("utf-8")).hexdigest()

        head = _git_head_text(project, path)
        head_sha = None
        if isinstance(head, str):
            head_sha = hashlib.sha256(head.encode("utf-8")).hexdigest()

        payload: Dict[str, Any] = {
            "path": path,
            "tracked": bool(head is not None),
            "base_ref": "HEAD",
            "disk_content": disk,
            "disk_sha256": disk_sha,
            "head_content": head,
            "head_sha256": head_sha,
            "source_client": sid,
        }
        await self.emit("editor:git_baselines", payload, room=sid)

    async def on_editor_draft_diff_request(self, sid, data):
        """Return draft diff hunks for the currently cached draft (disk ↔ draft buffer).

        This is separate from Git diffs (HEAD ↔ disk baseline) and is intended to be rendered
        as custom decorations on the client.

        Contract:
          - If there is no draft cached for the file, return an empty hunks list.
          - Never throws; failures return empty hunks + error string.
        """

        start = time.time()
        payload_in = data or {}
        request_id = None
        if isinstance(payload_in, dict):
            request_id = payload_in.get("requestId") or payload_in.get("request_id")
            if not isinstance(request_id, str) or not request_id:
                request_id = None

        project = _active_project()
        if not project:
            await self.emit("editor:error", {"error": "no_active_project"}, room=sid)
            return

        path = _normalize_abs_path(payload_in.get("path", "") if isinstance(payload_in, dict) else "")
        if not path:
            await self.emit("editor:error", {"error": "missing_path"}, room=sid)
            return
        if not _is_under_project(project, path):
            await self.emit("editor:error", {"error": "outside_project"}, room=sid)
            return

        try:
            disk_content = _read_disk_text(path)
            disk_sha256 = hashlib.sha256(disk_content.encode("utf-8")).hexdigest()

            cached = _history_store.get_cached_document(project, path)
            if not cached or not cached.get("unsaved"):
                await self.emit(
                    "editor:draft_diff",
                    {
                        "path": path,
                        "hunks": [],
                        "summary": {"added": 0, "deleted": 0, "tracked": False},
                        "disk_sha256": disk_sha256,
                        "content_sha256": cached.get("content_sha256") if cached else None,
                        "requestId": request_id,
                        "ms": int((time.time() - start) * 1000),
                        "source_client": sid,
                    },
                    room=sid,
                )
                return

            draft_content = cached.get("content", "")
            diff_data = compute_draft_diff(path, draft_content, disk_content)
            hunks = diff_data.get("hunks", []) if isinstance(diff_data, dict) else []
            summary = diff_data.get("summary", {"added": 0, "deleted": 0, "tracked": False}) if isinstance(diff_data, dict) else {"added": 0, "deleted": 0, "tracked": False}
            error = diff_data.get("error") if isinstance(diff_data, dict) else None

            await self.emit(
                "editor:draft_diff",
                {
                    "path": path,
                    "hunks": hunks,
                    "summary": summary,
                    "error": error,
                    "disk_sha256": disk_sha256,
                    "content_sha256": cached.get("content_sha256"),
                    "requestId": request_id,
                    "ms": int((time.time() - start) * 1000),
                    "source_client": sid,
                },
                room=sid,
            )
        except Exception as exc:
            await self.emit(
                "editor:draft_diff",
                {
                    "path": path,
                    "hunks": [],
                    "summary": {"added": 0, "deleted": 0, "tracked": False},
                    "error": str(exc),
                    "requestId": request_id,
                    "ms": int((time.time() - start) * 1000),
                    "source_client": sid,
                },
                room=sid,
            )

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

    async def on_editor_save_request(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            payload = {}


        project = _active_project()
        if not project:
            return {"ok": False, "error": "no_active_project"}

        raw_path = payload.get("path")
        if not raw_path:
            session_state = _history_store.get_session_state()
            raw_path = session_state.get("currentPath")

        abs_path = _normalize_abs_path(str(raw_path) if raw_path else "")
        if not abs_path:
            return {"ok": False, "error": "missing_path"}
        if not _is_under_project(project, abs_path):
            return {"ok": False, "error": "outside_project"}

        root_path = Path(project)
        try:
            init_watcher(root_path)
        except Exception:
            pass

        cached = _history_store.get_cached_document(project, abs_path)
        if not cached or not cached.get("content"):
            file_meta = _get_file_meta(Path(abs_path))
            return {"ok": True, "data": file_meta, "noop": True}

        if cached.get("unsaved") is False:
            file_meta = _get_file_meta(Path(abs_path))
            return {"ok": True, "data": file_meta, "noop": True}

        content = cached.get("content", "")
        if not isinstance(content, str):
            return {"ok": False, "error": "invalid_content"}

        base_sha256 = payload.get("base_sha256")
        if not isinstance(base_sha256, str) or len(base_sha256) != 64:
            base_sha256 = cached.get("base_sha256")

        if payload.get("force"):
            base_sha256 = None

        try:
            rel_path = _normalize_rel_path(root_path, str(abs_path))
        except Exception:
            return {"ok": False, "error": "path_invalid"}

        orig_mode = None
        abs_path_obj = Path(abs_path)
        if abs_path_obj.exists():
            try:
                orig_mode = abs_path_obj.stat().st_mode & 0o777
            except OSError:
                orig_mode = None

        try:
            await anyio.to_thread.run_sync(
                lambda: write_full(
                    root_path,
                    rel_path,
                    content,
                    base_sha256=base_sha256,
                    mode=orig_mode,
                )
            )
        except BaseMismatchError as exc:
            return {"ok": False, "error": "BASE_MISMATCH", "current_meta": exc.current_meta}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

        file_meta = _get_file_meta(Path(abs_path))

        _history_store.clear_cached_document(project, abs_path)
        _history_store.prune_clean_drafts(project)

        mark_git_cache_dirty(root_path)
        mark_draft_cache_dirty(root_path)

        try:
            from ..explorer_ws import notify_draft_state_changed

            notify_draft_state_changed(project)
        except Exception:
            pass

        op_id = payload.get("op_id") or f"editor_save_{int(time.time())}"
        client_id = payload.get("client_id") or "editor"
        push_save_ack(str(rel_path), op_id, client_id, file_meta)
        emit_diff_changed(str(rel_path), file_meta.get("sha256"))
        invalidate_diff_cache(root_path, str(rel_path))

        await self.emit(
            "editor:cache_state",
            {
                "path": abs_path,
                "state": "clean",
                "unsaved": False,
                "reason": "save",
                "content_sha256": file_meta.get("sha256"),
                "source_client": sid,
            },
            room="file_editor_cm6",
        )

        return {"ok": True, "data": file_meta}
