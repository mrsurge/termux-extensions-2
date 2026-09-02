# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
import logging
import os
import time
from typing import Protocol, cast
import uuid

import socketio
from socketio.exceptions import ConnectionRefusedError as SocketIoConnectionRefusedError

from .terminal_stream_protocol import TERMINAL_STREAM_CODEC, pack_message, unpack_message


JsonObject = dict[str, object]
TERMINAL_LIFECYCLE_NAMESPACE = "/terminal"
TERMINAL_LIFECYCLE_REQUEST_EVENT = "terminal_request"
TERMINAL_LIFECYCLE_SNAPSHOT_EVENT = "terminal_snapshot"
FWS_NAMESPACE = "/fws"
FWS_SOCKET_PATH = "fws_ws/socket.io"
FWS_REQUEST_EVENT = "fws_request"
FWS_NOTIFICATION_EVENT = "fws_notification"
FWS_LIFECYCLE_METHODS = frozenset(
    {
        "fws.shell.created",
        "fws.shell.spawned",
        "fws.shell.updated",
        "fws.shell.exited",
        "fws.shell.removed",
    }
)
TERMINAL_LABEL_PREFIXES = ("terminal-stream", "terminal-testing-stream")

log = logging.getLogger("terminal_lifecycle")


class AsyncSocketIoClient(Protocol):
    connected: bool

    def on(
        self,
        event: str,
        handler: Callable[..., Awaitable[object | None]],
        *,
        namespace: str,
    ) -> object: ...

    def connect(
        self,
        url: str,
        *,
        namespaces: list[str],
        socketio_path: str,
        transports: list[str],
        wait: bool,
        wait_timeout: int,
        retry: bool,
    ) -> Awaitable[None]: ...

    def call(
        self,
        event: str,
        data: object,
        *,
        namespace: str,
        timeout: int,
    ) -> Awaitable[object]: ...


@dataclass(frozen=True, slots=True)
class TerminalLifecycleHandlers:
    create_shell: Callable[[JsonObject], Awaitable[JsonObject]]
    shell_action: Callable[[str, str], Awaitable[JsonObject]]
    remove_shell: Callable[[str], Awaitable[None]]
    get_sidebar_cwd: Callable[[], Awaitable[JsonObject]]
    publish_sidebar_state: Callable[[JsonObject], Awaitable[JsonObject]]


