from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Protocol, TextIO, cast, override

import socketio  # pyright: ignore[reportMissingTypeStubs] -- narrow third-party boundary below

from app.te2_console_log import (
    TE2_CONSOLE_LOG_DIR,
    TE2_CONSOLE_LOG_PATH,
    read_console_log_tail,
)

TE2_CONSOLE_NAMESPACE = "/te2_console"
TE2_CONSOLE_SOCKET_PATH = "/te2_console_ws/socket.io"
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

ConsolePayload = dict[str, object]


class ConsoleServer(Protocol):
    async def emit(self, event: str, data: object, *, namespace: str,
                   room: str) -> None: ...


class ConsoleNamespace(Protocol):
    async def emit(self, event: str, data: object, *, room: str | None = None,
                   to: str | None = None, skip_sid: str | None = None) -> None: ...
    async def enter_room(self, sid: str, room: str) -> None: ...
    async def leave_room(self, sid: str, room: str) -> None: ...
    async def save_session(self, sid: str, session: ConsolePayload) -> None: ...
    async def get_session(self, sid: str) -> object: ...


def console_payload(value: object) -> ConsolePayload | None:
    if not isinstance(value, dict):
        return None
    mapping = cast(dict[object, object], value)
    if not all(isinstance(key, str) for key in mapping):
        return None
    return cast(ConsolePayload, value)

_registered_workers: set[str] = set()
_pending_eval_results: dict[str, asyncio.Future[ConsolePayload]] = {}


class Te2ConsoleNamespace(socketio.AsyncNamespace):
    @override
    async def trigger_event(self, event: str, *args: object) -> object:
        normalized = event.replace(":", "_") if event else event
        handler = getattr(self, f"on_{normalized or ''}", None)
        if handler:
            return await cast(Awaitable[object], handler(*args))
        fallback = cast(Callable[..., Awaitable[object]], getattr(super(), 'trigger_event'))
        return await fallback(event, *args)

    async def on_connect(self, sid: str, environ: object) -> None:
        del environ
        print(f"[te2_console] connect sid={sid}", flush=True)

    async def on_disconnect(self, sid: str, reason: object = None) -> None:
        print(f"[te2_console] disconnect sid={sid} reason={reason}", flush=True)
        await on_console_disconnect(self, sid)

    async def on_console_register(self, sid: str, data: object) -> None:
        await on_console_register(self, sid, data)

    async def on_console_unregister(self, sid: str, data: object) -> None:
        await on_console_unregister(self, sid, data)

    async def on_console_log(self, sid: str, data: object) -> None:
        await on_console_log(self, sid, data)

    async def on_console_eval(self, sid: str, data: object) -> None:
        await on_console_eval(self, sid, data)

    async def on_console_evalResult(self, sid: str, data: object) -> None:
        await on_console_eval_result(self, sid, data)

    async def on_console_replay(self, sid: str, data: object) -> None:
        await on_console_replay(self, sid, data)

    async def on_console_clear(self, sid: str, data: object) -> None:
        await on_console_clear(self, sid, data)


TE2_CONSOLE_SIO = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    max_http_buffer_size=8 * 1024 * 1024,
)
cast(Callable[[object], None], getattr(TE2_CONSOLE_SIO, 'register_namespace'))(Te2ConsoleNamespace(TE2_CONSOLE_NAMESPACE))
TE2_CONSOLE_ASGI_APP = socketio.ASGIApp(TE2_CONSOLE_SIO, socketio_path="")


def _append_log(data: ConsolePayload) -> None:
    try:
        line = json.dumps(data, separators=(",", ":"), default=str)
        _ = _log_fh.write(line + "\n")
        _log_fh.flush()
    except Exception:
        pass


async def _broadcast_workers(ns: ConsoleNamespace) -> None:
    await ns.emit("console:workers", sorted(_registered_workers), room="console:drawers")


async def _replay_to_sid(ns: ConsoleNamespace, sid: str, max_lines: int | None = None) -> None:
    line_limit = _MAX_REPLAY_LINES if max_lines is None else max_lines
    tail = read_console_log_tail(
        TE2_CONSOLE_LOG_PATH,
        max_lines=line_limit,
        max_bytes=_REPLAY_MAX_BYTES,
    )
    if tail.truncated:
        await ns.emit(
            "console:replay_meta",
            {
                "truncated": True,
                "replay_max_bytes": _REPLAY_MAX_BYTES,
                "bytes_sent": tail.bytes_selected,
                "entries_sent": len(tail.lines),
            },
            to=sid,
        )

    for raw_line in tail.lines:
        try:
            entry = cast(object, json.loads(raw_line))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        await ns.emit("console:log", entry, to=sid)


