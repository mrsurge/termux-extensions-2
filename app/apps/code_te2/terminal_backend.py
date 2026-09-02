# app/apps/code_te2/terminal_backend.py

"""
Terminal drawer backend for the code editor.
Provides REST endpoints and WebSocket PTY streaming for embedded terminal.
"""

import asyncio
from collections import deque
import importlib
import json
import shlex
import re
import shutil
import time
from pathlib import Path
from typing import Awaitable, Callable, Mapping, Protocol, TypeAlias, cast
from fastapi import APIRouter, HTTPException, WebSocket, Body, Query, Depends
import socketio  # type: ignore[reportMissingTypeStubs]

JsonObject: TypeAlias = dict[str, object]


class TerminalOutputQueue(Protocol):
    def get(self) -> Awaitable[str]: ...


class ShellRecordLike(Protocol):
    status: str
    pid: int | None
    exit_code: int | None
    label: str | None
    stdout_log: str | Path | None


class TerminalShellManager(Protocol):
    def get_shell(self, shell_id: str) -> Awaitable[ShellRecordLike | None]: ...

    def subscribe_output(self, shell_id: str) -> Awaitable[TerminalOutputQueue]: ...

    def unsubscribe_output(self, shell_id: str, output_queue: TerminalOutputQueue) -> Awaitable[None]: ...

    def write_to_pty(self, shell_id: str, data: str) -> Awaitable[None]: ...

    def terminate_shell(self, shell_id: str, *, force: bool = False) -> Awaitable[object]: ...

    def describe(
        self,
        rec: ShellRecordLike,
        *,
        include_logs: bool = False,
        tail_lines: int = 200,
    ) -> Awaitable[JsonObject]: ...


class TerminalSocketLike(Protocol):
    def emit(
        self,
        event: str,
        data: object | None = None,
        *,
        to: str | None = None,
        room: str | None = None,
        namespace: str | None = None,
    ) -> Awaitable[object]: ...

    def enter_room(self, sid: str, room: str) -> Awaitable[object]: ...

    def leave_room(self, sid: str, room: str) -> Awaitable[object]: ...


class TerminalHistoryStore(Protocol):
    def get_active_project(self) -> str | None: ...

    def get_terminal_shell_id(self, project_path: str | None = None) -> str | None: ...

    def set_terminal_shell_id(self, shell_id: str | None, project_path: str | None = None) -> object: ...

    def get_last_file(self, project_path: str | None) -> str | None: ...


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _socket(obj: object) -> TerminalSocketLike:
    return cast(TerminalSocketLike, obj)


def _as_int(value: object, default: int) -> int:
    if not isinstance(value, int | float | str):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


async def _create_editor_shell(
    *,
    cwd: str,
    project_path: str | None,
    sequence: int | None = None,
) -> JsonObject:
    fn = cast(Callable[..., Awaitable[object]], getattr(_terminal_shell, "create_editor_shell"))
    return _json_object(await fn(cwd=cwd, project_path=project_path, sequence=sequence))


async def _destroy_editor_shell(shell_id: str) -> bool:
    fn = cast(Callable[..., Awaitable[object]], getattr(_terminal_shell, "destroy_editor_shell"))
    return bool(await fn(shell_id))


async def _resize_editor_shell(shell_id: str, cols: int, rows: int) -> bool:
    fn = cast(Callable[..., Awaitable[object]], getattr(_terminal_shell, "resize_editor_shell"))
    return bool(await fn(shell_id, cols, rows))


async def _get_terminal_manager() -> TerminalShellManager:
    module = importlib.import_module("framework_shells")
    get_manager_fn = cast(Callable[[], Awaitable[object]], getattr(module, "get_manager"))
    return cast(TerminalShellManager, await get_manager_fn())


async def get_manager_dep() -> TerminalShellManager:
    return await _get_terminal_manager()

