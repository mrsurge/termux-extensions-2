import hashlib
import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import anyio
import socketio
from urllib.parse import parse_qs

from ..draft_diff_helper import compute_draft_diff
from ..core_read import emit_diff_changed, init_watcher, push_save_ack
from ..core_write import BaseMismatchError, _get_file_meta, write_full
from ..diff_helper import invalidate_diff_cache
from ..explorer_helper import _normalize_rel_path, mark_draft_cache_dirty, mark_git_cache_dirty
from ..git_helper import _run_git_optional, is_git_repository
from ..stores import _history_store, _preferences_store

import logging as _logging
_wb_log = _logging.getLogger("editor_ws.workbench")

_ISSUES_DUMP_WAITING: dict[str, str] = {}
_ISSUES_DUMP_TTL_S = 20.0
_SAVE_SNAPSHOT_WAITING: dict[str, asyncio.Future] = {}
_WORKBENCH_PATH_LOCKS: dict[str, asyncio.Lock] = {}
_WORKBENCH_OPEN_BASELINE: dict[str, dict[str, Any]] = {}

# Tracks SHA256 of the most recent editor-initiated save per abs path.
# Used to suppress watcher reload for our own saves.
_LAST_SAVE_SHA: dict[str, str] = {}


def _workbench_get_lock(abs_path: str) -> asyncio.Lock:
    lock = _WORKBENCH_PATH_LOCKS.get(abs_path)
    if lock is None:
        lock = asyncio.Lock()
        _WORKBENCH_PATH_LOCKS[abs_path] = lock
    return lock


def _coerce_generation(raw: Any) -> Optional[int]:
    try:
        if raw is None or raw == "":
            return None
        return int(raw)
    except Exception:
        return None


def _mark_open_baseline(abs_path: str, generation: Optional[int]) -> None:
    _WORKBENCH_OPEN_BASELINE[abs_path] = {
        "generation": generation,
        "ts_ms": int(time.time() * 1000),
    }


def _has_open_baseline(abs_path: str, generation: Optional[int]) -> bool:
    baseline = _WORKBENCH_OPEN_BASELINE.get(abs_path)
    if not baseline:
        return False
    if generation is None:
        return True
    return baseline.get("generation") == generation


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


def _role_from_environ(environ: dict) -> str:
    """Best-effort role extraction from Socket.IO connect environ."""
    try:
        qs = environ.get("QUERY_STRING")
        if not qs:
            scope = environ.get("asgi.scope")
            if isinstance(scope, dict):
                qs_bytes = scope.get("query_string")
                if isinstance(qs_bytes, (bytes, bytearray)):
                    qs = qs_bytes.decode("utf-8", errors="ignore")
        if not qs:
            return ""
        params = parse_qs(qs, keep_blank_values=True)
        role = params.get("role", [""])[0]
        return str(role or "")
    except Exception:
        return ""


async def _broadcast_active_file_update(project: str, abs_path: str) -> None:
    """Emit active-file updates on both legacy explorer and RPC notification surfaces."""
    try:
        from ..explorer_manager import abs_to_rel

        rel = abs_to_rel(abs_path, project)
        if not rel or rel == ".":
            return

        try:
            from ..explorer_socketio import EXPLORER_SIO

            await EXPLORER_SIO.emit(
                "explorer:event",
                {"type": "explorer:activeFile", "payload": {"rel": rel, "abs": abs_path}},
                namespace="/explorer",
            )
        except Exception:
            pass

        try:
            from ..explorer_rpc_emit import emit_explorer_rpc_notification

            await emit_explorer_rpc_notification(
                "explorer.activeFile.updated",
                {"rel": rel, "abs": abs_path},
            )
        except Exception:
            pass
    except Exception:
        pass


async def _emit_host_active_file_changed(
    project: str,
    abs_path: str,
    *,
    source: str | None = None,
    request_id: str | None = None,
) -> None:
    try:
        from ..explorer_manager import abs_to_rel
        from ..ui_ipc.ui_ipc_socketio import UI_IPC_SIO

        rel = abs_to_rel(abs_path, project)
        payload: Dict[str, Any] = {
            "type": "active_file_changed",
            "path": abs_path,
            "rel": rel,
        }
        if isinstance(source, str) and source:
            payload["source"] = source
        if isinstance(request_id, str) and request_id:
            payload["request_id"] = request_id
        await UI_IPC_SIO.emit(
            "ui_event",
            payload,
            namespace="/ui_ipc",
            room="ui_ipc",
        )
    except Exception:
        pass


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

    # Scroll restore (project sidecar / HistoryStore).
    try:
        scroll_line = _history_store.get_file_scroll_line(project, abs_path)
    except Exception:
        scroll_line = None
    if isinstance(scroll_line, (int, float)) and scroll_line and scroll_line > 0:
        payload["scroll_line"] = float(scroll_line)

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


