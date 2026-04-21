import hashlib
import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

import socketio
from urllib.parse import parse_qs

from ..draft_diff_helper import compute_draft_diff
from ..git_helper import _run_git_optional, is_git_repository
from ..stores import _history_store, _preferences_store
from .editor_open_backend import (
    EditorOpenPayload,
    coerce_editor_open_request_fields,
    emit_editor_open_from_backend as _emit_editor_open_from_backend_impl,
)
from .editor_backend_services.contracts import RuntimeMeta
from .editor_save_backend import (
    handle_editor_mirror,
    handle_editor_save_request,
    request_editor_save_snapshot,
    resolve_editor_save_snapshot_response,
)
from .editor_workbench_backend import (
    handle_workbench_completions,
    handle_workbench_did_change,
    handle_workbench_folding_ranges,
    handle_workbench_grammars_list,
    handle_workbench_grammars_load,
    handle_workbench_hover,
    handle_workbench_open_file,
    handle_workbench_semantic_tokens,
    handle_workbench_semantic_tokens_legend,
    handle_workbench_semantic_tokens_range,
    handle_workbench_symbols,
)

import logging as _logging
_wb_log = _logging.getLogger("editor_ws.workbench")

_ISSUES_DUMP_WAITING: dict[str, str] = {}
_ISSUES_DUMP_TTL_S = 20.0
_SAVE_SNAPSHOT_WAITING: dict[str, asyncio.Future[dict[str, object]]] = {}
_WORKBENCH_PATH_LOCKS: dict[str, asyncio.Lock] = {}
_WORKBENCH_OPEN_BASELINE: dict[str, dict[str, int | None]] = {}

# Tracks SHA256 of the most recent editor-initiated save per abs path.
# Used to suppress watcher reload for our own saves.
_LAST_SAVE_SHA: dict[str, str] = {}


def _workbench_get_lock(abs_path: str) -> asyncio.Lock:
    lock = _WORKBENCH_PATH_LOCKS.get(abs_path)
    if lock is None:
        lock = asyncio.Lock()
        _WORKBENCH_PATH_LOCKS[abs_path] = lock
    return lock


def _coerce_generation(raw: object) -> Optional[int]:
    try:
        if raw is None or raw == "":
            return None
        if isinstance(raw, int):
            return raw
        if isinstance(raw, str) and raw.isdigit():
            return int(raw)
        return None
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


def _runtime_meta() -> RuntimeMeta:
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