from app.apps.code_te2 import edit_tracker
from app.apps.code_te2.stores import get_history_store as _get_shared_history_store
from app.apps.code_te2.project_sidecar import ProjectSidecar
from app.apps.code_te2 import terminal_shell as _terminal_shell
from app.apps.code_te2.terminal_shell_facts import (
    configure_terminal_facts_changed,
    get_terminal_shell_fact,
    record_terminal_shell_fact,
    remove_terminal_shell_fact,
)
from app.apps.code_te2.worker_services.run_profile_fws_bridge import (
    configure_terminal_log_stream,
    ensure_terminal_log_stream,
)

terminal_router = APIRouter()

# Track active terminal websocket clients so the backend can force a reconnect on project switch.
_active_terminal_sockets: dict[WebSocket, str | None] = {}
_active_terminal_lock = asyncio.Lock()
_shell_create_locks: dict[str, asyncio.Lock] = {}
_terminal_sio: socketio.AsyncServer | None = None
_active_terminal_sids: dict[str, str | None] = {}
_terminal_sid_shells: dict[str, str] = {}
_terminal_sid_clients: dict[str, str] = {}
_terminal_sid_lock = asyncio.Lock()
_terminal_sid_bind_generations: dict[str, int] = {}
_terminal_history_tasks: dict[str, asyncio.Task[None]] = {}


def _read_terminal_log_tail_text(path: Path, lines: int) -> str:
    if lines <= 0 or not path.exists():
        return ""
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        tail_lines = deque(fh, maxlen=lines)
    return "".join(tail_lines)


async def _read_terminal_log_tail_text_async(path: Path, lines: int) -> str:
    return await asyncio.to_thread(_read_terminal_log_tail_text, path, lines)


def attach_terminal_socketio_server(server: socketio.AsyncServer) -> None:
    global _terminal_sio
    _terminal_sio = server


def _terminal_shell_room(shell_id: str) -> str:
    return f"terminal:shell:{str(shell_id or '').strip() or 'unknown'}"


def _terminal_client_room(client_id: str) -> str:
    return f"terminal:client:{str(client_id or '').strip() or 'unknown'}"


def _record_terminal_manager_shell(shell_id: str, record: ShellRecordLike) -> None:
    _ = record_terminal_shell_fact(
        {
            "id": shell_id,
            "label": record.label,
            "status": record.status,
            "pid": record.pid,
            "exit_code": record.exit_code,
            "stdout_log": str(record.stdout_log or ""),
        }
    )


async def _emit_terminal_to_sid(event: str, payload: JsonObject, sid: str) -> None:
    if not _terminal_sio or not sid:
        return
    sio = cast(TerminalSocketLike, _terminal_sio)
    await sio.emit(event, payload, namespace="/terminal", to=sid)


async def _emit_terminal_to_shell(event: str, payload: JsonObject, shell_id: str) -> None:
    if not _terminal_sio or not shell_id:
        return
    sio = cast(TerminalSocketLike, _terminal_sio)
    await sio.emit(
        event,
        payload,
        namespace="/terminal",
        room=_terminal_shell_room(shell_id),
    )


def _shell_lock_key(project_path: str | None, fallback: str) -> str:
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
    mgr: TerminalShellManager,
    history_store: TerminalHistoryStore,
) -> tuple[str, str | None]:
    shell_id = str(requested_shell_id or "").strip() or "auto"
    shell_project_path = history_store.get_active_project()
    if shell_id != "auto":
        rec = await mgr.get_shell(shell_id)
        if not rec or rec.status != "running" or not rec.pid:
            raise RuntimeError("Shell is not running")
        _record_terminal_manager_shell(shell_id, rec)
        return shell_id, shell_project_path

    saved_shell_id = history_store.get_terminal_shell_id(shell_project_path)
    if saved_shell_id:
        rec = await mgr.get_shell(saved_shell_id)
        if rec and rec.status == "running" and rec.pid:
            _record_terminal_manager_shell(saved_shell_id, rec)
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


async def _detach_terminal_sid(ns: TerminalSocketLike, sid: str) -> None:
    async with _terminal_sid_lock:
        old_shell_id = _terminal_sid_shells.pop(sid, None)
        _terminal_sid_clients.pop(sid, None)
        _active_terminal_sids.pop(sid, None)
        _terminal_sid_bind_generations.pop(sid, None)
        history_task = _terminal_history_tasks.pop(sid, None)
    if history_task is not None:
        _ = history_task.cancel()
    if old_shell_id:
        try:
            await ns.leave_room(sid, _terminal_shell_room(old_shell_id))
        except Exception:
            pass