def _coerce_editor_open_request_fields(payload_in: dict, request_id: str) -> dict[str, Any]:
    path = _normalize_abs_path(payload_in.get("path", ""))
    if not path:
        raise ValueError("missing_path")

    project = _active_project()
    if not project:
        raise ValueError("no_active_project")
    if not _is_under_project(project, path):
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
    payload_in: dict | None,
    *,
    source_client: str,
    request_id: str,
) -> dict[str, Any]:
    normalized = payload_in if isinstance(payload_in, dict) else {}
    fields = _coerce_editor_open_request_fields(normalized, request_id)
    project = str(fields["project"])
    path = str(fields["path"])

    _history_store.update_session_state({"currentPath": path})
    _history_store.set_last_file(project, path)

    payload = _read_file_payload(project, path)
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

    from .editor_socketio import EDITOR_SIO

    await EDITOR_SIO.emit("editor:open", payload, room="file_editor_cm6", namespace="/editor")
    await _broadcast_active_file_update(project, path)
    await _emit_host_active_file_changed(
        project,
        path,
        source=str(normalized.get("source") or source_client or ""),
        request_id=request_id,
    )
    return payload


async def _request_editor_save_snapshot(ns: socketio.AsyncNamespace, request_id: str, *, timeout_s: float = 3.0) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()
    _SAVE_SNAPSHOT_WAITING[request_id] = future
    try:
        await ns.emit(
            "editor:save_snapshot_request",
            {"requestId": request_id, "requestedAtMs": int(time.time() * 1000)},
            room="file_editor_cm6",
        )
        payload = await asyncio.wait_for(future, timeout=timeout_s)
        return payload if isinstance(payload, dict) else {}
    finally:
        _SAVE_SNAPSHOT_WAITING.pop(request_id, None)


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

    active_path = _history_store.get_last_file(project)
    if not active_path:
        return False

    # Normalize for comparison
    try:
        active_norm = str(Path(active_path).resolve(strict=False))
        changed_norm = str(Path(changed_abs_path).resolve(strict=False))
    except Exception:
        return False

    if active_norm != changed_norm:
        return False

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
    if cached and cached.get("unsaved"):
        try:
            _history_store.clear_cached_document(project, active_norm)
            print(f"[editor_ws] external change: cleared draft for {active_norm}", flush=True)
        except Exception as e:
            print(f"[editor_ws] external change: draft clear failed: {e}", flush=True)

        try:
            from ..explorer_helper import mark_draft_cache_dirty
            mark_draft_cache_dirty()
        except Exception:
            pass

    # Broadcast fresh payload to all editor clients
    try:
        from .editor_socketio import EDITOR_SIO
        payload = _read_file_payload(project, active_norm)
        payload["reason"] = "external_change"
        payload["request_id"] = f"ext_{int(time.time() * 1000)}"
        await EDITOR_SIO.emit("editor:open", payload, room="file_editor_cm6", namespace="/editor")
        print(f"[editor_ws] external change: broadcast editor:open for {active_norm}", flush=True)
    except Exception as e:
        print(f"[editor_ws] external change: broadcast failed: {e}", flush=True)
        return False

    # Mark git cache dirty for explorer decorations
    try:
        from ..explorer_helper import mark_git_cache_dirty
        mark_git_cache_dirty()
    except Exception:
        pass

    return True


async def broadcast_git_baselines_for_active_file() -> bool:
    """Push fresh editor:git_baselines to all editor clients for the active file.

    Called when git state changes (commits, checkouts, etc.) so the diff
    editor's original model updates even in draft mode where autosave
    doesn't trigger the refresh.
    """
    print("[git_baselines_push] broadcast_git_baselines_for_active_file called", flush=True)
    project = _active_project()
    if not project:
        print("[git_baselines_push] no active project, skipping", flush=True)
        return False

    active_path = _history_store.get_last_file(project)
    if not active_path:
        print("[git_baselines_push] no active file, skipping", flush=True)
        return False

    active_norm = _normalize_abs_path(active_path)
    if not active_norm or not _is_under_project(project, active_norm):
        print(f"[git_baselines_push] path not under project: {active_path}", flush=True)
        return False

    try:
        disk = _read_disk_text(active_norm)
        disk_sha = hashlib.sha256(disk.encode("utf-8")).hexdigest()

        head = _git_head_text(project, active_norm)
        head_sha = None
        if isinstance(head, str):
            head_sha = hashlib.sha256(head.encode("utf-8")).hexdigest()

        print(f"[git_baselines_push] path={active_norm} tracked={head is not None} head_sha={head_sha} disk_sha={disk_sha}", flush=True)

        payload: Dict[str, Any] = {
            "path": active_norm,
            "tracked": bool(head is not None),
            "base_ref": "HEAD",
            "disk_content": disk,
            "disk_sha256": disk_sha,
            "head_content": head,
            "head_sha256": head_sha,
        }
        from .editor_socketio import EDITOR_SIO
        await EDITOR_SIO.emit("editor:git_baselines", payload, room="file_editor_cm6", namespace="/editor")
        print(f"[git_baselines_push] emitted editor:git_baselines for {active_norm}", flush=True)
        return True
    except Exception as e:
        print(f"[git_baselines_push] FAILED: {e}", flush=True)
        return False