def _normalize_tail_lines(value: object) -> int:
    try:
        if not isinstance(value, (str, int, float, bytes, bytearray)):
            return _DEFAULT_REPLAY_MAX_LINES
        parsed = int(value)
    except Exception:
        return _DEFAULT_REPLAY_MAX_LINES
    if parsed == 0:
        return 0
    if parsed < 0:
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
    await cast(ConsoleServer, TE2_CONSOLE_SIO).emit(
        "console:eval",
        payload,
        namespace=TE2_CONSOLE_NAMESPACE,
        room=f"console:{target}",
    )

    try:
        result = await asyncio.wait_for(future, timeout=timeout_seconds)
        if not isinstance(cast(object, result), dict):
            raise TypeError("console eval result was not a dict payload")
        return result
    except asyncio.TimeoutError:
        await cast(ConsoleServer, TE2_CONSOLE_SIO).emit(
            "console:evalCancel",
            {"reqId": req_id, "targetWorkerId": target},
            namespace=TE2_CONSOLE_NAMESPACE,
            room=f"console:{target}",
        )
        raise
    finally:
        _ = _pending_eval_results.pop(req_id, None)


async def on_console_register(ns: ConsoleNamespace, sid: str, data: object) -> None:
    payload = console_payload(data)
    if payload is None:
        return
    data = payload
    role = data.get("role", "worker")
    worker_id = str(data.get("workerId") or "").strip()

    if role == "drawer":
        await ns.enter_room(sid, "console:drawers")
        tail_lines = _normalize_tail_lines(data.get("tail_lines"))
        await ns.emit("console:workers", sorted(_registered_workers), to=sid)
        if tail_lines:
            await _replay_to_sid(ns, sid, max_lines=tail_lines)
        print(f"[te2_console] drawer registered sid={sid}", flush=True)
        return

    if worker_id:
        await ns.enter_room(sid, f"console:{worker_id}")
        await ns.save_session(sid, {"consoleWorkerId": worker_id})
        _registered_workers.add(worker_id)
        print(f"[te2_console] worker registered sid={sid} workerId={worker_id}", flush=True)
        await _broadcast_workers(ns)


async def on_console_unregister(ns: ConsoleNamespace, sid: str, data: object) -> None:
    del data
    try:
        await ns.leave_room(sid, "console:drawers")
    except Exception:
        return
    print(f"[te2_console] drawer unregistered sid={sid}", flush=True)


async def on_console_disconnect(ns: ConsoleNamespace, sid: str) -> None:
    try:
        session = console_payload(await ns.get_session(sid))
        worker_id = session.get("consoleWorkerId") if session else None
    except Exception:
        worker_id = None
    if isinstance(worker_id, str) and worker_id and worker_id in _registered_workers:
        _registered_workers.discard(worker_id)
        print(f"[te2_console] worker disconnected sid={sid} workerId={worker_id}", flush=True)
        await _broadcast_workers(ns)


async def on_console_log(ns: ConsoleNamespace, sid: str, data: object) -> None:
    payload = console_payload(data)
    if payload is None:
        return
    data = payload
    if not data.get("ts"):
        data = {**data, "ts": int(time.time() * 1000)}
    _append_log(data)
    await ns.emit("console:log", data, room="console:drawers", skip_sid=sid)


async def on_console_replay(ns: ConsoleNamespace, sid: str, data: object) -> None:
    del data
    await _replay_to_sid(ns, sid)


async def on_console_eval(ns: ConsoleNamespace, sid: str, data: object) -> None:
    payload = console_payload(data)
    if payload is None:
        return
    data = payload
    target = data.get("targetWorkerId")
    if not target:
        return
    await ns.emit("console:eval", data, room=f"console:{target}", skip_sid=sid)


async def on_console_eval_result(ns: ConsoleNamespace, sid: str, data: object) -> None:
    payload = console_payload(data)
    if payload is None:
        return
    data = payload
    req_id = data.get("reqId")
    future = _pending_eval_results.get(req_id) if isinstance(req_id, str) and req_id else None
    if future and not future.done():
        future.set_result(data)
    elif req_id:
        print(
            f"[te2_console] late eval result for reqId={req_id}, dropping",
            flush=True,
        )
    await ns.emit("console:evalResult", data, room="console:drawers", skip_sid=sid)


async def on_console_clear(ns: ConsoleNamespace, sid: str, data: object) -> None:
    del sid, data
    global _log_fh
    try:
        _log_fh.close()
        _ = TE2_CONSOLE_LOG_PATH.write_text("", encoding="utf-8")
        _log_fh = open(TE2_CONSOLE_LOG_PATH, "a", encoding="utf-8")
    except Exception:
        pass
    await ns.emit("console:clear", {}, room="console:drawers")
    await ns.emit("console:cleared", {}, room="console:drawers")