async def _bind_terminal_sid(
    ns: TerminalSocketLike,
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

    active_client_id = old_client_id or requested_client_id
    active_project_path = requested_project_path if requested_project_path is not None else old_project_path

    await ns.enter_room(sid, _terminal_client_room(active_client_id))
    if not same_shell:
        await ns.enter_room(sid, _terminal_shell_room(shell_id))

    async with _terminal_sid_lock:
        _terminal_sid_clients[sid] = active_client_id
        _terminal_sid_shells[sid] = shell_id
        _active_terminal_sids[sid] = active_project_path

    return same_shell, active_project_path


async def _next_terminal_bind_generation(sid: str) -> int:
    async with _terminal_sid_lock:
        generation = _terminal_sid_bind_generations.get(sid, 0) + 1
        _terminal_sid_bind_generations[sid] = generation
        return generation


async def _emit_terminal_history_to_sid(
    sid: str,
    shell_id: str,
    bind_generation: int,
) -> None:
    payload: JsonObject = {
        "shell_id": shell_id,
        "bind_generation": bind_generation,
        "stdout_text": "",
        "ok": True,
    }
    try:
        payload.update(await _terminal_history_data(shell_id, 2000))
    except Exception as exc:
        payload["ok"] = False
        payload["error"] = str(getattr(exc, "detail", exc))
    async with _terminal_sid_lock:
        if (
            _terminal_sid_shells.get(sid) != shell_id
            or _terminal_sid_bind_generations.get(sid) != bind_generation
        ):
            return
    await _emit_terminal_to_sid("terminal:history", payload, sid)


async def _start_terminal_history_task(
    sid: str,
    shell_id: str,
    bind_generation: int,
) -> None:
    async def run() -> None:
        try:
            try:
                await ensure_terminal_log_stream(shell_id)
            except Exception as exc:
                await _emit_terminal_to_sid(
                    "terminal:error",
                    {
                        "message": str(exc),
                        "shell_id": shell_id,
                        "source": "fws_terminal_log_stream",
                    },
                    sid,
                )
            await _emit_terminal_history_to_sid(sid, shell_id, bind_generation)
        finally:
            async with _terminal_sid_lock:
                current = _terminal_history_tasks.get(sid)
                if current is asyncio.current_task():
                    _terminal_history_tasks.pop(sid, None)

    task = asyncio.create_task(
        run(),
        name=f"terminal-history-{sid}-{bind_generation}",
    )
    async with _terminal_sid_lock:
        old_task = _terminal_history_tasks.get(sid)
        _terminal_history_tasks[sid] = task
    if old_task is not None and old_task is not task:
        _ = old_task.cancel()


async def _emit_terminal_shell_list_to_sid(sid: str, project_path: str | None) -> None:
    if not project_path:
        return
    try:
        snapshot = await _build_terminal_shell_list(project_path, include_exited=True)
        await _emit_terminal_to_sid("terminal:shell_list", snapshot, sid)
    except Exception:
        pass


async def _forward_terminal_fws_chunk(shell_id: str, chunk: str) -> None:
    await _emit_terminal_to_shell(
        "terminal:output",
        {"shell_id": shell_id, "data": chunk},
        shell_id,
    )


async def _rebind_terminal_fws_stream(shell_id: str) -> None:
    async with _terminal_sid_lock:
        sids = [
            sid
            for sid, bound_shell_id in _terminal_sid_shells.items()
            if bound_shell_id == shell_id
        ]
    payload: JsonObject = {
        "reason": "terminal output transport reconnected",
        "shell_id": shell_id,
        "ts": int(time.time() * 1000),
    }
    for sid in sids:
        await _emit_terminal_to_sid("terminal:rebind_required", payload, sid)


configure_terminal_log_stream(
    on_chunk=_forward_terminal_fws_chunk,
    on_reconnect=_rebind_terminal_fws_stream,
)


async def _resolve_terminal_event_shell(
    ns: TerminalSocketLike,
    sid: str,
    payload: JsonObject,
) -> tuple[str | None, str | None]:
    requested_shell_id = str(payload.get("shell_id") or payload.get("shellId") or "").strip()
    requested_client_id = str(payload.get("client_id") or "").strip() or None
    requested_project_path = str(payload.get("project_path") or "").strip() or None
    async with _terminal_sid_lock:
        bound_shell_id = _terminal_sid_shells.get(sid)
        bound_project_path = _active_terminal_sids.get(sid)
    if requested_shell_id and bound_shell_id and requested_shell_id == bound_shell_id and not requested_client_id and requested_project_path is None:
        return bound_shell_id, bound_project_path
    if not requested_shell_id:
        return bound_shell_id, bound_project_path
    if requested_shell_id:
        mgr = await _get_terminal_manager()
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
    return None, None


class TerminalSocketIONamespace(socketio.AsyncNamespace):
    async def trigger_event(self, event: str, *args: object) -> object | None:
        normalized = event.replace(":", "_") if event else event
        handler = cast(Callable[..., Awaitable[object | None]] | None, getattr(self, "on_" + (normalized or ""), None))
        if handler:
            return await handler(*args)
        trigger = cast(Callable[..., Awaitable[object | None]], super().trigger_event)
        return await trigger(event, *args)

    async def on_connect(self, sid: str, environ: object) -> None:
        print(f"[terminal_ws] connect sid={sid}", flush=True)

    async def on_disconnect(self, sid: str, reason: object = None) -> None:
        print(f"[terminal_ws] disconnect sid={sid} reason={reason}", flush=True)
        await _detach_terminal_sid(self, sid)

    async def on_terminal_register(self, sid: str, data: object) -> None:
        payload = _json_object(data)
        client_id = str(payload.get("client_id") or sid).strip() or sid
        requested_shell_id = str(payload.get("shellId") or payload.get("shell_id") or "auto").strip() or "auto"
        history_store = get_history_store()
        mgr = await _get_terminal_manager()
        try:
            shell_id, shell_project_path = await _resolve_terminal_shell_id(
                requested_shell_id,
                mgr=mgr,
                history_store=history_store,
            )
        except Exception as exc:
            await _socket(self).emit(
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
        bind_generation = await _next_terminal_bind_generation(sid)

        await _socket(self).emit(
            "terminal:shell_id",
            {
                "shell_id": shell_id,
                "project_path": shell_project_path,
                "requested_shell_id": requested_shell_id,
                "bind_generation": bind_generation,
                "ts": int(time.time() * 1000),
            },
            to=sid,
        )

        await _start_terminal_history_task(sid, shell_id, bind_generation)
        _ = asyncio.create_task(
            _emit_terminal_shell_list_to_sid(sid, shell_project_path),
            name=f"terminal-shell-list-{sid}-{bind_generation}",
        )

    async def on_terminal_request(self, _sid: str, data: object) -> JsonObject:
        payload = _json_object(data)
        request_id = str(payload.get("id") or "").strip()
        method = str(payload.get("method") or "").strip()
        params = _json_object(payload.get("params"))
        if not request_id or not method:
            return {
                "id": request_id,
                "ok": False,
                "error": "Terminal request requires id and method",
            }
        try:
            if method == "shells.get":
                result = await _terminal_shell_list_data()
            elif method == "shell.create":
                result = await _create_terminal_shell_data()
            elif method == "shell.activate":
                result = await _activate_terminal_shell_data(str(params.get("shell_id") or ""))
            elif method == "shell.title":
                result = await _set_terminal_shell_title_data(
                    str(params.get("shell_id") or ""),
                    params.get("title"),
                )
            elif method in {"shell.remove", "shell.destroy"}:
                result = await _destroy_terminal_shell_data(str(params.get("shell_id") or ""))
            elif method == "shell.history":
                result = await _terminal_history_data(
                    str(params.get("shell_id") or ""),
                    _as_int(params.get("tail"), 2000),
                )
            else:
                raise ValueError(f"Unsupported terminal request '{method}'")
            return {"id": request_id, "ok": True, "result": result}
        except Exception as exc:
            return {
                "id": request_id,
                "ok": False,
                "error": str(getattr(exc, "detail", exc)),
            }

    async def on_terminal_input(self, sid: str, data: object) -> None:
        payload = _json_object(data)
        text = payload.get("data")
        if text is None:
            return
        try:
            shell_id, _project_path = await _resolve_terminal_event_shell(self, sid, payload)
        except Exception as exc:
            await _socket(self).emit("terminal:error", {"message": str(exc)}, to=sid)
            return
        if not shell_id:
            await _socket(self).emit("terminal:error", {"message": "No shell bound to this client or payload"}, to=sid)
            return
        try:
            mgr = await _get_terminal_manager()
            await mgr.write_to_pty(shell_id, str(text))
        except Exception as exc:
            await _socket(self).emit("terminal:error", {"message": str(exc), "shell_id": shell_id}, to=sid)

    async def on_terminal_resize(self, sid: str, data: object) -> None:
        payload = _json_object(data)
        cols = _as_int(payload.get("cols"), 80)
        rows = _as_int(payload.get("rows"), 24)
        try:
            shell_id, _project_path = await _resolve_terminal_event_shell(self, sid, payload)
        except Exception as exc:
            await _socket(self).emit("terminal:error", {"message": str(exc)}, to=sid)
            return
        if not shell_id:
            return
        try:
            await _resize_editor_shell(shell_id, cols, rows)
        except Exception as exc:
            await _socket(self).emit("terminal:error", {"message": str(exc), "shell_id": shell_id}, to=sid)

    async def on_terminal_action(self, sid: str, data: object) -> None:
        payload = _json_object(data)
        action = str(payload.get("action") or "").strip().lower()
        async with _terminal_sid_lock:
            shell_id = _terminal_sid_shells.get(sid)
            project_path = _active_terminal_sids.get(sid)
        if not shell_id:
            return
        if action not in {"destroy"}:
            await _socket(self).emit(
                "terminal:error",
                {"message": f"Unsupported action '{action}'", "shell_id": shell_id},
                to=sid,
            )
            return
        try:
            await _destroy_editor_shell(shell_id)
            if project_path:
                sidecar = ProjectSidecar.load_or_create(project_path)
                sidecar.remove_terminal_shell_id(shell_id)
                sidecar.save()
            await _socket(self).emit(
                "terminal:closed",
                {"shell_id": shell_id, "status": "destroyed", "ts": int(time.time() * 1000)},
                to=sid,
            )
            await close_active_terminal_sockets("terminal destroyed")
        except Exception as exc:
            await _socket(self).emit("terminal:error", {"message": str(exc), "shell_id": shell_id}, to=sid)


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

    if _terminal_sio:
        async with _terminal_sid_lock:
            sids = list(_active_terminal_sids.keys())
        payload: JsonObject = {"reason": str(reason or "project switch"), "ts": int(time.time() * 1000)}
        for sid in sids:
            try:
                await _emit_terminal_to_sid("terminal:rebind_required", payload, sid)
            except Exception:
                pass


def _terminal_display_label(title: str | None, shell_id: str) -> str:
    base = (title or "").strip() or "Terminal"
    suffix = str(shell_id)[-4:] if shell_id else "????"
    return f"{base}/{suffix}"


def _terminal_status_tag(status: str, pid: int | None) -> str:
    # Keep labels short and UI-friendly.
    if status == "running" and pid:
        return "live"
    if status in ("exited", "missing"):
        return status
    if status == "running" and not pid:
        return "exited"
    return status or "unknown"


async def _build_terminal_shell_list(project_path: str, *, include_exited: bool = True) -> JsonObject:
    sidecar = ProjectSidecar.load_or_create(project_path)
    shell_ids = sidecar.get_terminal_shell_ids()
    active_id = sidecar.get_active_terminal_shell_id()

    shells: list[JsonObject] = []
    for sid in shell_ids:
        fact = get_terminal_shell_fact(sid)
        raw_status = fact.status if fact else "missing"
        pid = fact.pid if fact else None
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
    payload: JsonObject = {"type": "shell_list"}
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

    if _terminal_sio:
        async with _terminal_sid_lock:
            sid_targets = [(sid, proj) for sid, proj in _active_terminal_sids.items()]
        for sid, proj in sid_targets:
            if proj != project_path:
                continue
            try:
                await _emit_terminal_to_sid("terminal:shell_list", dict(payload), sid)
            except Exception:
                pass


async def _broadcast_active_project_terminal_shell_list() -> None:
    project_path = get_history_store().get_active_project()
    if not project_path:
        return
    await _broadcast_terminal_shell_list(project_path)
    async with _terminal_sid_lock:
        bound_shells = list(_terminal_sid_shells.items())
    for sid, shell_id in bound_shells:
        fact = get_terminal_shell_fact(shell_id)
        status = _terminal_status_tag(
            fact.status if fact is not None else "missing",
            fact.pid if fact is not None else None,
        )
        if status == "live":
            continue
        exit_code = fact.exit_code if fact is not None else None
        marker = f"\r\n\r\n[{status}]\r\n"
        if exit_code is not None:
            marker = f"\r\n\r\n[{status}: {exit_code}]\r\n"
        await _emit_terminal_to_sid(
            "terminal:output",
            {"shell_id": shell_id, "data": marker},
            sid,
        )
        await _emit_terminal_to_sid(
            "terminal:closed",
            {
                "shell_id": shell_id,
                "status": status,
                "exit_code": exit_code,
                "marker": marker,
                "ts": int(time.time() * 1000),
            },
            sid,
        )


configure_terminal_facts_changed(_broadcast_active_project_terminal_shell_list)

def get_history_store():
    """Return the shared HistoryStore instance used across the app."""
    return cast(TerminalHistoryStore, _get_shared_history_store())

# Commands allowed for "run current file" action.
RUNNABLE_COMMANDS = {
    ".py": ["python3"],
    ".pyw": ["python3"],
    ".sh": ["bash"],
    ".bash": ["bash"],
    ".zsh": ["zsh"],
    ".js": ["node"],
    ".mjs": ["node"],
    ".cjs": ["node"],
    ".ts": ["node"],
    ".mts": ["node"],
    ".cts": ["node"],
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
    project_path: str | None,
    preferred_cwd: str,
    mgr: TerminalShellManager,
    history_store: TerminalHistoryStore,
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

        shell_info = await _create_editor_shell(cwd=cwd, project_path=project_path, sequence=seq)
        shell_id = str(shell_info.get("id") or "")
        if not shell_id:
            raise RuntimeError("Terminal shell creation returned no id")
        history_store.set_terminal_shell_id(shell_id, project_path)
        return shell_id


async def _next_sequence_for_project(
    project_path: str,
    sidecar: ProjectSidecar,
    mgr: TerminalShellManager,
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

def _active_terminal_project() -> str:
    project_path = get_history_store().get_active_project()
    if not project_path:
        raise HTTPException(status_code=400, detail="No active project selected")
    return project_path


async def _terminal_shell_list_data() -> JsonObject:
    project_path = get_history_store().get_active_project()
    if not project_path:
        return {"active_shell_id": None, "shells": []}
    return await _build_terminal_shell_list(project_path, include_exited=True)


async def _create_terminal_shell_data() -> JsonObject:
    project_path = _active_terminal_project()
    sidecar = ProjectSidecar.load_or_create(project_path)
    mgr = await _get_terminal_manager()
    sequence = await _next_sequence_for_project(project_path, sidecar, mgr)
    cwd = project_path if Path(project_path).is_dir() else str(Path.home())
    shell_rec = await _create_editor_shell(
        cwd=cwd,
        project_path=project_path,
        sequence=sequence,
    )
    shell_id = str(shell_rec.get("id") or "")
    if not shell_id:
        raise HTTPException(status_code=500, detail="Terminal shell creation returned no id")
    _ = record_terminal_shell_fact(shell_rec)
    sidecar.add_terminal_shell_id(shell_id)
    sidecar.save()
    await close_active_terminal_sockets("new terminal")
    await _broadcast_terminal_shell_list(project_path)
    title = sidecar.get_terminal_shell_title(shell_id)
    return {
        "shell_id": shell_id,
        "label": _terminal_display_label(title, shell_id),
        "shell_list": await _build_terminal_shell_list(project_path, include_exited=True),
    }


async def _set_terminal_shell_title_data(shell_id: str, title: object) -> JsonObject:
    project_path = _active_terminal_project()
    text = str(title).strip() if title is not None else ""
    if text and len(text) > 16:
        raise HTTPException(status_code=400, detail="title must be <= 16 characters")
    sidecar = ProjectSidecar.load_or_create(project_path)
    if shell_id not in sidecar.get_terminal_shell_ids():
        raise HTTPException(status_code=404, detail="Shell not tracked for this project")
    new_title = sidecar.set_terminal_shell_title(shell_id, text or None)
    sidecar.save()
    await _broadcast_terminal_shell_list(project_path)
    return {
        "shell_id": shell_id,
        "title": new_title,
        "shell_list": await _build_terminal_shell_list(project_path, include_exited=True),
    }


async def _activate_terminal_shell_data(shell_id: str) -> JsonObject:
    project_path = _active_terminal_project()
    sidecar = ProjectSidecar.load_or_create(project_path)
    if shell_id not in sidecar.get_terminal_shell_ids():
        raise HTTPException(status_code=404, detail="Shell not tracked for this project")
    mgr = await _get_terminal_manager()
    rec = await mgr.get_shell(shell_id)
    if not rec or rec.status != "running" or not rec.pid:
        sidecar.remove_terminal_shell_id(shell_id)
        sidecar.save()
        raise HTTPException(status_code=409, detail="Shell is not running")
    _record_terminal_manager_shell(shell_id, rec)
    sidecar.set_active_terminal_shell_id(shell_id)
    sidecar.save()
    await close_active_terminal_sockets("terminal activate")
    return {
        "shell_id": shell_id,
        "shell_list": await _build_terminal_shell_list(project_path, include_exited=True),
    }


async def _destroy_terminal_shell_data(shell_id: str) -> JsonObject:
    success = await _destroy_editor_shell(shell_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to destroy shell")
    history_store = get_history_store()
    project_path = history_store.get_active_project()
    was_active = False
    if project_path:
        sidecar = ProjectSidecar.load_or_create(project_path)
        was_active = sidecar.get_active_terminal_shell_id() == shell_id
        sidecar.remove_terminal_shell_id(shell_id)
        sidecar.save()
    _ = remove_terminal_shell_fact(shell_id)
    if was_active:
        await close_active_terminal_sockets("terminal closed")
    if project_path:
        await _broadcast_terminal_shell_list(project_path)
    return {
        "id": shell_id,
        "shell_list": (
            await _build_terminal_shell_list(project_path, include_exited=True)
            if project_path
            else {"active_shell_id": None, "shells": []}
        ),
    }


async def _terminal_history_data(shell_id: str, tail: int = 2000) -> JsonObject:
    stdout_log = ""
    fact = get_terminal_shell_fact(shell_id)
    if fact is not None:
        stdout_log = fact.stdout_log
    if not stdout_log:
        mgr = await _get_terminal_manager()
        rec = await mgr.get_shell(shell_id)
        if not rec:
            raise HTTPException(status_code=404, detail="Shell not found")
        _record_terminal_manager_shell(shell_id, rec)
        stdout_log = str(rec.stdout_log or "")
    stdout_text = (
        await _read_terminal_log_tail_text_async(Path(stdout_log), max(0, tail))
        if stdout_log
        else ""
    )
    return {"stdout_text": stdout_text}


@terminal_router.get('/terminal/shell-id')
async def get_terminal_shell_id():
    """Get the stored terminal shell ID for the active project.

    Validates the shell is still alive; does not terminate other shells.
    """
    history_store = get_history_store()
    mgr = await _get_terminal_manager()
    
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
async def set_terminal_shell_id(data: JsonObject = Body(...)):
    """Store the terminal shell ID."""
    history_store = get_history_store()
    
    shell_id_obj = data.get('shell_id')
    shell_id = str(shell_id_obj).strip() if shell_id_obj is not None else None
    
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
    data = await _terminal_shell_list_data()
    if not include_exited:
        shells = data.get("shells")
        if isinstance(shells, list):
            data["shells"] = [
                item
                for item in cast(list[object], shells)
                if isinstance(item, Mapping) and item.get("status") == "live"
            ]
    return {"ok": True, "data": data}


@terminal_router.post('/terminal/shells')
async def create_terminal_shell():
    """Create a new PTY terminal shell for the active project and set active."""
    return {"ok": True, "data": await _create_terminal_shell_data()}


@terminal_router.post('/terminal/shells/{shell_id}/title')
async def set_terminal_shell_title(shell_id: str, data: JsonObject = Body(...)):
    """Set (or clear) a short terminal title for the current project.

    Body:
      {"title": "build"}  # max 16 chars, trimmed; empty clears
    """
    return {
        "ok": True,
        "data": await _set_terminal_shell_title_data(shell_id, data.get("title")),
    }


@terminal_router.post('/terminal/shells/{shell_id}/activate')
async def activate_terminal_shell(shell_id: str):
    """Activate an existing terminal shell for the active project."""
    return {"ok": True, "data": await _activate_terminal_shell_data(shell_id)}


@terminal_router.post('/terminal/run_active_file')
async def run_active_file():
    """Run the currently active (last opened) file in the project terminal.

    Saving is handled separately by the editor save endpoint; this only dispatches.
    """
    return await handle_run_active_file_request()


async def handle_run_active_file_request(
    data: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Dispatch a runnable file into the active terminal shell.

    The caller may provide an explicit `path`; otherwise backend SSOT `last_file`
    is used as fallback for compatibility.
    """
    history_store = get_history_store()

    project_path = history_store.get_active_project()
    current_file_obj = data.get("path") if isinstance(data, Mapping) else None
    if isinstance(current_file_obj, str) and current_file_obj.strip():
        current_file = current_file_obj
    else:
        current_file = history_store.get_last_file(project_path) if project_path else None
    if not current_file:
        raise HTTPException(status_code=400, detail="No file is currently open")

    path_obj = Path(current_file).expanduser().resolve(strict=False)
    if not path_obj.exists():
        raise HTTPException(status_code=404, detail="Active file does not exist")
    if path_obj.is_dir():
        raise HTTPException(status_code=400, detail="Active path is a directory")
    if project_path:
        try:
            path_obj.relative_to(Path(project_path).expanduser().resolve(strict=False))
        except ValueError:
            raise HTTPException(status_code=400, detail="Active file is outside the project")
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
            detail="Only Python, shell, JS/TS, and C/C++ source files can be executed",
        )

    mgr = await _get_terminal_manager()
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
    return {"ok": True, "data": await _destroy_terminal_shell_data(shell_id)}


@terminal_router.post('/terminal/{shell_id}/resize')
async def terminal_resize(shell_id: str, data: JsonObject = Body(...)):
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
    cols = _as_int(data.get('cols'), 80)
    rows = _as_int(data.get('rows'), 24)
    
    try:
        success = await _resize_editor_shell(shell_id, cols, rows)
        if success:
            return {"ok": True, "data": {"id": shell_id, "cols": cols, "rows": rows}}
        else:
            raise HTTPException(status_code=500, detail="Failed to resize terminal")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.get('/terminal/{shell_id}')
async def terminal_info(shell_id: str, logs: bool = Query(False), tail: int = Query(200), mgr: TerminalShellManager = Depends(get_manager_dep)):
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
async def terminal_history(shell_id: str, tail: int = Query(2000), mgr: TerminalShellManager = Depends(get_manager_dep)):
    """
    Return uncapped terminal stdout history as plain text.

    Unlike mgr.describe(... include_logs=True ...), this reads the shell stdout log
    directly so history preload is not constrained by FWS LOG_TAIL_BYTES.
    """
    del mgr
    return {"ok": True, "data": await _terminal_history_data(shell_id, tail)}


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
        mgr = await _get_terminal_manager()
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
                data = _json_object(cast(object, json.loads(msg)))
                if data.get('action') == 'destroy':
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