async def handle_tracked_edit(edit_result: dict) -> None:
    """Dispatch a jump/open when trackAgentEdits is enabled and a new edit is detected.

    If the edited file is already active, emits ``editor:jump_to_line``.
    If a different file was edited, emits ``editor:open`` with a target line.
    Toolbar filename update flows through explorer:activeFile, not editor:cache_state.
    """
    project = _active_project()
    if not project:
        return

    # Check preference
    prefs = _preferences_store.get_preferences()
    if not prefs.get("editor", {}).get("trackAgentEdits", False):
        return

    abs_path = edit_result.get("path", "")
    rel_path = edit_result.get("rel_path", "")
    line = edit_result.get("line", 1)

    active_path = _history_store.get_last_file(project)
    try:
        active_norm = str(Path(active_path).resolve(strict=False)) if active_path else ""
        changed_norm = str(Path(abs_path).resolve(strict=False))
    except Exception:
        return

    from .editor_socketio import EDITOR_SIO

    if active_norm == changed_norm:
        # Same file — just jump
        await EDITOR_SIO.emit(
            "editor:jump_to_line",
            {"line": line, "column": 1, "scroll_to_top": False, "source_client": "change_ledger"},
            room="file_editor_cm6",
            namespace="/editor",
        )
        print(f"[change_ledger] jump to {rel_path}:{line}", file=sys.stderr)
    else:
        # Different file — update SSOT, then open with line target
        _history_store.update_session_state({"currentPath": abs_path})
        _history_store.set_last_file(project, abs_path)

        payload = _read_file_payload(project, abs_path)
        payload["line"] = line
        payload["reason"] = "tracked_edit"
        payload["request_id"] = f"track_{int(time.time() * 1000)}"
        await EDITOR_SIO.emit("editor:open", payload, room="file_editor_cm6", namespace="/editor")

        # Notify explorer so breadcrumb/toolbar filename updates
        await _broadcast_active_file_update(project, abs_path)

        print(f"[change_ledger] open+jump {rel_path}:{line}", file=sys.stderr)


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
        role = _role_from_environ(environ)
        connect_request_id = f"diag_{int(time.time() * 1000)}_{str(sid)[-6:]}"

        # Single source of truth: history_store.get_last_file() is authoritative.
        # session_state["currentPath"] is a mirror written by on_editor_open_request.
        current_path = None
        if project:
            current_path = _history_store.get_last_file(project)
        if not current_path:
            current_path = session_state.get("currentPath")
        # Sync session_state so both stores agree.
        if current_path and session_state.get("currentPath") != current_path:
            _history_store.update_session_state({"currentPath": current_path})

        snapshot: Dict[str, Any] = {
            "project": project,
            "session_state": session_state,
            "preferences": prefs,
            "currentPath": current_path,
        }

        # Avoid sending large file content to the host shell on initial connect.
        # The host only needs the path to show the filename; the iframe loads content.
        if role != "host" and project and current_path:
            abs_path = _normalize_abs_path(str(current_path))
            if abs_path and _is_under_project(project, abs_path):
                snapshot["file"] = _read_file_payload(project, abs_path)
                snapshot["file"]["request_id"] = connect_request_id

        await self.emit("editor:ssot", snapshot, room=sid)

        # Broadcast explorer:activeFile so explorer highlights the open file.
        if current_path and project:
            await _broadcast_active_file_update(str(project), str(current_path))

        # Diagnostics bridge: ensure the background adapter→editor bridge is running.
        try:
            from ..diagnostics_bridge import (
                start_bridge,
            )
            from .editor_socketio import EDITOR_SIO

            # Ensure the bridge background task is running.
            start_bridge(EDITOR_SIO)
        except Exception:
            pass

    async def on_disconnect(self, sid, reason=None):
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

        project = _active_project()
        if project:
            try:
                path = _normalize_abs_path(payload.get("path") or "")
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

    async def on_editor_open_complete(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            return
        payload = dict(payload)
        payload["source_client"] = sid
        await self.emit("editor:open_complete", payload, room="file_editor_cm6")

    async def on_editor_issues_cmd(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            return
        payload = dict(payload)
        payload["source_client"] = sid
        await self.emit("editor:issues_cmd", payload, room="file_editor_cm6")

    async def on_editor_find_cmd(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            return
        payload = dict(payload)
        payload["source_client"] = sid
        await self.emit("editor:find_cmd", payload, room="file_editor_cm6")

    async def on_editor_ready(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            payload = {}
        payload = dict(payload)
        payload["source_client"] = sid
        await self.emit("editor:ready", payload, room="file_editor_cm6")

        # Eagerly launch code-server + workbench adapter when the editor iframe connects.
        # State is broadcast to all UI IPC clients via _broadcast_adapter_state().
        project = _active_project()
        if project:
            try:
                from ..code_server_shell_manager import ensure_code_server_shell
                cs = await ensure_code_server_shell(project)
                cs_env = (cs.env_overrides or {})
                port_s = cs_env.get("TE_CODE_SERVER_PORT") or ""
                try:
                    cs_port = int(str(port_s))
                except Exception:
                    cs_port = 0
                cs_http = f"http://127.0.0.1:{cs_port}" if cs_port else "http://127.0.0.1:18180"
                from ..workbench_adapter_shell_manager import ensure_workbench_adapter_shell
                await ensure_workbench_adapter_shell(project, code_server_http=cs_http)
            except Exception as exc:
                print(f"[editor_ready] eager adapter launch failed: {exc}")

    async def on_editor_diagnostics_counts(self, sid, data):
        payload = data if isinstance(data, dict) else {}
        payload = dict(payload)
        payload["source_client"] = sid
        await self.emit("editor:diagnostics_counts", payload, room="file_editor_cm6")

    async def on_editor_diagnostics_consumer_pending(self, sid, data):
        """Client (Monaco iframe) announces it is about to open/switch a file but is not ready yet.

        This is used to gate workbench diagnostics forwarding to avoid a race where diagnostics
        arrive before the Monaco model/marker plumbing is ready.
        """
        payload = data if isinstance(data, dict) else {}
        path = _normalize_abs_path(str(payload.get("path") or "")) or ""
        request_id = str(payload.get("request_id") or payload.get("requestId") or "")
        if not path:
            return
        try:
            from ..diagnostics_bridge import set_consumer_pending

            set_consumer_pending(path, request_id)
        except Exception:
            pass

    async def on_editor_diagnostics_consumer_ready(self, sid, data):
        """Client (Monaco iframe) announces it is ready to consume diagnostics for a file."""
        payload = data if isinstance(data, dict) else {}
        path = _normalize_abs_path(str(payload.get("path") or "")) or ""
        request_id = str(payload.get("request_id") or payload.get("requestId") or "")
        if not path:
            return
        try:
            from ..diagnostics_bridge import set_consumer_ready
            from .editor_socketio import EDITOR_SIO

            await set_consumer_ready(EDITOR_SIO, path, request_id)
        except Exception:
            pass

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

    async def on_editor_save_snapshot_response(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            return
        request_id = payload.get("requestId") or payload.get("request_id")
        if not isinstance(request_id, str) or not request_id:
            return
        waiter = _SAVE_SNAPSHOT_WAITING.pop(request_id, None)
        if waiter is None or waiter.done():
            return
        waiter.set_result(payload)

    async def on_editor_open_request(self, sid, data):
        print(f"[editor_ws] on_editor_open_request: sid={sid} data={data}", flush=True)
        payload_in = data or {}
        if not isinstance(payload_in, dict):
            payload_in = {}

        request_id = payload_in.get("request_id")
        if not isinstance(request_id, str) or not request_id:
            request_id = f"diag_{int(time.time() * 1000)}_{str(sid)[-6:]}"
        try:
            await emit_editor_open_from_backend(
                payload_in,
                source_client=str(sid),
                request_id=request_id,
            )
        except ValueError as exc:
            await self.emit("editor:error", {"error": str(exc)}, room=sid)
            return

        # Diagnostics bridge: send cached diagnostics for the new file.
        # NOTE: do not replay cached diagnostics on open. Diagnostics should be driven
        # by live workbench adapter events for the active document.

    async def on_editor_jump_to_line_request(self, sid, data):
        payload_in = data or {}
        if not isinstance(payload_in, dict):
            payload_in = {}

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
            await self.emit("editor:error", {"error": "missing_line"}, room=sid)
            return
        if line < 1:
            line = 1
        if not isinstance(column, int) or column < 1:
            column = 1
        if scroll_y is not None and not isinstance(scroll_y, str):
            scroll_y = None
        if focus is not None and not isinstance(focus, bool):
            focus = None
        if scroll_to_top is not None and not isinstance(scroll_to_top, bool):
            scroll_to_top = None

        # Broadcast to all connected clients (single-doc model).
        await self.emit(
            "editor:jump_to_line",
            {
                "line": line,
                "column": column,
                "scroll_y": scroll_y,
                "focus": focus,
                "scroll_to_top": scroll_to_top,
                "source_client": sid,
            },
            room="file_editor_cm6",
        )

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

        is_unsaved = bool(entry.get("unsaved"))

        await self.emit(
            "editor:mirror",
            {
                "path": path,
                "content": content,
                "base_sha256": base_sha256,
                "content_sha256": entry.get("content_sha256"),
                "unsaved": is_unsaved,
                "source_client": sid,
            },
            room="file_editor_cm6",
        )

        # Notify toolbar badge and explorer decorations of draft state change.
        await self.emit(
            "editor:cache_state",
            {
                "path": path,
                "state": "mid_session" if is_unsaved else "clean",
                "unsaved": is_unsaved,
                "reason": "mirror",
                "content_sha256": entry.get("content_sha256"),
                "source_client": sid,
            },
            room="file_editor_cm6",
        )
        try:
            from ..explorer_ws import notify_draft_state_changed
            notify_draft_state_changed(project)
        except Exception:
            pass

    async def on_editor_save_request(self, sid, data):
        payload = data or {}
        if not isinstance(payload, dict):
            payload = {}

        project = _active_project()
        if not project:
            return {"ok": False, "error": "no_active_project"}

        request_id = payload.get("request_id") or payload.get("requestId") or f"save_{int(time.time() * 1000)}_{str(sid)[-6:]}"
        if not isinstance(request_id, str) or not request_id:
            request_id = f"save_{int(time.time() * 1000)}_{str(sid)[-6:]}"

        try:
            snapshot = await _request_editor_save_snapshot(self, request_id)
        except asyncio.TimeoutError:
            return {"ok": False, "error": "save_snapshot_timeout"}
        except Exception as exc:
            return {"ok": False, "error": f"save_snapshot_failed: {exc}"}

        snapshot_error = snapshot.get("error")
        if isinstance(snapshot_error, str) and snapshot_error:
            return {"ok": False, "error": snapshot_error}

        raw_path = payload.get("target_path") or snapshot.get("path") or payload.get("path")
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

        content = snapshot.get("content", "")
        if not isinstance(content, str):
            return {"ok": False, "error": "invalid_content"}

        base_sha256 = payload.get("base_sha256")
        if not isinstance(base_sha256, str) or len(base_sha256) != 64:
            base_sha256 = snapshot.get("base_sha256")
        if not isinstance(base_sha256, str) or len(base_sha256) != 64:
            base_sha256 = None

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
        file_meta = {**file_meta, "path": abs_path}

        # Stamp save SHA to suppress watcher reload for our own write
        save_sha = file_meta.get("sha256")
        if save_sha:
            _LAST_SAVE_SHA[abs_path] = save_sha

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
        # comment
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

    async def on_editor_workbench_open_file(self, sid, data):
        """Open a file via the workbench adapter (stdio pipe). Triggers adapter bootstrap."""
        payload = data if isinstance(data, dict) else {}
        abs_path = payload.get("path", "")
        request_id = payload.get("request_id", f"wb_{int(time.time() * 1000)}")
        generation = _coerce_generation(payload.get("generation"))

        project = _active_project()
        if not project or not abs_path:
            await self.emit(
                "editor:workbench_open_file_response",
                {"request_id": request_id, "error": "missing_path_or_project"},
                room=sid,
            )
            return

        if not _is_under_project(project, abs_path):
            await self.emit(
                "editor:workbench_open_file_response",
                {"request_id": request_id, "error": "outside_project"},
                room=sid,
            )
            return

        lock = _workbench_get_lock(abs_path)
        async with lock:
            try:
                from ..workbench_adapter_shell_manager import adapter_rpc

                resp = await adapter_rpc(
                    "vscode.openFile",
                    {
                        "path": abs_path,
                        "languageId": payload.get("languageId", ""),
                        "requestId": request_id,
                        "forceRefresh": payload.get("forceRefresh", False),
                        "generation": generation,
                        "workspaceFolder": project,
                    },
                )
                _mark_open_baseline(abs_path, generation)
                result = resp.get("result", resp)
                await self.emit(
                    "editor:workbench_open_file_response",
                    {"request_id": request_id, "result": result},
                    room=sid,
                )
            except Exception as exc:
                _wb_log.error("[workbench] open_file failed: %s", exc)
                await self.emit(
                    "editor:workbench_open_file_response",
                    {"request_id": request_id, "error": str(exc)},
                    room=sid,
                )

    async def on_editor_workbench_hover(self, sid, data):
        """Hover request via workbench adapter (stdio pipe)."""
        payload = data if isinstance(data, dict) else {}
        request_id = payload.get("request_id", f"hv_{int(time.time() * 1000)}")
        abs_path = payload.get("path", "")
        print(f"[editor_ws] hover request_id={request_id} path={abs_path} line={payload.get('lineNumber')} col={payload.get('column')} lang={payload.get('languageId')}", flush=True)

        project = _active_project()
        if not project or not abs_path:
            await self.emit(
                "editor:workbench_hover_response",
                {"request_id": request_id, "error": "missing_path_or_project"},
                room=sid,
            )
            return

        try:
            from ..workbench_adapter_shell_manager import adapter_rpc

            resp = await adapter_rpc(
                "vscode.hover",
                {
                    "path": abs_path,
                    "lineNumber": payload.get("lineNumber", payload.get("line", 1)),
                    "column": payload.get("column", payload.get("character", 1)),
                    "languageId": payload.get("languageId", ""),
                },
            )
            result = resp.get("result", resp)
            await self.emit(
                "editor:workbench_hover_response",
                {"request_id": request_id, "result": result},
                room=sid,
            )
        except Exception as exc:
            _wb_log.error("[workbench] hover failed: %s", exc)
            await self.emit(
                "editor:workbench_hover_response",
                {"request_id": request_id, "error": str(exc)},
                room=sid,
            )

    async def on_editor_workbench_completions(self, sid, data):
        """Completions request via workbench adapter (stdio pipe)."""
        payload = data if isinstance(data, dict) else {}
        request_id = payload.get("request_id", f"cmp_{int(time.time() * 1000)}")
        abs_path = payload.get("path", "")
        print(f"[editor_ws] completions request_id={request_id} path={abs_path} line={payload.get('lineNumber')} col={payload.get('column')} lang={payload.get('languageId')}", flush=True)

        project = _active_project()
        if not project or not abs_path:
            await self.emit(
                "editor:workbench_completions_response",
                {"request_id": request_id, "error": "missing_path_or_project"},
                room=sid,
            )
            return

        try:
            from ..workbench_adapter_shell_manager import adapter_rpc

            resp = await adapter_rpc(
                "vscode.completions",
                {
                    "path": abs_path,
                    "lineNumber": payload.get("lineNumber", payload.get("line", 1)),
                    "column": payload.get("column", payload.get("character", 1)),
                    "languageId": payload.get("languageId", ""),
                    "triggerKind": payload.get("triggerKind", 0),
                    "triggerCharacter": payload.get("triggerCharacter"),
                    "text": payload.get("text"),
                },
            )
            result = resp.get("result", resp)
            await self.emit(
                "editor:workbench_completions_response",
                {"request_id": request_id, "result": result},
                room=sid,
            )
        except Exception as exc:
            _wb_log.error("[workbench] completions failed: %s", exc)
            await self.emit(
                "editor:workbench_completions_response",
                {"request_id": request_id, "error": str(exc)},
                room=sid,
            )

    async def on_editor_workbench_semantic_tokens(self, sid, data):
        """Semantic tokens request via workbench adapter (stdio pipe)."""
        payload = data if isinstance(data, dict) else {}
        request_id = payload.get("request_id", f"st_{int(time.time() * 1000)}")
        abs_path = payload.get("path", "")
        print(f"[editor_ws] semanticTokens request_id={request_id} path={abs_path} lang={payload.get('languageId')} prevResultId={payload.get('previousResultId')}", flush=True)

        project = _active_project()
        if not project or not abs_path:
            await self.emit(
                "editor:workbench_semantic_tokens_response",
                {"request_id": request_id, "error": "missing_path_or_project"},
                room=sid,
            )
            return

        try:
            from ..workbench_adapter_shell_manager import adapter_rpc

            resp = await adapter_rpc(
                "vscode.semanticTokens",
                {
                    "path": abs_path,
                    "languageId": payload.get("languageId", ""),
                    "previousResultId": payload.get("previousResultId", "0"),
                },
            )
            result = resp.get("result", resp)
            await self.emit(
                "editor:workbench_semantic_tokens_response",
                {"request_id": request_id, "result": result},
                room=sid,
            )
        except Exception as exc:
            _wb_log.error("[workbench] semanticTokens failed: %s", exc)
            await self.emit(
                "editor:workbench_semantic_tokens_response",
                {"request_id": request_id, "error": str(exc)},
                room=sid,
            )

    async def on_editor_workbench_semantic_tokens_legend(self, sid, data):
        """Get semantic tokens legend for a language."""
        payload = data if isinstance(data, dict) else {}
        request_id = payload.get("request_id", f"stl_{int(time.time() * 1000)}")
        lang_id = payload.get("languageId", "")

        try:
            from ..workbench_adapter_shell_manager import adapter_rpc

            resp = await adapter_rpc(
                "vscode.semanticTokensLegend",
                {"languageId": lang_id},
            )
            result = resp.get("result", resp)
            await self.emit(
                "editor:workbench_semantic_tokens_legend_response",
                {"request_id": request_id, "result": result},
                room=sid,
            )
        except Exception as exc:
            _wb_log.error("[workbench] semanticTokensLegend failed: %s", exc)
            await self.emit(
                "editor:workbench_semantic_tokens_legend_response",
                {"request_id": request_id, "error": str(exc)},
                room=sid,
            )

    async def on_editor_workbench_semantic_tokens_range(self, sid, data):
        """Semantic tokens range request via workbench adapter (stdio pipe)."""
        payload = data if isinstance(data, dict) else {}
        request_id = payload.get("request_id", f"str_{int(time.time() * 1000)}")
        abs_path = payload.get("path", "")
        range_obj = payload.get("range", None)
        print(f"[editor_ws] semanticTokensRange request_id={request_id} path={abs_path} lang={payload.get('languageId')} range={range_obj}", flush=True)

        project = _active_project()
        if not project or not abs_path or not range_obj:
            await self.emit(
                "editor:workbench_semantic_tokens_range_response",
                {"request_id": request_id, "error": "missing_path_or_project_or_range"},
                room=sid,
            )
            return

        try:
            from ..workbench_adapter_shell_manager import adapter_rpc

            resp = await adapter_rpc(
                "vscode.semanticTokensRange",
                {
                    "path": abs_path,
                    "languageId": payload.get("languageId", ""),
                    "range": range_obj,
                },
            )
            result = resp.get("result", resp)
            await self.emit(
                "editor:workbench_semantic_tokens_range_response",
                {"request_id": request_id, "result": result},
                room=sid,
            )
        except Exception as exc:
            _wb_log.error("[workbench] semanticTokensRange failed: %s", exc)
            await self.emit(
                "editor:workbench_semantic_tokens_range_response",
                {"request_id": request_id, "error": str(exc)},
                room=sid,
            )

    async def on_editor_workbench_symbols(self, sid, data):
        """Document symbols request via workbench adapter (stdio pipe)."""
        payload = data if isinstance(data, dict) else {}
        request_id = payload.get("request_id", f"sym_{int(time.time() * 1000)}")
        abs_path = payload.get("path", "")
        generation = _coerce_generation(payload.get("generation"))

        project = _active_project()
        if not project or not abs_path:
            await self.emit(
                "editor:workbench_symbols_response",
                {"request_id": request_id, "error": "missing_path_or_project"},
                room=sid,
            )
            return

        lang_id = payload.get("languageId", "")
        _wb_log.info("[symbols] request path=%s lang=%s", abs_path, lang_id)

        lock = _workbench_get_lock(abs_path)
        async with lock:
            if not _has_open_baseline(abs_path, generation):
                await self.emit(
                    "editor:workbench_symbols_response",
                    {"request_id": request_id, "error": "document_not_ready"},
                    room=sid,
                )
                return

            try:
                from ..workbench_adapter_shell_manager import adapter_rpc

                resp = await adapter_rpc(
                    "vscode.documentSymbols",
                    {
                        "path": abs_path,
                        "languageId": lang_id,
                        "generation": generation,
                    },
                )
                result = resp.get("result", resp)
                sym_count = len(result) if isinstance(result, list) else "non-list"
                _wb_log.info("[symbols] response path=%s lang=%s count=%s ok=%s", abs_path, lang_id, sym_count, resp.get("ok"))
                if not isinstance(result, list) or not result:
                    _wb_log.warning("[symbols] raw adapter resp keys=%s", list(resp.keys()) if isinstance(resp, dict) else type(resp))
                await self.emit(
                    "editor:workbench_symbols_response",
                    {"request_id": request_id, "result": result},
                    room=sid,
                )
            except Exception as exc:
                _wb_log.error("[symbols] FAILED path=%s lang=%s err=%s", abs_path, lang_id, exc)
                await self.emit(
                    "editor:workbench_symbols_response",
                    {"request_id": request_id, "error": str(exc)},
                    room=sid,
                )

    async def on_editor_workbench_folding_ranges(self, sid, data):
        """Folding ranges request via workbench adapter (stdio pipe)."""
        payload = data if isinstance(data, dict) else {}
        request_id = payload.get("request_id", f"fold_{int(time.time() * 1000)}")
        abs_path = payload.get("path", "")
        generation = _coerce_generation(payload.get("generation"))
        lang_id = payload.get("languageId", "")
        context_obj = payload.get("context", {})

        project = _active_project()
        if not project or not abs_path:
            await self.emit(
                "editor:workbench_folding_ranges_response",
                {"request_id": request_id, "error": "missing_path_or_project"},
                room=sid,
            )
            return

        lock = _workbench_get_lock(abs_path)
        async with lock:
            if not _has_open_baseline(abs_path, generation):
                await self.emit(
                    "editor:workbench_folding_ranges_response",
                    {"request_id": request_id, "error": "document_not_ready"},
                    room=sid,
                )
                return

            try:
                from ..workbench_adapter_shell_manager import adapter_rpc

                resp = await adapter_rpc(
                    "vscode.foldingRanges",
                    {
                        "path": abs_path,
                        "languageId": lang_id,
                        "generation": generation,
                        "context": context_obj,
                        "timeoutMs": payload.get("timeoutMs"),
                    },
                )
                result = resp.get("result", resp)
                range_count = "null"
                if isinstance(result, dict):
                    inner = result.get("result")
                    if isinstance(inner, list):
                        range_count = len(inner)
                _wb_log.info("[folding] response path=%s lang=%s count=%s ok=%s", abs_path, lang_id, range_count, resp.get("ok"))
                await self.emit(
                    "editor:workbench_folding_ranges_response",
                    {"request_id": request_id, "result": result},
                    room=sid,
                )
            except Exception as exc:
                _wb_log.error("[folding] FAILED path=%s lang=%s err=%s", abs_path, lang_id, exc)
                await self.emit(
                    "editor:workbench_folding_ranges_response",
                    {"request_id": request_id, "error": str(exc)},
                    room=sid,
                )

    async def on_editor_breadcrumb_navigate(self, sid, data):
        """Breadcrumb directory click → relay to explorer socket + open drawer."""
        payload = data if isinstance(data, dict) else {}
        abs_path = payload.get("path", "")
        open_drawer = payload.get("open_drawer", False)
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

        # Relay to explorer socket (cross-transport, same worker process)
        try:
            from ..explorer_rpc_emit import emit_explorer_rpc_notification
            _wb_log.info("[bc-navigate] rel=%s abs=%s external=%s drawer=%s", rel, abs_path, is_external, open_drawer)
            await emit_explorer_rpc_notification(
                "explorer.navigate",
                {"rel": rel, "abs_path": abs_path, "is_external": is_external, "open_drawer": open_drawer},
            )
            _wb_log.info("[bc-navigate] emit OK")
        except Exception as exc:
            _wb_log.error("[bc-navigate] emit FAILED: %s", exc)

    async def on_editor_workbench_did_change(self, sid, data):
        """Push buffer content to extension host for live diagnostics (fire-and-forget)."""
        payload = data if isinstance(data, dict) else {}
        abs_path = payload.get("path", "")
        text = payload.get("text", "")
        language_id = payload.get("languageId", "")
        generation = _coerce_generation(payload.get("generation"))

        project = _active_project()
        if not project or not abs_path:
            return

        lock = _workbench_get_lock(abs_path)
        async with lock:
            if not _has_open_baseline(abs_path, generation):
                _wb_log.warning("[workbench] didChange dropped (no open baseline) path=%s gen=%s", abs_path, generation)
                return
            try:
                from ..workbench_adapter_shell_manager import adapter_rpc

                await adapter_rpc(
                    "vscode.didChange",
                    {
                        "path": abs_path,
                        "text": text,
                        "languageId": language_id,
                        "generation": generation,
                    },
                )
            except Exception as exc:
                _wb_log.error("[workbench] didChange failed: %s", exc)

    async def on_editor_workbench_grammars_list(self, sid, data):
        """List TextMate grammars from installed extensions via adapter."""
        payload = data if isinstance(data, dict) else {}
        request_id = payload.get("request_id", f"gl_{int(time.time() * 1000)}")
        try:
            from ..workbench_adapter_shell_manager import adapter_rpc

            resp = await adapter_rpc("vscode.textmate.grammars.list", {})
            await self.emit(
                "editor:workbench_grammars_list_response",
                {"request_id": request_id, "result": resp.get("result", resp)},
                room=sid,
            )
        except Exception as exc:
            _wb_log.error("[grammars.list] FAILED: %s", exc)
            await self.emit(
                "editor:workbench_grammars_list_response",
                {"request_id": request_id, "error": str(exc)},
                room=sid,
            )

    async def on_editor_workbench_grammars_load(self, sid, data):
        """Load a TextMate grammar by ID from an installed extension via adapter."""
        payload = data if isinstance(data, dict) else {}
        request_id = payload.get("request_id", f"gld_{int(time.time() * 1000)}")
        grammar_id = payload.get("id", "")
        if not grammar_id:
            await self.emit(
                "editor:workbench_grammars_load_response",
                {"request_id": request_id, "error": "missing_grammar_id"},
                room=sid,
            )
            return
        try:
            from ..workbench_adapter_shell_manager import adapter_rpc

            resp = await adapter_rpc("vscode.textmate.grammars.load", {"id": grammar_id})
            await self.emit(
                "editor:workbench_grammars_load_response",
                {"request_id": request_id, "result": resp.get("result", resp)},
                room=sid,
            )
        except Exception as exc:
            _wb_log.error("[grammars.load] FAILED id=%s: %s", grammar_id, exc)
            await self.emit(
                "editor:workbench_grammars_load_response",
                {"request_id": request_id, "error": str(exc)},
                room=sid,
            )

    # NOTE: on_editor_readiness_check removed — adapter state is now pushed
    # via UI IPC from workbench_adapter_shell_manager._broadcast_adapter_state().
