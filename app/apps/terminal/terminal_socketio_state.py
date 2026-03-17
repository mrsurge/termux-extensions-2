from __future__ import annotations

import asyncio
import time
from typing import Any

import socketio

from framework_shells import get_manager as _manager

_TERMINAL_SIO: socketio.AsyncServer | None = None
_terminal_sid_shells: dict[str, str] = {}
_terminal_sid_lock = asyncio.Lock()
_terminal_stream_tasks: dict[str, asyncio.Task[Any]] = {}
_terminal_stream_refcounts: dict[str, int] = {}
_terminal_stream_lock = asyncio.Lock()


async def mgr():
    return await _manager()


def attach_terminal_socketio_server(server: socketio.AsyncServer) -> None:
    global _TERMINAL_SIO
    _TERMINAL_SIO = server


def _terminal_shell_room(shell_id: str) -> str:
    return f"terminal:shell:{str(shell_id or '').strip() or 'unknown'}"


async def _emit_terminal_to_sid(event: str, payload: dict, sid: str) -> None:
    if not _TERMINAL_SIO or not sid:
        return
    await _TERMINAL_SIO.emit(event, payload, namespace="/terminal", to=sid)


async def _emit_terminal_to_shell(event: str, payload: dict, shell_id: str) -> None:
    if not _TERMINAL_SIO or not shell_id:
        return
    await _TERMINAL_SIO.emit(event, payload, namespace="/terminal", room=_terminal_shell_room(shell_id))


async def _resolve_shell_for_socket(shell_id: str):
    shell_id = str(shell_id or "").strip()
    if not shell_id:
        raise RuntimeError("Missing shell id")
    m = await mgr()
    rec = await m.get_shell(shell_id)
    if not rec:
        raise RuntimeError("Shell not found")
    return m, rec


async def _forward_terminal_stream(shell_id: str, output_queue) -> None:
    m = await mgr()
    last_status_check = 0.0
    exit_notified = False
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
                    rec = await m.get_shell(shell_id)
                except Exception:
                    rec = None
                live = bool(rec and rec.status == "running" and rec.pid)
                if live:
                    continue
                status = (rec.status if rec else "missing") or "missing"
                payload = {
                    "shell_id": shell_id,
                    "status": status,
                    "exit_code": rec.exit_code if rec else None,
                    "ts": int(time.time() * 1000),
                }
                exit_notified = True
                await _emit_terminal_to_shell("terminal:closed", payload, shell_id)
                return
            await _emit_terminal_to_shell(
                "terminal:output",
                {"shell_id": shell_id, "data": chunk},
                shell_id,
            )
    finally:
        try:
            await m.unsubscribe_output(shell_id, output_queue)
        except Exception:
            pass
        async with _terminal_stream_lock:
            _terminal_stream_tasks.pop(shell_id, None)
            _terminal_stream_refcounts.pop(shell_id, None)


async def _ensure_terminal_stream(shell_id: str) -> None:
    m = await mgr()
    async with _terminal_stream_lock:
        refs = _terminal_stream_refcounts.get(shell_id, 0) + 1
        _terminal_stream_refcounts[shell_id] = refs
        if shell_id in _terminal_stream_tasks:
            return
        output_queue = await m.subscribe_output(shell_id)
        _terminal_stream_tasks[shell_id] = asyncio.create_task(
            _forward_terminal_stream(shell_id, output_queue),
            name=f"terminal-app-stream-{shell_id}",
        )


async def _release_terminal_stream(shell_id: str | None) -> None:
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


async def _bind_terminal_sid(ns: socketio.AsyncNamespace, sid: str, shell_id: str) -> bool:
    shell_id = str(shell_id or "").strip()
    if not shell_id:
        raise RuntimeError("Missing shell id")
    async with _terminal_sid_lock:
        old_shell_id = _terminal_sid_shells.get(sid)
    same_shell = bool(old_shell_id and old_shell_id == shell_id)
    if old_shell_id and old_shell_id != shell_id:
        try:
            await ns.leave_room(sid, _terminal_shell_room(old_shell_id))
        except Exception:
            pass
        await _release_terminal_stream(old_shell_id)
    if not same_shell:
        await ns.enter_room(sid, _terminal_shell_room(shell_id))
        await _ensure_terminal_stream(shell_id)
    async with _terminal_sid_lock:
        _terminal_sid_shells[sid] = shell_id
    return same_shell


async def _resolve_shell_for_event(ns: socketio.AsyncNamespace, sid: str, payload: dict[str, Any]) -> str | None:
    requested_shell_id = str(payload.get("shell_id") or payload.get("shellId") or "").strip()
    if requested_shell_id:
        _m, rec = await _resolve_shell_for_socket(requested_shell_id)
        await _bind_terminal_sid(ns, sid, rec.id)
        return rec.id
    async with _terminal_sid_lock:
        return _terminal_sid_shells.get(sid)


class TerminalSocketIONamespace(socketio.AsyncNamespace):
    async def trigger_event(self, event, *args):
        normalized = event.replace(":", "_") if event else event
        handler = getattr(self, "on_" + (normalized or ""), None)
        if handler:
            return await handler(*args)
        return await super().trigger_event(event, *args)

    async def on_connect(self, sid, environ):
        print(f"[terminal_app_ws] connect sid={sid}", flush=True)

    async def on_disconnect(self, sid, reason=None):
        print(f"[terminal_app_ws] disconnect sid={sid} reason={reason}", flush=True)
        async with _terminal_sid_lock:
            shell_id = _terminal_sid_shells.pop(sid, None)
        if shell_id:
            try:
                await self.leave_room(sid, _terminal_shell_room(shell_id))
            except Exception:
                pass
            await _release_terminal_stream(shell_id)

    async def on_terminal_register(self, sid, data):
        payload = data if isinstance(data, dict) else {}
        requested_shell_id = str(payload.get("shellId") or payload.get("shell_id") or "").strip()
        try:
            _m, rec = await _resolve_shell_for_socket(requested_shell_id)
        except Exception as exc:
            await self.emit("terminal:error", {"message": str(exc), "shell_id": requested_shell_id}, to=sid)
            return

        await _bind_terminal_sid(self, sid, rec.id)
        await self.emit("terminal:shell_id", {"shell_id": rec.id, "ts": int(time.time() * 1000)}, to=sid)

    async def on_terminal_input(self, sid, data):
        payload = data if isinstance(data, dict) else {}
        text = payload.get("data")
        if text is None:
            return
        try:
            shell_id = await _resolve_shell_for_event(self, sid, payload)
        except Exception as exc:
            await self.emit("terminal:error", {"message": str(exc)}, to=sid)
            return
        if not shell_id:
            await self.emit("terminal:error", {"message": "No shell bound to this client or payload"}, to=sid)
            return
        try:
            m = await mgr()
            await m.write_to_pty(shell_id, str(text))
        except Exception as exc:
            await self.emit("terminal:error", {"message": str(exc), "shell_id": shell_id}, to=sid)

    async def on_terminal_resize(self, sid, data):
        payload = data if isinstance(data, dict) else {}
        cols = int(payload.get("cols") or 80)
        rows = int(payload.get("rows") or 24)
        try:
            shell_id = await _resolve_shell_for_event(self, sid, payload)
        except Exception as exc:
            await self.emit("terminal:error", {"message": str(exc)}, to=sid)
            return
        if not shell_id:
            return
        try:
            m = await mgr()
            await m.resize_pty(shell_id, cols, rows)
        except Exception as exc:
            await self.emit("terminal:error", {"message": str(exc), "shell_id": shell_id}, to=sid)