def _mapping(value: object) -> JsonObject | None:
    if not isinstance(value, Mapping):
        return None
    result: JsonObject = {}
    for key, item in cast(Mapping[object, object], value).items():
        if isinstance(key, str):
            result[key] = item
    return result


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _integer(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return int(value)


def is_terminal_shell_payload(payload: Mapping[str, object]) -> bool:
    label = _text(payload.get("label"))
    if not any(label.startswith(prefix) for prefix in TERMINAL_LABEL_PREFIXES):
        return False
    env = _mapping(payload.get("env_overrides")) or {}
    return (
        _text(env.get("TERMINAL_STREAM_PROTOCOL")) == TERMINAL_STREAM_CODEC
        or _text(payload.get("spec_id")) == "terminal-stream"
        or _text(payload.get("app_id")) == "terminal"
    )


def normalize_terminal_shell(
    payload: Mapping[str, object],
    *,
    now: float | None = None,
) -> JsonObject | None:
    shell_id = _text(payload.get("id"))
    if not shell_id:
        return None
    status = _text(payload.get("status")) or "unknown"
    pid = _integer(payload.get("pid"))
    created_at = _number(payload.get("created_at"))
    updated_at = _number(payload.get("updated_at"))
    alive = status == "running" and pid is not None and pid > 0
    timestamp = time.time() if now is None else now
    uptime = max(0.0, timestamp - created_at) if alive and created_at is not None else 0.0
    normalized: JsonObject = {
        "id": shell_id,
        "label": _text(payload.get("label")) or "terminal-stream",
        "status": status,
        "cwd": _text(payload.get("cwd")),
        "pid": pid,
        "exit_code": _integer(payload.get("exit_code")),
        "spec_id": _text(payload.get("spec_id")),
        "app_id": _text(payload.get("app_id")),
        "created_at": created_at,
        "updated_at": updated_at,
        "stats": {
            "alive": alive,
            "uptime": uptime,
        },
    }
    return normalized


class TerminalShellFactStore:
    def __init__(self, generation: str | None = None) -> None:
        self._lock: asyncio.Lock = asyncio.Lock()
        self._generation: str = generation or uuid.uuid4().hex
        self._revision: int = 0
        self._ready: bool = False
        self._shells: dict[str, JsonObject] = {}

    def _snapshot_locked(self) -> JsonObject:
        shells = sorted(
            (dict(shell) for shell in self._shells.values()),
            key=lambda shell: (
                _number(shell.get("created_at")) or 0.0,
                _text(shell.get("id")),
            ),
        )
        return {
            "type": "shells.snapshot",
            "generation": self._generation,
            "revision": self._revision,
            "ready": self._ready,
            "shells": shells,
        }

    async def snapshot(self) -> JsonObject:
        async with self._lock:
            return self._snapshot_locked()

    async def contains(self, shell_id: str) -> bool:
        async with self._lock:
            return shell_id in self._shells

    async def replace(self, shells: list[JsonObject]) -> tuple[JsonObject, bool]:
        next_shells = {
            shell_id: dict(shell)
            for shell in shells
            if (shell_id := _text(shell.get("id")))
        }
        async with self._lock:
            changed = not self._ready or next_shells != self._shells
            self._ready = True
            if changed:
                self._shells = next_shells
                self._revision += 1
            return self._snapshot_locked(), changed

    async def upsert(self, shell: JsonObject) -> tuple[JsonObject, bool]:
        shell_id = _text(shell.get("id"))
        async with self._lock:
            changed = bool(shell_id) and self._shells.get(shell_id) != shell
            if changed:
                self._shells[shell_id] = dict(shell)
                self._revision += 1
            return self._snapshot_locked(), changed

    async def remove(self, shell_id: str) -> tuple[JsonObject, bool]:
        async with self._lock:
            changed = shell_id in self._shells
            if changed:
                del self._shells[shell_id]
                self._revision += 1
            return self._snapshot_locked(), changed


_store = TerminalShellFactStore()
_handlers: TerminalLifecycleHandlers | None = None
_fws_client: AsyncSocketIoClient | None = None
_fws_connect_task: asyncio.Task[None] | None = None
_fws_snapshot_task: asyncio.Task[None] | None = None
_fws_snapshot_lock = asyncio.Lock()


async def _emit_snapshot(snapshot: JsonObject, *, sid: str | None = None) -> None:
    await TERMINAL_LIFECYCLE_SIO.emit(  # pyright: ignore[reportUnknownMemberType]
        TERMINAL_LIFECYCLE_SNAPSHOT_EVENT,
        pack_message(snapshot),
        namespace=TERMINAL_LIFECYCLE_NAMESPACE,
        to=sid,
    )


def _dashboard_shells(response: object) -> list[JsonObject]:
    envelope = _mapping(response)
    result = _mapping(envelope.get("result")) if envelope is not None else None
    state = _mapping(result.get("state")) if result is not None else None
    raw_shells = state.get("shells") if state is not None else None
    if not isinstance(raw_shells, list):
        raise ValueError("FWS dashboard snapshot did not contain a shell list")
    shells: list[JsonObject] = []
    now = time.time()
    for item in cast(list[object], raw_shells):
        raw = _mapping(item)
        if raw is None or not is_terminal_shell_payload(raw):
            continue
        normalized = normalize_terminal_shell(raw, now=now)
        if normalized is not None:
            shells.append(normalized)
    return shells


async def refresh_terminal_shell_snapshot() -> JsonObject:
    async with _fws_snapshot_lock:
        client = _fws_client
        if client is None or not client.connected:
            return await _store.snapshot()
        response = await client.call(
            FWS_REQUEST_EVENT,
            {
                "jsonrpc": "2.0",
                "id": f"terminal-snapshot-{time.monotonic_ns()}",
                "method": "fws.dashboard.open",
                "params": {"view": "html"},
            },
            namespace=FWS_NAMESPACE,
            timeout=10,
        )
        snapshot, changed = await _store.replace(_dashboard_shells(response))
    if changed:
        await _emit_snapshot(snapshot)
    return snapshot


async def _on_fws_connect() -> None:
    global _fws_snapshot_task
    if _fws_snapshot_task is not None and not _fws_snapshot_task.done():
        _ = _fws_snapshot_task.cancel()
    _fws_snapshot_task = asyncio.create_task(
        _refresh_after_fws_connect(),
        name="terminal-fws-snapshot",
    )


async def _refresh_after_fws_connect() -> None:
    await asyncio.sleep(0)
    try:
        _ = await refresh_terminal_shell_snapshot()
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.warning("[terminal] FWS snapshot failed: %s", exc)


async def apply_fws_notification(payload: object) -> JsonObject | None:
    notification = _mapping(payload)
    method = _text(notification.get("method")) if notification is not None else ""
    if method not in FWS_LIFECYCLE_METHODS:
        return None
    params = _mapping(notification.get("params")) if notification is not None else None
    if params is None:
        return None
    if method == "fws.shell.removed":
        shell_id = _text(params.get("shell_id"))
        if not shell_id:
            return None
        snapshot, changed = await _store.remove(shell_id)
    else:
        raw = _mapping(params.get("shell"))
        if raw is None:
            return None
        shell_id = _text(raw.get("id"))
        if not is_terminal_shell_payload(raw) and not await _store.contains(shell_id):
            return None
        normalized = normalize_terminal_shell(raw)
        if normalized is None:
            return None
        snapshot, changed = await _store.upsert(normalized)
    if changed:
        await _emit_snapshot(snapshot)
    return snapshot


async def _on_fws_notification(payload: object) -> None:
    try:
        _ = await apply_fws_notification(payload)
    except Exception:
        log.exception("[terminal] FWS lifecycle event failed")


async def _on_fws_connect_error(error: object) -> None:
    log.debug("[terminal] FWS lifecycle transport unavailable: %s", error)


async def _connect_fws(client: AsyncSocketIoClient) -> None:
    try:
        await client.connect(
            _framework_url(),
            namespaces=[FWS_NAMESPACE],
            socketio_path=FWS_SOCKET_PATH,
            transports=["websocket"],
            wait=True,
            wait_timeout=5,
            retry=True,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.warning("[terminal] FWS lifecycle bridge stopped: %s", exc)


def _framework_url() -> str:
    return (
        os.environ.get("FRAMEWORK_SHELLS_FWS_SOCKETIO_URL")
        or os.environ.get("TE_FRAMEWORK_URL")
        or "http://127.0.0.1:8089"
    ).rstrip("/")


def start_terminal_lifecycle() -> None:
    global _fws_client, _fws_connect_task
    if _fws_connect_task is not None and not _fws_connect_task.done():
        return
    client = cast(
        AsyncSocketIoClient,
        socketio.AsyncClient(
            reconnection=True,
            reconnection_attempts=0,
            reconnection_delay=1,
            reconnection_delay_max=5,
            logger=False,
        ),
    )
    _fws_client = client
    _ = client.on("connect", _on_fws_connect, namespace=FWS_NAMESPACE)
    _ = client.on(FWS_NOTIFICATION_EVENT, _on_fws_notification, namespace=FWS_NAMESPACE)
    _ = client.on("connect_error", _on_fws_connect_error, namespace=FWS_NAMESPACE)
    _fws_connect_task = asyncio.create_task(
        _connect_fws(client),
        name="terminal-fws-lifecycle",
    )


def configure_terminal_lifecycle(handlers: TerminalLifecycleHandlers) -> None:
    global _handlers
    _handlers = handlers


def _request_params(request: JsonObject) -> JsonObject:
    return _mapping(request.get("params")) or {}


def _response(request_id: str, result: object) -> bytes:
    return pack_message({"id": request_id, "ok": True, "result": result})


def _error_response(request_id: str, error: Exception) -> bytes:
    detail = getattr(error, "detail", None)
    message = str(detail if detail is not None else error)
    return pack_message({"id": request_id, "ok": False, "error": message})


async def _upsert_command_shell(shell: Mapping[str, object]) -> JsonObject:
    normalized = normalize_terminal_shell(shell)
    if normalized is None:
        raise RuntimeError("Terminal command returned no shell id")
    snapshot, changed = await _store.upsert(normalized)
    if changed:
        await _emit_snapshot(snapshot)
    return snapshot


class TerminalLifecycleNamespace(socketio.AsyncNamespace):
    async def on_connect(
        self,
        sid: str,
        _environ: object,
        auth: object | None = None,
    ) -> None:
        auth_payload = _mapping(auth)
        if auth_payload is None or _text(auth_payload.get("rpcCodec")) != TERMINAL_STREAM_CODEC:
            raise SocketIoConnectionRefusedError("unsupported_rpc_codec")
        await _emit_snapshot(await _store.snapshot(), sid=sid)

    async def on_terminal_request(self, _sid: str, payload: object) -> bytes:
        request_id = ""
        try:
            if not isinstance(payload, bytes | bytearray):
                raise ValueError("Terminal lifecycle requests require binary MessagePack")
            request = unpack_message(bytes(payload))
            request_id = _text(request.get("id"))
            method = _text(request.get("method"))
            if not request_id or not method:
                raise ValueError("Terminal lifecycle request requires id and method")
            params = _request_params(request)
            result = await self._dispatch(method, params)
            return _response(request_id, result)
        except Exception as exc:
            return _error_response(request_id, exc)

    async def _dispatch(self, method: str, params: JsonObject) -> object:
        handlers = _handlers
        if handlers is None:
            raise RuntimeError("Terminal lifecycle backend is not configured")

        if method == "shells.get":
            return {"snapshot": await _store.snapshot()}
        if method == "shells.resync":
            return {"snapshot": await refresh_terminal_shell_snapshot()}
        if method == "shell.create":
            shell = await handlers.create_shell(params)
            snapshot = await _upsert_command_shell(shell)
            return {"shell_id": _text(shell.get("id")), "snapshot": snapshot}
        if method == "shell.action":
            shell_id = _text(params.get("shell_id"))
            action = _text(params.get("action"))
            shell = await handlers.shell_action(shell_id, action)
            snapshot = await _upsert_command_shell(shell)
            return {"shell_id": shell_id, "snapshot": snapshot}
        if method == "shell.remove":
            shell_id = _text(params.get("shell_id"))
            await handlers.remove_shell(shell_id)
            snapshot, changed = await _store.remove(shell_id)
            if changed:
                await _emit_snapshot(snapshot)
            return {"shell_id": shell_id, "snapshot": snapshot}
        if method == "sidebar.cwd.get":
            return await handlers.get_sidebar_cwd()
        if method == "sidebar.state.publish":
            return await handlers.publish_sidebar_state(params)
        raise ValueError(f"Unsupported terminal lifecycle method '{method}'")


TERMINAL_LIFECYCLE_SIO = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    max_http_buffer_size=1024 * 1024,
    transports=["websocket"],
    allow_upgrades=False,
)
TERMINAL_LIFECYCLE_SIO.register_namespace(  # pyright: ignore[reportUnknownMemberType]
    TerminalLifecycleNamespace(TERMINAL_LIFECYCLE_NAMESPACE)
)
TERMINAL_LIFECYCLE_ASGI_APP = socketio.ASGIApp(
    TERMINAL_LIFECYCLE_SIO,
    socketio_path="",
)


__all__ = [
    "TERMINAL_LIFECYCLE_ASGI_APP",
    "TerminalLifecycleHandlers",
    "TerminalShellFactStore",
    "apply_fws_notification",
    "configure_terminal_lifecycle",
    "is_terminal_shell_payload",
    "normalize_terminal_shell",
    "refresh_terminal_shell_snapshot",
    "start_terminal_lifecycle",
]
