from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import Awaitable
from pathlib import Path
from typing import Any, TextIO

import socketio

TE2_CONSOLE_NAMESPACE = "/te2_console"
TE2_CONSOLE_SOCKET_PATH = "/te2_console_ws/socket.io"
TE2_CONSOLE_LOG_DIR = Path.home() / ".cache" / "app_server"
TE2_CONSOLE_LOG_PATH = TE2_CONSOLE_LOG_DIR / "te2_console_log.jsonl"

_REPLAY_MAX_BYTES = 6 * 1024 * 1024
_DEFAULT_REPLAY_MAX_LINES = 500
_MAX_REPLAY_LINES = 5000

TE2_CONSOLE_LOG_DIR.mkdir(parents=True, exist_ok=True)
# Match the old worker-owned console session behavior: a framework restart
# starts a fresh transcript instead of replaying stale history forever.
if TE2_CONSOLE_LOG_PATH.exists():
    TE2_CONSOLE_LOG_PATH.unlink()
TE2_CONSOLE_LOG_PATH.touch()
_log_fh: TextIO = open(TE2_CONSOLE_LOG_PATH, "a", encoding="utf-8")

ConsolePayload = dict[str, Any]

_registered_workers: set[str] = set()
_pending_eval_results: dict[str, asyncio.Future[ConsolePayload]] = {}


class Te2ConsoleNamespace(socketio.AsyncNamespace):
    async def trigger_event(self, event, *args):
        normalized = event.replace(":", "_") if event else event
        handler = getattr(self, f"on_{normalized or ''}", None)
        if handler:
            return await handler(*args)
        return await super().trigger_event(event, *args)

    async def on_connect(self, sid, environ):
        print(f"[te2_console] connect sid={sid}", flush=True)

    async def on_disconnect(self, sid, reason=None):
        print(f"[te2_console] disconnect sid={sid} reason={reason}", flush=True)
        await on_console_disconnect(self, sid)

    async def on_console_register(self, sid, data):
        await on_console_register(self, sid, data)

    async def on_console_unregister(self, sid, data):
        await on_console_unregister(self, sid, data)

    async def on_console_log(self, sid, data):
        await on_console_log(self, sid, data)

    async def on_console_eval(self, sid, data):
        await on_console_eval(self, sid, data)

    async def on_console_evalResult(self, sid, data):
        await on_console_eval_result(self, sid, data)

    async def on_console_replay(self, sid, data):
        await on_console_replay(self, sid, data)

    async def on_console_clear(self, sid, data):
        await on_console_clear(self, sid, data)


TE2_CONSOLE_SIO = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    max_http_buffer_size=8 * 1024 * 1024,
)
TE2_CONSOLE_SIO.register_namespace(Te2ConsoleNamespace(TE2_CONSOLE_NAMESPACE))
TE2_CONSOLE_ASGI_APP = socketio.ASGIApp(TE2_CONSOLE_SIO, socketio_path="")


def _append_log(data: ConsolePayload) -> None:
    try:
        line = json.dumps(data, separators=(",", ":"), default=str)
        _ = _log_fh.write(line + "\n")
        _log_fh.flush()
    except Exception:
        pass


async def _broadcast_workers(ns) -> None:
    await ns.emit("console:workers", sorted(_registered_workers), room="console:drawers")


async def _replay_to_sid(ns, sid: str, max_lines: int | None = None) -> None:
    try:
        with TE2_CONSOLE_LOG_PATH.open("r", encoding="utf-8") as fh:
            lines = [line.strip() for line in fh if line.strip()]
    except FileNotFoundError:
        return

    total_lines = len(lines)
    if max_lines is not None and max_lines > 0 and total_lines > max_lines:
        lines = lines[-max_lines:]

    selected: list[str] = []
    selected_bytes = 0
    for line in reversed(lines):
        try:
            line_bytes = len(line.encode("utf-8"))
        except Exception:
            continue
        if line_bytes > _REPLAY_MAX_BYTES:
            continue
        if selected and (selected_bytes + line_bytes) > _REPLAY_MAX_BYTES:
            break
        selected.append(line)
        selected_bytes += line_bytes

    selected.reverse()
    truncated = len(selected) < total_lines
    if truncated:
        await ns.emit(
            "console:replay_meta",
            {
                "truncated": True,
                "replay_max_bytes": _REPLAY_MAX_BYTES,
                "bytes_sent": selected_bytes,
                "entries_sent": len(selected),
                "entries_dropped": max(0, total_lines - len(selected)),
            },
            to=sid,
        )

    for line in selected:
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        await ns.emit("console:log", entry, to=sid)


