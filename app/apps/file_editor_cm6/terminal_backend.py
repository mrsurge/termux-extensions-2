# app/apps/file_editor_cm6/terminal_backend.py

"""
Terminal drawer backend for the code editor.
Provides REST endpoints and WebSocket PTY streaming for embedded terminal.
"""

import asyncio
from collections import deque
import json
import shlex
import re
import shutil
import time
from pathlib import Path
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, WebSocket, Body, Query, Depends
import socketio

from framework_shells import FrameworkShellManager, get_manager


async def get_manager_dep() -> FrameworkShellManager:
    return await get_manager()

from app.apps.file_editor_cm6 import edit_tracker
from app.apps.file_editor_cm6.stores import _history_store as _shared_history_store
from app.apps.file_editor_cm6.project_sidecar import ProjectSidecar
from app.apps.file_editor_cm6.terminal_shell import (
    create_editor_shell,
    destroy_editor_shell,
    resize_editor_shell,
)

terminal_router = APIRouter()

# Track active terminal websocket clients so the backend can force a reconnect on project switch.
_active_terminal_sockets: Dict[WebSocket, Optional[str]] = {}
_active_terminal_lock = asyncio.Lock()
_shell_create_locks: Dict[str, asyncio.Lock] = {}
_TERMINAL_SIO: socketio.AsyncServer | None = None
_active_terminal_sids: Dict[str, Optional[str]] = {}
_terminal_sid_shells: Dict[str, str] = {}
_terminal_sid_clients: Dict[str, str] = {}
_terminal_sid_lock = asyncio.Lock()
_terminal_stream_tasks: Dict[str, asyncio.Task[Any]] = {}
_terminal_stream_refcounts: Dict[str, int] = {}
_terminal_stream_lock = asyncio.Lock()


def _read_terminal_log_tail_text(path: Path, lines: int) -> str:
    if lines <= 0 or not path.exists():
        return ""
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        tail_lines = deque(fh, maxlen=lines)
    return "".join(tail_lines)


async def _read_terminal_log_tail_text_async(path: Path, lines: int) -> str:
    return await asyncio.to_thread(_read_terminal_log_tail_text, path, lines)


def attach_terminal_socketio_server(server: socketio.AsyncServer) -> None:
    global _TERMINAL_SIO
    _TERMINAL_SIO = server


def _terminal_shell_room(shell_id: str) -> str:
    return f"terminal:shell:{str(shell_id or '').strip() or 'unknown'}"


def _terminal_client_room(client_id: str) -> str:
    return f"terminal:client:{str(client_id or '').strip() or 'unknown'}"


async def _emit_terminal_to_sid(event: str, payload: dict, sid: str) -> None:
    if not _TERMINAL_SIO or not sid:
        return
    await _TERMINAL_SIO.emit(event, payload, namespace="/terminal", to=sid)


async def _emit_terminal_to_shell(event: str, payload: dict, shell_id: str) -> None:
    if not _TERMINAL_SIO or not shell_id:
        return
    await _TERMINAL_SIO.emit(
        event,
        payload,
        namespace="/terminal",
        room=_terminal_shell_room(shell_id),
    )


def _shell_lock_key(project_path: Optional[str], fallback: str) -> str:
    """Compute a stable key for coordinating shell creation.

    We want to ensure that concurrent code-paths (WS auto-connect and REST actions
    like 'run active file') don't create two shells in a race.
    """

    key = (project_path or "").strip()
    if key:
        return f"project:{key}"
    return f"fallback:{fallback}"


def _get_shell_create_lock(key: str) -> asyncio.Lock:
    lock = _shell_create_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _shell_create_locks[key] = lock
    return lock


async def _resolve_terminal_shell_id(
    requested_shell_id: str,
    *,
    mgr: FrameworkShellManager,
    history_store,
) -> tuple[str, Optional[str]]:
    shell_id = str(requested_shell_id or "").strip() or "auto"
    shell_project_path = history_store.get_active_project()
    if shell_id != "auto":
        rec = await mgr.get_shell(shell_id)
        if not rec or rec.status != "running" or not rec.pid:
            raise RuntimeError("Shell is not running")
        return shell_id, shell_project_path

    saved_shell_id = history_store.get_terminal_shell_id(shell_project_path)
    if saved_shell_id:
        rec = await mgr.get_shell(saved_shell_id)
        if rec and rec.status == "running" and rec.pid:
            return saved_shell_id, shell_project_path
        history_store.set_terminal_shell_id(None, shell_project_path)

    project_path = shell_project_path
    cwd = project_path if project_path and Path(project_path).is_dir() else str(Path.home())
    shell_id = await _ensure_terminal_shell(
        project_path=project_path,
        preferred_cwd=cwd,
        mgr=mgr,
        history_store=history_store,
    )
    return shell_id, shell_project_path