def _role_from_environ(environ: dict[str, object]) -> str:
    """Best-effort role extraction from Socket.IO connect environ."""
    try:
        qs_obj = environ.get("QUERY_STRING")
        qs = qs_obj if isinstance(qs_obj, str) else ""
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
        payload: dict[str, object] = {
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


def _notify_draft_state_changed_safe(project: str) -> None:
    try:
        from ..explorer.services.runtime_notifications import notify_draft_state_changed

        notify_draft_state_changed(project)
    except Exception:
        pass


async def _emit_editor_open_to_default_room(payload: EditorOpenPayload) -> None:
    from .editor_socketio import EDITOR_SIO

    await EDITOR_SIO.emit("editor:open", payload, room="file_editor_cm6", namespace="/editor")


async def emit_editor_open_from_backend(
    payload_in: dict[str, object] | None,
    *,
    source_client: str,
    request_id: str,
    active_project=None,
    normalize_abs_path=None,
    is_under_project=None,
    read_file_payload=None,
    update_session_state=None,
    set_last_file=None,
    emit_editor_open=None,
    broadcast_active_file_update=None,
    emit_host_active_file_changed=None,
) -> EditorOpenPayload:
    return await _emit_editor_open_from_backend_impl(
        payload_in,
        source_client=source_client,
        request_id=request_id,
        active_project=active_project or _active_project,
        normalize_abs_path=normalize_abs_path or _normalize_abs_path,
        is_under_project=is_under_project or _is_under_project,
        read_file_payload=read_file_payload or _read_file_payload,
        update_session_state=update_session_state or _history_store.update_session_state,
        set_last_file=set_last_file or _history_store.set_last_file,
        emit_editor_open=emit_editor_open or _emit_editor_open_to_default_room,
        broadcast_active_file_update=broadcast_active_file_update or _broadcast_active_file_update,
        emit_host_active_file_changed=emit_host_active_file_changed or _emit_host_active_file_changed,
    )


def _read_file_payload(project: str, abs_path: str) -> EditorOpenPayload:
    """Return SSOT-derived snapshot for a file (draft cache wins)."""

    payload: EditorOpenPayload = {"path": abs_path}
    prefs = _preferences_store.get_preferences(project)
    payload["preferences"] = prefs

    # Autosave mode is SSOT (PreferencesStore)
    auto_save = None
    try:
        editor_prefs_obj = prefs.get("editor")
        if isinstance(editor_prefs_obj, dict):
            auto_save_raw = editor_prefs_obj.get("autoSave")
            auto_save = auto_save_raw if isinstance(auto_save_raw, bool) else None
        else:
            auto_save = None
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
        cached_content = cached.get("content", "")
        cached_base_sha = cached.get("base_sha256")
        cached_content_sha = cached.get("content_sha256")
        payload["has_draft"] = True
        payload["content"] = cached_content if isinstance(cached_content, str) else ""
        if isinstance(cached_base_sha, str):
            payload["base_sha256"] = cached_base_sha
        if isinstance(cached_content_sha, str):
            payload["content_sha256"] = cached_content_sha
        payload["state"] = "mid_session"
        payload["unsaved"] = True
        payload["reason"] = "restore"
        return payload

    try:
        content_bytes = Path(abs_path).read_bytes()
        content = content_bytes.decode("utf-8", errors="replace")
    except Exception:
        content = ""
    sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
    payload["has_draft"] = False
    payload["content"] = content
    payload["base_sha256"] = sha256
    payload["content_sha256"] = sha256
    payload["state"] = "clean"
    payload["unsaved"] = False
    payload["reason"] = "disk"
    return payload


def _read_disk_text(abs_path: str) -> str:
    try:
        content_bytes = Path(abs_path).read_bytes()
        return content_bytes.decode("utf-8", errors="replace")
    except Exception:
        return ""


async def _request_editor_save_snapshot(
    ns: socketio.AsyncNamespace,
    request_id: str,
    *,
    timeout_s: float = 3.0,
) -> dict[str, object]:
    return await request_editor_save_snapshot(
        ns,
        request_id,
        waiting=_SAVE_SNAPSHOT_WAITING,
        timeout_s=timeout_s,
    )


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

        payload: dict[str, object] = {
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


async def handle_tracked_edit(edit_result: dict[str, object]) -> None:
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

    abs_path_obj = edit_result.get("path", "")
    if not isinstance(abs_path_obj, str) or not abs_path_obj:
        return
    abs_path = abs_path_obj
    rel_path_obj = edit_result.get("rel_path", "")
    rel_path = rel_path_obj if isinstance(rel_path_obj, str) else ""
    line_obj = edit_result.get("line", 1)
    if isinstance(line_obj, int):
        line = line_obj if line_obj > 0 else 1
    elif isinstance(line_obj, str) and line_obj.isdigit():
        line = max(1, int(line_obj))
    else:
        line = 1

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

        snapshot: dict[str, object] = {
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
        resolve_editor_save_snapshot_response(_SAVE_SNAPSHOT_WAITING, data)

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
                active_project=_active_project,
                normalize_abs_path=_normalize_abs_path,
                is_under_project=_is_under_project,
                read_file_payload=_read_file_payload,
                update_session_state=_history_store.update_session_state,
                set_last_file=_history_store.set_last_file,
                emit_editor_open=lambda payload: self.emit("editor:open", payload, room="file_editor_cm6"),
                broadcast_active_file_update=_broadcast_active_file_update,
                emit_host_active_file_changed=_emit_host_active_file_changed,
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

        payload: dict[str, object] = {
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

            draft_content_obj = cached.get("content", "")
            draft_content = draft_content_obj if isinstance(draft_content_obj, str) else ""
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
        await handle_editor_mirror(
            sid,
            data,
            active_project=_active_project,
            normalize_abs_path=_normalize_abs_path,
            is_under_project=_is_under_project,
            runtime_meta=_runtime_meta,
            emit_to_room=lambda event_name, payload: self.emit(event_name, payload, room="file_editor_cm6"),
            notify_draft_state_changed=_notify_draft_state_changed_safe,
        )

    async def on_editor_save_request(self, sid, data):
        return await handle_editor_save_request(
            sid,
            data,
            active_project=_active_project,
            normalize_abs_path=_normalize_abs_path,
            is_under_project=_is_under_project,
            request_snapshot=lambda request_id: _request_editor_save_snapshot(self, request_id),
            emit_to_room=lambda event_name, payload: self.emit(event_name, payload, room="file_editor_cm6"),
            notify_draft_state_changed=_notify_draft_state_changed_safe,
            record_save_sha=lambda abs_path, sha256: _LAST_SAVE_SHA.__setitem__(abs_path, sha256),
        )

    async def on_editor_workbench_open_file(self, sid, data):
        await handle_workbench_open_file(
            data,
            emit_to_sid=lambda event_name, payload: self.emit(event_name, payload, room=sid),
            active_project=_active_project,
            is_under_project=_is_under_project,
            get_lock=_workbench_get_lock,
            coerce_generation=_coerce_generation,
            mark_open_baseline=_mark_open_baseline,
            logger=_wb_log,
        )

    async def on_editor_workbench_hover(self, sid, data):
        await handle_workbench_hover(
            data,
            emit_to_sid=lambda event_name, payload: self.emit(event_name, payload, room=sid),
            active_project=_active_project,
            logger=_wb_log,
        )

    async def on_editor_workbench_completions(self, sid, data):
        await handle_workbench_completions(
            data,
            emit_to_sid=lambda event_name, payload: self.emit(event_name, payload, room=sid),
            active_project=_active_project,
            logger=_wb_log,
        )

    async def on_editor_workbench_semantic_tokens(self, sid, data):
        await handle_workbench_semantic_tokens(
            data,
            emit_to_sid=lambda event_name, payload: self.emit(event_name, payload, room=sid),
            active_project=_active_project,
            logger=_wb_log,
        )

    async def on_editor_workbench_semantic_tokens_legend(self, sid, data):
        await handle_workbench_semantic_tokens_legend(
            data,
            emit_to_sid=lambda event_name, payload: self.emit(event_name, payload, room=sid),
            logger=_wb_log,
        )

    async def on_editor_workbench_semantic_tokens_range(self, sid, data):
        await handle_workbench_semantic_tokens_range(
            data,
            emit_to_sid=lambda event_name, payload: self.emit(event_name, payload, room=sid),
            active_project=_active_project,
            logger=_wb_log,
        )

    async def on_editor_workbench_symbols(self, sid, data):
        await handle_workbench_symbols(
            data,
            emit_to_sid=lambda event_name, payload: self.emit(event_name, payload, room=sid),
            active_project=_active_project,
            get_lock=_workbench_get_lock,
            coerce_generation=_coerce_generation,
            has_open_baseline=_has_open_baseline,
            logger=_wb_log,
        )

    async def on_editor_workbench_folding_ranges(self, sid, data):
        await handle_workbench_folding_ranges(
            data,
            emit_to_sid=lambda event_name, payload: self.emit(event_name, payload, room=sid),
            active_project=_active_project,
            get_lock=_workbench_get_lock,
            coerce_generation=_coerce_generation,
            has_open_baseline=_has_open_baseline,
            logger=_wb_log,
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
        await handle_workbench_did_change(
            data,
            active_project=_active_project,
            get_lock=_workbench_get_lock,
            coerce_generation=_coerce_generation,
            has_open_baseline=_has_open_baseline,
            logger=_wb_log,
        )

    async def on_editor_workbench_grammars_list(self, sid, data):
        await handle_workbench_grammars_list(
            data,
            emit_to_sid=lambda event_name, payload: self.emit(event_name, payload, room=sid),
            logger=_wb_log,
        )

    async def on_editor_workbench_grammars_load(self, sid, data):
        await handle_workbench_grammars_load(
            data,
            emit_to_sid=lambda event_name, payload: self.emit(event_name, payload, room=sid),
            logger=_wb_log,
        )

    # NOTE: on_editor_readiness_check removed — adapter state is now pushed
    # via UI IPC from workbench_adapter_shell_manager._broadcast_adapter_state().