def _normalize_tail_lines(value) -> int:
    try:
        parsed = int(value)
    except Exception:
        return _DEFAULT_REPLAY_MAX_LINES
    if parsed <= 0:
        return _DEFAULT_REPLAY_MAX_LINES
    return min(parsed, _MAX_REPLAY_LINES)


def list_console_workers() -> list[str]:
    return sorted(_registered_workers)


async def request_console_eval(
    target_worker_id: str,
    code: str,
    *,
    timeout_seconds: float = 20.0,
) -> ConsolePayload:
    target = str(target_worker_id or "").strip()
    if not target:
        raise ValueError("target_worker_id is required")
    if target not in _registered_workers:
        raise LookupError(f"console worker not registered: {target}")

    req_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()
    future: asyncio.Future[ConsolePayload] = loop.create_future()
    _pending_eval_results[req_id] = future

    payload = {
        "targetWorkerId": target,
        "reqId": req_id,
        "code": str(code or ""),
        "timeoutSeconds": timeout_seconds,
    }
    await TE2_CONSOLE_SIO.emit(
        "console:eval",
        payload,
        namespace=TE2_CONSOLE_NAMESPACE,
        room=f"console:{target}",
    )

    try:
        result = await asyncio.wait_for(future, timeout=timeout_seconds)
        if not isinstance(result, dict):
            raise TypeError("console eval result was not a dict payload")
        return result
    except asyncio.TimeoutError:
        await TE2_CONSOLE_SIO.emit(
            "console:evalCancel",
            {"reqId": req_id, "targetWorkerId": target},
            namespace=TE2_CONSOLE_NAMESPACE,
            room=f"console:{target}",
        )
        raise
    finally:
        _ = _pending_eval_results.pop(req_id, None)


async def on_console_register(ns, sid, data):
    if not isinstance(data, dict):
        return
    role = data.get("role", "worker")
    worker_id = str(data.get("workerId") or "").strip()

    if role == "drawer":
        await ns.enter_room(sid, "console:drawers")
        tail_lines = _normalize_tail_lines(data.get("tail_lines"))
        await ns.emit("console:workers", sorted(_registered_workers), to=sid)
        await _replay_to_sid(ns, sid, max_lines=tail_lines)
        print(f"[te2_console] drawer registered sid={sid}", flush=True)
        return

    if worker_id:
        await ns.enter_room(sid, f"console:{worker_id}")
        await ns.save_session(sid, {"consoleWorkerId": worker_id})
        _registered_workers.add(worker_id)
        print(f"[te2_console] worker registered sid={sid} workerId={worker_id}", flush=True)
        await _broadcast_workers(ns)


async def on_console_unregister(ns, sid, data):
    try:
        await ns.leave_room(sid, "console:drawers")
    except Exception:
        return
    print(f"[te2_console] drawer unregistered sid={sid}", flush=True)


async def on_console_disconnect(ns, sid):
    try:
        session = await ns.get_session(sid)
        worker_id = session.get("consoleWorkerId") if session else None
    except Exception:
        worker_id = None
    if worker_id and worker_id in _registered_workers:
        _registered_workers.discard(worker_id)
        print(f"[te2_console] worker disconnected sid={sid} workerId={worker_id}", flush=True)
        await _broadcast_workers(ns)


async def on_console_log(ns, sid, data):
    if not isinstance(data, dict):
        return
    if not data.get("ts"):
        data = {**data, "ts": int(time.time() * 1000)}
    _append_log(data)
    await ns.emit("console:log", data, room="console:drawers", skip_sid=sid)


async def on_console_replay(ns, sid, data):
    await _replay_to_sid(ns, sid)


async def on_console_eval(ns, sid, data):
    if not isinstance(data, dict):
        return
    target = data.get("targetWorkerId")
    if not target:
        return
    await ns.emit("console:eval", data, room=f"console:{target}", skip_sid=sid)


async def on_console_eval_result(ns, sid, data):
    if not isinstance(data, dict):
        return
    req_id = data.get("reqId")
    future = _pending_eval_results.get(req_id) if req_id else None
    if future and not future.done():
        future.set_result(data)
    elif req_id:
        print(
            f"[te2_console] late eval result for reqId={req_id}, dropping",
            flush=True,
        )
    await ns.emit("console:evalResult", data, room="console:drawers", skip_sid=sid)


async def on_console_clear(ns, sid, data):
    global _log_fh
    try:
        _log_fh.close()
        TE2_CONSOLE_LOG_PATH.write_text("", encoding="utf-8")
        _log_fh = open(TE2_CONSOLE_LOG_PATH, "a", encoding="utf-8")
    except Exception:
        pass
    await ns.emit("console:clear", {}, room="console:drawers")
    await ns.emit("console:cleared", {}, room="console:drawers")