async def _terminal_projects_for_shell(shell_id: str) -> set[str]:
    async with _terminal_sid_lock:
        items = list(_active_terminal_sids.items())
        sid_shells = dict(_terminal_sid_shells)
    projects: set[str] = set()
    for sid, project_path in items:
        if sid_shells.get(sid) != shell_id:
            continue
        if project_path:
            projects.add(project_path)
    return projects


async def _forward_terminal_stream(shell_id: str, output_queue) -> None:
    mgr = await get_manager()
    exit_notified = False
    last_status_check = 0.0
    try:
        while True:
            try:
                chunk = await asyncio.wait_for(output_queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                if exit_notified:
                    continue
                now = asyncio.get_running_loop().time()
                if now - last_status_check < 2.0:
                    continue
                last_status_check = now

                try:
                    rec = await mgr.get_shell(shell_id)
                except Exception:
                    rec = None

                live = bool(rec and rec.status == "running" and rec.pid)
                if live:
                    continue

                status_tag = _terminal_status_tag(
                    rec.status if rec else "missing",
                    rec.pid if rec else None,
                )
                exit_code = rec.exit_code if rec else None
                marker = f"\r\n\r\n[{status_tag}]\r\n"
                if exit_code is not None and status_tag in ("exited", "live"):
                    marker = f"\r\n\r\n[{status_tag}: {exit_code}]\r\n"

                exit_notified = True
                await _emit_terminal_to_shell(
                    "terminal:output",
                    {"shell_id": shell_id, "data": marker},
                    shell_id,
                )
                await _emit_terminal_to_shell(
                    "terminal:closed",
                    {
                        "shell_id": shell_id,
                        "status": status_tag,
                        "exit_code": exit_code,
                        "marker": marker,
                        "ts": int(time.time() * 1000),
                    },
                    shell_id,
                )
                for project_path in await _terminal_projects_for_shell(shell_id):
                    try:
                        await _broadcast_terminal_shell_list(project_path)
                    except Exception:
                        pass
                return

            await _emit_terminal_to_shell(
                "terminal:output",
                {"shell_id": shell_id, "data": chunk},
                shell_id,
            )
    finally:
        try:
            await mgr.unsubscribe_output(shell_id, output_queue)
        except Exception:
            pass
        async with _terminal_stream_lock:
            _terminal_stream_tasks.pop(shell_id, None)
            _terminal_stream_refcounts.pop(shell_id, None)


async def _ensure_terminal_stream(shell_id: str) -> None:
    mgr = await get_manager()
    start_task = False
    output_queue = None
    async with _terminal_stream_lock:
        refs = _terminal_stream_refcounts.get(shell_id, 0) + 1
        _terminal_stream_refcounts[shell_id] = refs
        if shell_id not in _terminal_stream_tasks:
            output_queue = await mgr.subscribe_output(shell_id)
            start_task = True
            _terminal_stream_tasks[shell_id] = asyncio.create_task(
                _forward_terminal_stream(shell_id, output_queue),
                name=f"terminal-stream-{shell_id}",
            )
    if not start_task:
        return


async def _release_terminal_stream(shell_id: Optional[str]) -> None:
    if not shell_id:
        return
    task: asyncio.Task[Any] | None = None
    async with _terminal_stream_lock:
        refs = _terminal_stream_refcounts.get(shell_id, 0)
        if refs <= 1:
            _terminal_stream_refcounts.pop(shell_id, None)
            task = _terminal_stream_tasks.pop(shell_id, None)
        else:
            _terminal_stream_refcounts[shell_id] = refs - 1
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


async def _detach_terminal_sid(ns: socketio.AsyncNamespace, sid: str) -> None:
    async with _terminal_sid_lock:
        old_shell_id = _terminal_sid_shells.pop(sid, None)
        _terminal_sid_clients.pop(sid, None)
        _active_terminal_sids.pop(sid, None)
    if old_shell_id:
        try:
            await ns.leave_room(sid, _terminal_shell_room(old_shell_id))
        except Exception:
            pass
        await _release_terminal_stream(old_shell_id)


async def _bind_terminal_sid(
    ns: socketio.AsyncNamespace,
    sid: str,
    shell_id: str,
    *,
    client_id: str | None = None,
    project_path: str | None = None,
) -> tuple[bool, str | None]:
    shell_id = str(shell_id or "").strip()
    if not shell_id:
        raise RuntimeError("Missing shell id")
    requested_client_id = str(client_id or "").strip() or sid
    requested_project_path = str(project_path or "").strip() or None

    async with _terminal_sid_lock:
        old_shell_id = _terminal_sid_shells.get(sid)
        old_client_id = _terminal_sid_clients.get(sid)
        old_project_path = _active_terminal_sids.get(sid)
    same_shell = bool(old_shell_id and old_shell_id == shell_id)
    if old_shell_id and old_shell_id != shell_id:
        try:
            await ns.leave_room(sid, _terminal_shell_room(old_shell_id))
        except Exception:
            pass
        await _release_terminal_stream(old_shell_id)

    active_client_id = old_client_id or requested_client_id
    active_project_path = requested_project_path if requested_project_path is not None else old_project_path

    await ns.enter_room(sid, _terminal_client_room(active_client_id))
    if not same_shell:
        await ns.enter_room(sid, _terminal_shell_room(shell_id))
        await _ensure_terminal_stream(shell_id)

    async with _terminal_sid_lock:
        _terminal_sid_clients[sid] = active_client_id
        _terminal_sid_shells[sid] = shell_id
        _active_terminal_sids[sid] = active_project_path

    return same_shell, active_project_path


async def _resolve_terminal_event_shell(
    ns: socketio.AsyncNamespace,
    sid: str,
    payload: dict[str, Any],
) -> tuple[str | None, str | None]:
    requested_shell_id = str(payload.get("shell_id") or payload.get("shellId") or "").strip()
    requested_client_id = str(payload.get("client_id") or "").strip() or None
    requested_project_path = str(payload.get("project_path") or "").strip() or None
    if requested_shell_id:
        mgr = await get_manager()
        rec = await mgr.get_shell(requested_shell_id)
        if not rec or rec.status != "running" or not rec.pid:
            raise RuntimeError("Shell is not running")
        _, active_project_path = await _bind_terminal_sid(
            ns,
            sid,
            requested_shell_id,
            client_id=requested_client_id,
            project_path=requested_project_path,
        )
        return requested_shell_id, active_project_path

    async with _terminal_sid_lock:
        return _terminal_sid_shells.get(sid), _active_terminal_sids.get(sid)


class TerminalSocketIONamespace(socketio.AsyncNamespace):
    async def trigger_event(self, event, *args):
        normalized = event.replace(":", "_") if event else event
        handler = getattr(self, "on_" + (normalized or ""), None)
        if handler:
            return await handler(*args)
        return await super().trigger_event(event, *args)

    async def on_connect(self, sid, environ):
        print(f"[terminal_ws] connect sid={sid}", flush=True)

    async def on_disconnect(self, sid, reason=None):
        print(f"[terminal_ws] disconnect sid={sid} reason={reason}", flush=True)
        await _detach_terminal_sid(self, sid)

    async def on_terminal_register(self, sid, data):
        payload = data if isinstance(data, dict) else {}
        client_id = str(payload.get("client_id") or sid).strip() or sid
        requested_shell_id = str(payload.get("shellId") or payload.get("shell_id") or "auto").strip() or "auto"
        history_store = get_history_store()
        mgr = await get_manager()
        try:
            shell_id, shell_project_path = await _resolve_terminal_shell_id(
                requested_shell_id,
                mgr=mgr,
                history_store=history_store,
            )
        except Exception as exc:
            await self.emit(
                "terminal:error",
                {"message": str(exc), "shell_id": requested_shell_id, "ts": int(time.time() * 1000)},
                to=sid,
            )
            return

        await _bind_terminal_sid(
            self,
            sid,
            shell_id,
            client_id=client_id,
            project_path=shell_project_path,
        )

        await self.emit(
            "terminal:shell_id",
            {
                "shell_id": shell_id,
                "project_path": shell_project_path,
                "requested_shell_id": requested_shell_id,
                "ts": int(time.time() * 1000),
            },
            to=sid,
        )

        if shell_project_path:
            try:
                snapshot = await _build_terminal_shell_list(shell_project_path, include_exited=True)
                await self.emit("terminal:shell_list", snapshot, to=sid)
            except Exception:
                pass

    async def on_terminal_input(self, sid, data):
        payload = data if isinstance(data, dict) else {}
        text = payload.get("data")
        if text is None:
            return
        try:
            shell_id, _project_path = await _resolve_terminal_event_shell(self, sid, payload)
        except Exception as exc:
            await self.emit("terminal:error", {"message": str(exc)}, to=sid)
            return
        if not shell_id:
            await self.emit("terminal:error", {"message": "No shell bound to this client or payload"}, to=sid)
            return
        try:
            mgr = await get_manager()
            await mgr.write_to_pty(shell_id, str(text))
        except Exception as exc:
            await self.emit("terminal:error", {"message": str(exc), "shell_id": shell_id}, to=sid)

    async def on_terminal_resize(self, sid, data):
        payload = data if isinstance(data, dict) else {}
        cols = int(payload.get("cols") or 80)
        rows = int(payload.get("rows") or 24)
        try:
            shell_id, _project_path = await _resolve_terminal_event_shell(self, sid, payload)
        except Exception as exc:
            await self.emit("terminal:error", {"message": str(exc)}, to=sid)
            return
        if not shell_id:
            return
        try:
            await resize_editor_shell(shell_id, cols, rows)
        except Exception as exc:
            await self.emit("terminal:error", {"message": str(exc), "shell_id": shell_id}, to=sid)

    async def on_terminal_action(self, sid, data):
        payload = data if isinstance(data, dict) else {}
        action = str(payload.get("action") or "").strip().lower()
        async with _terminal_sid_lock:
            shell_id = _terminal_sid_shells.get(sid)
            project_path = _active_terminal_sids.get(sid)
        if not shell_id:
            return
        if action not in {"destroy"}:
            await self.emit(
                "terminal:error",
                {"message": f"Unsupported action '{action}'", "shell_id": shell_id},
                to=sid,
            )
            return
        try:
            await destroy_editor_shell(shell_id)
            if project_path:
                sidecar = ProjectSidecar.load_or_create(project_path)
                sidecar.remove_terminal_shell_id(shell_id)
                sidecar.save()
            await self.emit(
                "terminal:closed",
                {"shell_id": shell_id, "status": "destroyed", "ts": int(time.time() * 1000)},
                to=sid,
            )
            await close_active_terminal_sockets("terminal destroyed")
        except Exception as exc:
            await self.emit("terminal:error", {"message": str(exc), "shell_id": shell_id}, to=sid)


async def close_active_terminal_sockets(reason: str = "project switch") -> None:
    """Close all live terminal websocket connections.

    This is used to force clients to reconnect to /ws/terminal/auto so the
    backend can bind them to the newly active project's shell. The frontend
    remains project-agnostic.
    """
    async with _active_terminal_lock:
        sockets = list(_active_terminal_sockets.keys())
        _active_terminal_sockets.clear()

    async def _close_one(ws: WebSocket) -> None:
        try:
            # Don't block request handlers on slow/busy sockets.
            await asyncio.wait_for(ws.close(code=1012, reason=reason), timeout=0.5)
        except Exception:
            pass

    for ws in sockets:
        asyncio.create_task(_close_one(ws))

    if _TERMINAL_SIO:
        async with _terminal_sid_lock:
            sids = list(_active_terminal_sids.keys())
        payload = {"reason": str(reason or "project switch"), "ts": int(time.time() * 1000)}
        for sid in sids:
            try:
                await _emit_terminal_to_sid("terminal:rebind_required", payload, sid)
            except Exception:
                pass


def _terminal_display_label(title: Optional[str], shell_id: str) -> str:
    base = (title or "").strip() or "Terminal"
    suffix = str(shell_id)[-4:] if shell_id else "????"
    return f"{base}/{suffix}"


def _terminal_status_tag(status: str, pid: Optional[int]) -> str:
    # Keep labels short and UI-friendly.
    if status == "running" and pid:
        return "live"
    if status in ("exited", "missing"):
        return status
    if status == "running" and not pid:
        return "exited"
    return status or "unknown"


async def _build_terminal_shell_list(project_path: str, *, include_exited: bool = True) -> dict:
    sidecar = ProjectSidecar.load_or_create(project_path)
    shell_ids = sidecar.get_terminal_shell_ids()
    active_id = sidecar.get_active_terminal_shell_id()

    mgr = await get_manager()
    shells = []
    for sid in shell_ids:
        rec = await mgr.get_shell(sid)
        raw_status = rec.status if rec else "missing"
        pid = rec.pid if rec else None
        title = sidecar.get_terminal_shell_title(sid)
        tag = _terminal_status_tag(raw_status, pid)
        if not include_exited and tag != "live":
            continue
        shells.append({
            "id": sid,
            "title": title,
            "display_label": _terminal_display_label(title, sid),
            "status": tag,
            "pid": pid,
        })

    return {"active_shell_id": active_id, "shells": shells}


async def _broadcast_terminal_shell_list(project_path: str) -> None:
    payload = {"type": "shell_list"}
    try:
        payload.update(await _build_terminal_shell_list(project_path, include_exited=True))
    except Exception:
        return

    async with _active_terminal_lock:
        targets = [(ws, proj) for ws, proj in _active_terminal_sockets.items()]

    for ws, proj in targets:
        if proj != project_path:
            continue
        try:
            await ws.send_json(payload)
        except Exception:
            # Drop dead sockets.
            async with _active_terminal_lock:
                _active_terminal_sockets.pop(ws, None)

    if _TERMINAL_SIO:
        async with _terminal_sid_lock:
            sid_targets = [(sid, proj) for sid, proj in _active_terminal_sids.items()]
        for sid, proj in sid_targets:
            if proj != project_path:
                continue
            try:
                await _emit_terminal_to_sid("terminal:shell_list", dict(payload), sid)
            except Exception:
                pass

def get_history_store():
    """Return the shared HistoryStore instance used across the app."""
    return _shared_history_store

# Commands allowed for "run current file" action.
RUNNABLE_COMMANDS = {
    ".py": ["python3"],
    ".pyw": ["python3"],
    ".sh": ["bash"],
    ".bash": ["bash"],
    ".zsh": ["zsh"],
}

_C_EXTS = {".c"}
_CPP_EXTS = {".cc", ".cpp", ".cxx"}


def _is_c_family_source(ext: str) -> bool:
    return ext in _C_EXTS or ext in _CPP_EXTS


def _compiler_for_ext(ext: str) -> str:
    if ext in _C_EXTS:
        return "gcc"
    return "g++"


async def _ensure_terminal_shell(
    *,
    project_path: Optional[str],
    preferred_cwd: str,
    mgr: FrameworkShellManager,
    history_store,
) -> str:
    """Return a running terminal shell id, creating one if needed.

    This is guarded by a per-project lock to avoid a race where the terminal WS
    auto-connect creates a shell at the same time as a REST handler (e.g. run
    active file) tries to create one.
    """

    lock_key = _shell_lock_key(project_path, preferred_cwd)
    lock = _get_shell_create_lock(lock_key)

    async with lock:
        shell_id = history_store.get_terminal_shell_id(project_path)
        if shell_id:
            try:
                rec = await mgr.get_shell(shell_id)
            except Exception:
                rec = None
            if rec and rec.status == "running" and rec.pid:
                return shell_id
            history_store.set_terminal_shell_id(None, project_path)
            shell_id = None

        cwd = preferred_cwd if preferred_cwd and Path(preferred_cwd).is_dir() else str(Path.home())
        try:
            sidecar = ProjectSidecar.load_or_create(project_path) if project_path else None
        except Exception:
            sidecar = None

        if sidecar and project_path:
            seq = await _next_sequence_for_project(project_path, sidecar, mgr)
        else:
            seq = 1

        shell_info = await create_editor_shell(cwd=cwd, project_path=project_path, sequence=seq)
        shell_id = shell_info["id"]
        history_store.set_terminal_shell_id(shell_id, project_path)
        return shell_id


async def _next_sequence_for_project(
    project_path: str,
    sidecar: ProjectSidecar,
    mgr: FrameworkShellManager,
) -> int:
    """Compute the next terminal sequence number for a project.

    We cannot rely on list length because dead shells may be pruned, and labels
    use the sequence suffix for uniqueness. Instead, scan tracked shells for
    the highest numeric suffix and increment.
    """
    max_seq = 0
    for sid in sidecar.get_terminal_shell_ids():
        try:
            rec = await mgr.get_shell(sid)
        except Exception:
            rec = None
        if rec and rec.label:
            m = re.search(r":(\d+)$", rec.label)
            if m:
                try:
                    max_seq = max(max_seq, int(m.group(1)))
                except Exception:
                    pass
    if max_seq <= 0:
        max_seq = len(sidecar.get_terminal_shell_ids())
    return max_seq + 1

@terminal_router.get('/terminal/shell-id')
async def get_terminal_shell_id():
    """Get the stored terminal shell ID for the active project.

    Validates the shell is still alive; does not terminate other shells.
    """
    history_store = get_history_store()
    mgr = await get_manager()
    
    try:
        project_path = history_store.get_active_project()
        shell_id = history_store.get_terminal_shell_id(project_path)
        
        # If we have a stored shell ID, verify it still exists
        if shell_id:
            rec = await mgr.get_shell(shell_id)
            if not rec or rec.status != 'running' or not rec.pid:
                # Shell was deleted or died - clear the stale ID
                history_store.set_terminal_shell_id(None, project_path)
                shell_id = None
        
        # Return null if no valid shell ID
        return {"ok": True, "data": {"shell_id": shell_id}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@terminal_router.post('/terminal/shell-id')
async def set_terminal_shell_id(data: dict = Body(...)):
    """Store the terminal shell ID."""
    history_store = get_history_store()
    
    shell_id = data.get('shell_id')
    
    try:
        history_store.set_terminal_shell_id(shell_id)
        return {"ok": True, "data": {"shell_id": shell_id}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.get('/terminal/shells')
async def list_terminal_shells(include_exited: bool = Query(True)):
    """List terminal shells for the active project.

    Returns ordered shells for the active project. By default includes exited
    shells so the UI can show their status; the user can explicitly close them.
    """
    history_store = get_history_store()
    project_path = history_store.get_active_project()
    if not project_path:
        return {"ok": True, "data": {"active_shell_id": None, "shells": []}}

    data = await _build_terminal_shell_list(project_path, include_exited=include_exited)
    return {"ok": True, "data": data}


@terminal_router.post('/terminal/shells')
async def create_terminal_shell():
    """Create a new PTY terminal shell for the active project and set active."""
    history_store = get_history_store()
    project_path = history_store.get_active_project()
    if not project_path:
        raise HTTPException(status_code=400, detail="No active project selected")

    sidecar = ProjectSidecar.load_or_create(project_path)
    mgr = await get_manager()
    sequence = await _next_sequence_for_project(project_path, sidecar, mgr)

    cwd = project_path if Path(project_path).is_dir() else str(Path.home())
    shell_rec = await create_editor_shell(cwd=cwd, project_path=project_path, sequence=sequence)
    shell_id = shell_rec["id"]

    sidecar.add_terminal_shell_id(shell_id)
    sidecar.save()

    # Force any open drawers to rebind to the new active shell.
    await close_active_terminal_sockets("new terminal")

    title = sidecar.get_terminal_shell_title(shell_id)
    return {"ok": True, "data": {"shell_id": shell_id, "label": _terminal_display_label(title, shell_id)}}


@terminal_router.post('/terminal/shells/{shell_id}/title')
async def set_terminal_shell_title(shell_id: str, data: dict = Body(...)):
    """Set (or clear) a short terminal title for the current project.

    Body:
      {"title": "build"}  # max 16 chars, trimmed; empty clears
    """
    history_store = get_history_store()
    project_path = history_store.get_active_project()
    if not project_path:
        raise HTTPException(status_code=400, detail="No active project selected")

    title_raw = data.get("title")
    text = str(title_raw).strip() if title_raw is not None else ""
    if text and len(text) > 16:
        raise HTTPException(status_code=400, detail="title must be <= 16 characters")

    sidecar = ProjectSidecar.load_or_create(project_path)
    if shell_id not in sidecar.get_terminal_shell_ids():
        raise HTTPException(status_code=404, detail="Shell not tracked for this project")

    new_title = sidecar.set_terminal_shell_title(shell_id, text or None)
    sidecar.save()

    # Push an updated list to any connected terminal drawers for this project.
    await _broadcast_terminal_shell_list(project_path)

    return {"ok": True, "data": {"shell_id": shell_id, "title": new_title}}


@terminal_router.post('/terminal/shells/{shell_id}/activate')
async def activate_terminal_shell(shell_id: str):
    """Activate an existing terminal shell for the active project."""
    history_store = get_history_store()
    project_path = history_store.get_active_project()
    if not project_path:
        raise HTTPException(status_code=400, detail="No active project selected")

    sidecar = ProjectSidecar.load_or_create(project_path)
    ids = sidecar.get_terminal_shell_ids()
    if shell_id not in ids:
        raise HTTPException(status_code=404, detail="Shell not tracked for this project")

    mgr = await get_manager()
    rec = await mgr.get_shell(shell_id)
    if not rec or rec.status != "running" or not rec.pid:
        # Prune dead shell.
        sidecar.remove_terminal_shell_id(shell_id)
        sidecar.save()
        raise HTTPException(status_code=409, detail="Shell is not running")

    sidecar.set_active_terminal_shell_id(shell_id)
    sidecar.save()

    await close_active_terminal_sockets("terminal activate")
    return {"ok": True, "data": {"shell_id": shell_id}}


@terminal_router.post('/terminal/run_active_file')
async def run_active_file():
    """Run the currently active (last opened) file in the project terminal.

    Saving is handled separately by the editor save endpoint; this only dispatches.
    """
    history_store = get_history_store()

    project_path = history_store.get_active_project()
    current_file = history_store.get_last_file(project_path) if project_path else None
    if not current_file:
        raise HTTPException(status_code=400, detail="No file is currently open")

    path_obj = Path(current_file).expanduser().resolve(strict=False)
    ext = path_obj.suffix.lower()

    workdir = str(path_obj.parent)

    # Python + shell scripts (direct execution)
    runner = RUNNABLE_COMMANDS.get(ext)
    if runner:
        cmd_tokens = runner + [str(path_obj)]
        command_preview = " ".join(shlex.quote(part) for part in cmd_tokens)
    # C/C++: compile then execute produced binary
    elif _is_c_family_source(ext):
        compiler = _compiler_for_ext(ext)
        compiler_path = shutil.which(compiler)
        if not compiler_path:
            raise HTTPException(
                status_code=400,
                detail=f"Missing compiler '{compiler}' on PATH (install a Termux compiler toolchain)",
            )

        # Build output next to the file (repo-local, predictable), but keep it out of the source tree proper.
        # Future: allow configurable build dir and/or makefile support.
        out_dir = path_obj.parent / ".te2_build"
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create build dir: {e}")

        out_path = out_dir / f"{path_obj.stem}.out"

        # Use relative source path (basename) after cd, so clangd/gcc can resolve local includes naturally.
        src_name = path_obj.name
        compile_tokens = [
            compiler,
            "-O0",
            "-g",
            src_name,
            "-o",
            str(out_path),
        ]
        compile_cmd = " ".join(shlex.quote(part) for part in compile_tokens)
        run_cmd = shlex.quote(str(out_path))
        command_preview = f"cd {shlex.quote(workdir)} && {compile_cmd} && {run_cmd}"
    else:
        raise HTTPException(
            status_code=400,
            detail="Only Python, shell scripts, and C/C++ source files can be executed",
        )

    mgr = await get_manager()
    preferred_cwd = project_path if project_path and Path(project_path).is_dir() else workdir
    shell_id = await _ensure_terminal_shell(
        project_path=project_path,
        preferred_cwd=preferred_cwd,
        mgr=mgr,
        history_store=history_store,
    )

    try:
        await mgr.write_to_pty(shell_id, command_preview + "\n")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to dispatch command: {e}")

    return {
        "ok": True,
        "data": {
            "shell_id": shell_id,
            "command_preview": command_preview,
            "working_dir": workdir,
        },
    }

@terminal_router.delete('/terminal/{shell_id}')
async def terminal_destroy(shell_id: str):
    """
    Permanently destroy a terminal shell session.
    Called when user clicks the X button to close the terminal.
    
    Args:
        shell_id: Shell session ID to destroy
    
    Returns:
        Success confirmation
    """
    try:
        success = await destroy_editor_shell(shell_id)
        # Remove from per-project list if applicable.
        history_store = get_history_store()
        project_path = history_store.get_active_project()
        was_active = False
        if project_path:
            try:
                sidecar = ProjectSidecar.load_or_create(project_path)
                was_active = sidecar.get_active_terminal_shell_id() == shell_id
                sidecar.remove_terminal_shell_id(shell_id)
                sidecar.save()
            except Exception:
                pass
        if was_active:
            await close_active_terminal_sockets("terminal closed")
        if success:
            return {"ok": True, "data": {"id": shell_id}}
        else:
            raise HTTPException(status_code=500, detail="Failed to destroy shell")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.post('/terminal/{shell_id}/resize')
async def terminal_resize(shell_id: str, data: dict = Body(...)):
    """
    Resize the terminal PTY.
    
    Body (JSON):
        cols: Terminal columns
        rows: Terminal rows
    
    Args:
        shell_id: Shell session ID
    
    Returns:
        Success confirmation
    """
    cols = int(data.get('cols', 80))
    rows = int(data.get('rows', 24))
    
    try:
        success = await resize_editor_shell(shell_id, cols, rows)
        if success:
            return {"ok": True, "data": {"id": shell_id, "cols": cols, "rows": rows}}
        else:
            raise HTTPException(status_code=500, detail="Failed to resize terminal")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.get('/terminal/{shell_id}')
async def terminal_info(shell_id: str, logs: bool = Query(False), tail: int = Query(200), mgr: FrameworkShellManager = Depends(get_manager_dep)):
    """
    Get terminal shell session information.
    
    Query params:
        logs: Include log tails (default: false)
        tail: Number of lines to include (default: 200)
    
    Args:
        shell_id: Shell session ID
    
    Returns:
        Shell metadata with optional log tails
    """
    try:
        rec = await mgr.get_shell(shell_id)
        if not rec:
            raise HTTPException(status_code=404, detail="Shell not found")
        
        info = await mgr.describe(rec, include_logs=logs, tail_lines=tail)
        return {"ok": True, "data": info}
    except HTTPException:
        raise  # Re-raise HTTPException as-is
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.get('/terminal/{shell_id}/history')
async def terminal_history(shell_id: str, tail: int = Query(2000), mgr: FrameworkShellManager = Depends(get_manager_dep)):
    """
    Return uncapped terminal stdout history as plain text.

    Unlike mgr.describe(... include_logs=True ...), this reads the shell stdout log
    directly so history preload is not constrained by FWS LOG_TAIL_BYTES.
    """
    try:
        rec = await mgr.get_shell(shell_id)
        if not rec:
            raise HTTPException(status_code=404, detail="Shell not found")

        stdout_text = await _read_terminal_log_tail_text_async(Path(rec.stdout_log), max(0, tail))
        return {"ok": True, "data": {"stdout_text": stdout_text}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.websocket('/ws/terminal/{shell_id}')
async def terminal_ws(websocket: WebSocket, shell_id: str):
    """WebSocket endpoint for bidirectional PTY streaming.

    Note: we intentionally avoid `Depends(get_manager)` here because exceptions
    raised during dependency resolution can reject the websocket handshake
    (HTTP 403) before we get a chance to accept and report an error.

    If shell_id is 'auto', backend will restore or create a shell automatically.
    """
    await websocket.accept()

    try:
        mgr = await get_manager()
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
        await websocket.close()
        return

    # Register this websocket for backend-managed project switches.
    async with _active_terminal_lock:
        _active_terminal_sockets[websocket] = None

    history_store = get_history_store()
    shell_project_path: str | None = None
    
    # Handle auto shell management
    try:
        shell_id, shell_project_path = await _resolve_terminal_shell_id(
            shell_id,
            mgr=mgr,
            history_store=history_store,
        )
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close()
        return

    print(f"[Terminal WS] Using shell: {shell_id}")

    # Send shell ID to client
    print(f"[Terminal WS] Sending shell_id to client: {shell_id}")
    await websocket.send_json({"type": "shell_id", "shell_id": shell_id})

    # Track project association for UI update broadcasts.
    async with _active_terminal_lock:
        _active_terminal_sockets[websocket] = shell_project_path

    # Send initial shell list snapshot (titles + statuses) to seed the header.
    if shell_project_path:
        try:
            snapshot = await _build_terminal_shell_list(shell_project_path, include_exited=True)
            await websocket.send_json({"type": "shell_list", **snapshot})
        except Exception:
            pass
    
    # Subscribe to output - DIRECT AWAIT, AsyncQueue returned
    try:
        output_queue = await mgr.subscribe_output(shell_id)
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close()
        return
    
    stop_event = asyncio.Event()
    exit_notified = False
    
    async def forward_pty_to_ws():
        """Forward PTY output to WebSocket client"""
        nonlocal exit_notified
        last_status_check = 0.0
        while not stop_event.is_set():
            try:
                # AsyncQueue.get is already async - DIRECT AWAIT
                chunk = await asyncio.wait_for(output_queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                # No data: periodically check if the shell is still alive so the
                # UI can update (no HTTP polling needed).
                if exit_notified:
                    continue
                now = asyncio.get_running_loop().time()
                if now - last_status_check < 2.0:
                    continue
                last_status_check = now

                try:
                    rec = await mgr.get_shell(shell_id)
                except Exception:
                    rec = None

                live = bool(rec and rec.status == "running" and rec.pid)
                if live:
                    continue

                # Stop PTY state now that the process is gone (prevents stale subscriptions).
                try:
                    if rec:
                        await mgr.terminate_shell(shell_id, force=True)
                except Exception:
                    pass

                status_tag = _terminal_status_tag(rec.status if rec else "missing", rec.pid if rec else None)
                exit_code = rec.exit_code if rec else None
                exit_notified = True

                marker = f"\r\n\r\n[{status_tag}]\r\n"
                if exit_code is not None and status_tag in ("exited", "live"):
                    marker = f"\r\n\r\n[{status_tag}: {exit_code}]\r\n"

                # Append marker to stdout log so history loads show it.
                try:
                    if rec and rec.stdout_log:
                        with open(rec.stdout_log, "ab") as fh:
                            fh.write(marker.encode("utf-8", errors="replace"))
                except Exception:
                    pass

                try:
                    await websocket.send_text(marker)
                except Exception:
                    stop_event.set()
                    break

                # Push an updated shell list to refresh dropdown statuses.
                if shell_project_path:
                    try:
                        await _broadcast_terminal_shell_list(shell_project_path)
                    except Exception:
                        pass
                stop_event.set()
                continue
            
            try:
                await websocket.send_text(chunk)
            except Exception:
                # Force the websocket loop to unwind so a fresh connection can start cleanly
                stop_event.set()
                try:
                    await websocket.close(code=1011, reason='terminal stream error')
                except Exception:
                    pass
                break
    
    forward_task = asyncio.create_task(forward_pty_to_ws())
    
    edit_tracker.register_shell_watcher(shell_id, 'terminal')
    
    try:
        async for msg in websocket.iter_text():
            # Check if this is a command message
            try:
                data = json.loads(msg)
                if isinstance(data, dict) and data.get('action') == 'destroy':
                    print(f"[Terminal WS] Received destroy command for shell {shell_id}")
                    
                    # Terminate the shell
                    try:
                        await mgr.terminate_shell(shell_id, force=True)
                    except Exception as e:
                        print(f"[Terminal WS] Error terminating shell: {e}")
                    
                    # Clear from history store (ATOMIC with terminate)
                    if shell_project_path:
                        try:
                            sidecar = ProjectSidecar.load_or_create(shell_project_path)
                            sidecar.remove_terminal_shell_id(shell_id)
                            sidecar.save()
                        except Exception:
                            history_store.set_terminal_shell_id(None, shell_project_path)
                    else:
                        history_store.set_terminal_shell_id(None, shell_project_path)
                    print(f"[Terminal WS] Shell {shell_id} destroyed and cache cleared")
                    
                    # Send confirmation and close
                    await websocket.send_json({"type": "destroyed", "shell_id": shell_id})
                    break  # Exit loop, triggers cleanup in finally block
            except (json.JSONDecodeError, TypeError):
                # Not JSON, treat as regular terminal input
                pass
            
            # Regular terminal input
            try:
                await mgr.write_to_pty(shell_id, msg)
            except Exception:
                pass
    finally:
        stop_event.set()
        edit_tracker.unregister_shell_watcher(shell_id)
        async with _active_terminal_lock:
            _active_terminal_sockets.pop(websocket, None)
        forward_task.cancel()
        try:
            await forward_task
        except asyncio.CancelledError:
            pass
        
        try:
            # DIRECT AWAIT
            await mgr.unsubscribe_output(shell_id, output_queue)
        except Exception:
            pass
