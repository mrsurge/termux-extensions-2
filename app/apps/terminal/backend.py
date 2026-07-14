import asyncio
from collections import deque
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
import json
import logging
import os
from pathlib import Path
import re
import shlex
import shutil
import time
from typing import ClassVar, Literal, Protocol, TypeAlias, cast
from urllib import request as urllib_request
from urllib.parse import quote, urlencode
import uuid

import socketio
from fastapi import APIRouter, Body, HTTPException, WebSocket
from pydantic import BaseModel, ConfigDict
from starlette.websockets import WebSocketDisconnect

from framework_shells import get_manager as _manager  # pyright: ignore[reportMissingImports,reportUnknownVariableType]
from framework_shells.orchestrator import Orchestrator  # pyright: ignore[reportMissingImports,reportUnknownVariableType]

from .terminal_stream_protocol import (
    TERMINAL_STREAM_CODEC,
    PipeFrameDecoder,
    encode_pipe_message,
    pack_message,
    unpack_message,
)

APP_ID = str(os.environ.get("TE_APP_ID") or "terminal").strip() or "terminal"
APP_BASE_URL = "/app/terminal"
SIDEBAR_TOKEN_ID = "terminal"
SIDEBAR_IPC_NAMESPACE = "/sidebar_ipc"
SIDEBAR_IPC_SOCKET_PATH = "/ui_ipc_ws/socket.io"
SIDEBAR_IPC_RPC_EVENT = "rpc"
SHELLSPEC_DIR = Path(__file__).resolve().parent / "shellspec"
SHELLSPEC_REF = "node_terminal_stream.yaml#terminal-stream"
BROKER_ENTRY = Path(__file__).resolve().parent / "terminal_stream_broker.mjs"
LABEL_PREFIX = "terminal-stream"
LEGACY_LABEL_PREFIXES = ("terminal-testing-stream",)
MAX_CATCHUP_FRAMES = 4096
DEFAULT_COLS = 80
DEFAULT_ROWS = 24
DEFAULT_SCROLLBACK = 5000

terminal_bp = APIRouter()
log = logging.getLogger("terminal_backend")


def _framework_url() -> str:
    explicit = str(os.environ.get("TE_FRAMEWORK_URL") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    port = str(os.environ.get("TE_PORT") or "8089").strip() or "8089"
    return f"http://127.0.0.1:{port}"


def _post_serving_readiness() -> None:
    body = {
        "app_id": APP_ID,
        "status": "ready",
        "phase": "serving",
        "source": "terminal_backend",
    }
    endpoint = f"{_framework_url()}/api/apps/{quote(APP_ID, safe='')}/readiness"
    req = urllib_request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib_request.urlopen(req, timeout=5) as resp:
        resp.read()


async def te2_app_backend_serving() -> None:
    try:
        await asyncio.to_thread(_post_serving_readiness)
    except Exception as exc:
        print(f"[terminal] readiness post failed: {exc}", flush=True)


def _sidebar_backend_client_id() -> str:
    return f"{APP_ID}:backend:{os.getpid()}"


async def _call_sidebar_rpc(
    method: str,
    params: dict[str, object] | None = None,
    *,
    timeout: float = 5.0,
) -> dict[str, object]:
    safe_method = str(method or "").strip()
    if not safe_method:
        raise ValueError("method is required")
    client = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
    timeout_seconds = max(1, int(timeout))
    try:
        await client.connect(
            _framework_url(),
            namespaces=[SIDEBAR_IPC_NAMESPACE],
            socketio_path=SIDEBAR_IPC_SOCKET_PATH.lstrip("/"),
            transports=["websocket", "polling"],
        )
        register = {
            "jsonrpc": "2.0",
            "id": f"{APP_ID}:register:{int(asyncio.get_running_loop().time() * 1000)}",
            "method": "sidebar.register",
            "params": {
                "role": "iframe",
                "app": APP_ID,
                "client_id": _sidebar_backend_client_id(),
                "capabilities": ["sidebar.windows", "sidebar.cwd"],
            },
        }
        await client.call(SIDEBAR_IPC_RPC_EVENT, register, namespace=SIDEBAR_IPC_NAMESPACE, timeout=timeout_seconds)
        request = {
            "jsonrpc": "2.0",
            "id": f"{APP_ID}:{int(asyncio.get_running_loop().time() * 1000)}",
            "method": safe_method,
            "params": params or {},
        }
        response = await client.call(
            SIDEBAR_IPC_RPC_EVENT,
            request,
            namespace=SIDEBAR_IPC_NAMESPACE,
            timeout=timeout_seconds,
        )
        if not isinstance(response, dict):
            raise RuntimeError("sidebar RPC returned a non-object response")
        error = response.get("error")
        if isinstance(error, dict):
            raise RuntimeError(str(error.get("message") or error))
        result = response.get("result")
        return result if isinstance(result, dict) else {"result": result}
    finally:
        with suppress(Exception):
            await client.disconnect()


JsonObject = dict[str, object]
TerminalConnectionState: TypeAlias = Literal["catching_up", "live"]


class ShellRecordProtocol(Protocol):
    id: str
    label: str | None
    pid: int | None
    status: str | None
    exit_code: int | None
    stdout_log: str
    env_overrides: dict[str, str]


class OutputSubscriptionProtocol(Protocol):
    async def get(self) -> bytes | bytearray | None: ...


class PipeStdinProtocol(Protocol):
    def is_closing(self) -> bool: ...
    def write(self, data: bytes) -> None: ...
    async def drain(self) -> None: ...


class PipeProcessProtocol(Protocol):
    stdin: PipeStdinProtocol | None


class PipeStateProtocol(Protocol):
    process: PipeProcessProtocol
    stdin_supported: bool


class ManagerProtocol(Protocol):
    async def list_shells(self) -> list[ShellRecordProtocol]: ...
    async def get_shell(self, shell_id: str) -> ShellRecordProtocol | None: ...
    async def get_shell_capabilities(self, record: ShellRecordProtocol) -> Mapping[str, object]: ...
    async def describe(
        self,
        record: ShellRecordProtocol,
        include_logs: bool = False,
        tail_lines: int = 0,
    ) -> JsonObject: ...
    async def subscribe_output_bytes(self, shell_id: str) -> OutputSubscriptionProtocol: ...
    async def unsubscribe_output_bytes(
        self,
        shell_id: str,
        queue: OutputSubscriptionProtocol,
    ) -> None: ...
    def get_pipe_state(self, shell_id: str) -> PipeStateProtocol | None: ...
    async def terminate_shell(self, shell_id: str, force: bool = False) -> ShellRecordProtocol: ...
    async def restart_shell(self, shell_id: str) -> ShellRecordProtocol: ...
    async def remove_shell(self, shell_id: str, force: bool = False) -> None: ...


class OrchestratorProtocol(Protocol):
    async def start_from_ref(
        self,
        ref: str,
        *,
        base_dir: Path | None = None,
        ctx: Mapping[str, object] | None = None,
        label: str | None = None,
        record_spec_id: str | None = None,
        ui: dict[str, object] | None = None,
        env_overrides: dict[str, str] | None = None,
        subgroups_overrides: list[str] | None = None,
        parent_shell_id: str | None = None,
        wait_ready: bool = True,
    ) -> ShellRecordProtocol: ...


ManagerFactory = Callable[[], Awaitable[ManagerProtocol]]
OrchestratorCtor = Callable[[ManagerProtocol], OrchestratorProtocol]
manager_factory = cast(ManagerFactory, _manager)
orchestrator_ctor = cast(OrchestratorCtor, Orchestrator)


class CreateShellRequest(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore")

    shell: str | list[str] | None = None
    cwd: str = "~"
    cols: int = DEFAULT_COLS
    rows: int = DEFAULT_ROWS


class ShellInputRequest(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore")

    data: str
    newline: bool = True


class ShellResizeRequest(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore")

    cols: int = DEFAULT_COLS
    rows: int = DEFAULT_ROWS


class ShellActionRequest(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore")

    action: str


@dataclass(slots=True)
class TerminalConnection:
    queue: asyncio.Queue[JsonObject | None]
    state: TerminalConnectionState = "catching_up"
    attach_request_id: str = ""
    buffered_frames: deque[JsonObject] = field(default_factory=deque)


@dataclass(slots=True)
class TerminalSession:
    shell_id: str
    output_subscription: OutputSubscriptionProtocol
    connections: dict[str, TerminalConnection] = field(default_factory=dict)
    pending_attach: dict[str, str] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    reader_task: asyncio.Task[None] | None = None
    last_sequence: int = 0
    exit_payload: JsonObject | None = None


_sessions: dict[str, TerminalSession] = {}
_sessions_lock = asyncio.Lock()


async def mgr() -> ManagerProtocol:
    return await manager_factory()


def _ok(data: object) -> JsonObject:
    return {"ok": True, "data": data}


def _coerce_positive_int(raw: object, fallback: int) -> int:
    if isinstance(raw, bool):
        return fallback
    if isinstance(raw, int):
        return raw if raw > 0 else fallback
    if isinstance(raw, str) and raw.strip().isdigit():
        parsed = int(raw)
        return parsed if parsed > 0 else fallback
    return fallback


def _coerce_non_negative_int(raw: object, fallback: int = 0) -> int:
    if isinstance(raw, bool):
        return fallback
    if isinstance(raw, int):
        return raw if raw >= 0 else fallback
    if isinstance(raw, str) and raw.strip().isdigit():
        parsed = int(raw)
        return parsed if parsed >= 0 else fallback
    return fallback


def _coerce_string(raw: object) -> str:
    if isinstance(raw, str):
        return raw
    return ""


def _coerce_optional_string(raw: object) -> str | None:
    value = _coerce_string(raw).strip()
    return value or None


def _coerce_optional_int(raw: object) -> int | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("-"):
            body = text[1:]
            if body.isdigit():
                return int(text)
        elif text.isdigit():
            return int(text)
    return None


def _coerce_optional_bool(raw: object) -> bool | None:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, int) and raw in {0, 1}:
        return bool(raw)
    if isinstance(raw, str):
        value = raw.strip().lower()
        if value in {"1", "true", "yes", "on"}:
            return True
        if value in {"0", "false", "no", "off"}:
            return False
    return None


def _coerce_json_object(raw: object) -> JsonObject | None:
    if not isinstance(raw, Mapping):
        return None
    payload: JsonObject = {}
    for key, value in raw.items():
        if isinstance(key, str):
            payload[key] = value
    return payload


def _coerce_bytes(raw: object) -> bytes | None:
    if isinstance(raw, bytes):
        return raw
    if isinstance(raw, (bytearray, memoryview)):
        return bytes(raw)
    return None


def _error_frame(code: str, message: str, *, fatal: bool) -> JsonObject:
    return {
        "type": "error",
        "code": code,
        "message": message,
        "fatal": fatal,
    }


def _worker_message(raw: object) -> JsonObject | None:
    message = _coerce_json_object(raw)
    if message is None:
        return None
    message_type = _coerce_string(message.get("type"))
    if message_type == "output":
        sequence = _coerce_non_negative_int(message.get("sequence"), -1)
        data = _coerce_bytes(message.get("data"))
        if sequence < 0 or data is None:
            return None
        return {"type": "output", "sequence": sequence, "data": data}
    if message_type == "checkpoint":
        request_id = _coerce_optional_string(message.get("request_id"))
        state = _coerce_bytes(message.get("state"))
        sequence = _coerce_non_negative_int(message.get("sequence"), -1)
        if request_id is None or state is None or sequence < 0:
            return None
        return {
            "type": "checkpoint",
            "request_id": request_id,
            "sequence": sequence,
            "cols": _coerce_positive_int(message.get("cols"), DEFAULT_COLS),
            "rows": _coerce_positive_int(message.get("rows"), DEFAULT_ROWS),
            "scrollback": _coerce_positive_int(message.get("scrollback"), DEFAULT_SCROLLBACK),
            "state": state,
        }
    if message_type == "exit":
        sequence = _coerce_non_negative_int(message.get("sequence"), -1)
        if sequence < 0:
            return None
        return {
            "type": "exit",
            "sequence": sequence,
            "exit_code": _coerce_optional_int(message.get("exit_code")),
            "reason": _coerce_optional_string(message.get("reason")) or "exited",
        }
    if message_type == "pong":
        return {"type": "pong", "request_id": _coerce_string(message.get("request_id"))}
    if message_type == "error":
        return {
            "type": "error",
            "code": _coerce_optional_string(message.get("code")) or "worker_error",
            "message": _coerce_optional_string(message.get("message")) or "Terminal worker error",
            "fatal": bool(message.get("fatal")),
        }
    if message_type == "ready":
        protocol = _coerce_optional_string(message.get("protocol"))
        if protocol != TERMINAL_STREAM_CODEC:
            return None
        return {"type": "ready", "protocol": protocol}
    return None


def _default_shell_command() -> list[str]:
    shell_env = os.environ.get("SHELL") or ""
    if os.path.basename(shell_env).endswith("bash") or shutil.which("bash"):
        return ["bash", "-l", "-i"]
    return ["sh", "-i"]


def _coerce_shell_command(raw: str | Sequence[str] | None) -> list[str]:
    if isinstance(raw, str):
        parts = shlex.split(raw)
        return parts or _default_shell_command()
    if isinstance(raw, Sequence):
        parts = [str(part) for part in raw if str(part).strip()]
        return parts or _default_shell_command()
    return _default_shell_command()


def _normalize_cwd(raw: str | None) -> str:
    value = (raw or "~").strip() or "~"
    expanded = os.path.expandvars(os.path.expanduser(value))
    return os.path.abspath(expanded)


def _is_supported_terminal_record(record: ShellRecordProtocol) -> bool:
    label = record.label or ""
    has_terminal_label = any(
        label.startswith(prefix)
        for prefix in (LABEL_PREFIX, *LEGACY_LABEL_PREFIXES)
    )
    return has_terminal_label and (
        record.env_overrides.get("TERMINAL_STREAM_PROTOCOL") == TERMINAL_STREAM_CODEC
    )


def _canonical_sidebar_url(
    host_id: str,
    token_id: str,
    *,
    shell_id: str = "",
    cwd: str = "",
    console_worker_id: str = "",
) -> str:
    query: dict[str, str] = {
        "embed": "1",
        "te2_host_id": host_id,
    }
    if token_id:
        query["te2_token_id"] = token_id
    if console_worker_id:
        query["te2_console_worker_id"] = console_worker_id
    if shell_id:
        query["shell_id"] = shell_id
    if cwd:
        query["cwd"] = cwd
    return f"{APP_BASE_URL}?{urlencode(query)}"


async def _shell_record_cwd(record: ShellRecordProtocol) -> str:
    manager = await mgr()
    try:
        payload = await manager.describe(record)
    except Exception:
        payload = {}
    cwd = _coerce_optional_string(payload.get("cwd"))
    return _normalize_cwd(cwd) if cwd else ""


async def _next_terminal_sequence(manager: ManagerProtocol) -> int:
    max_seq = 0
    try:
        records = await manager.list_shells()
    except Exception:
        records = []
    for rec in records:
        label = rec.label or ""
        for prefix in (LABEL_PREFIX, *LEGACY_LABEL_PREFIXES):
            if label == prefix:
                max_seq = max(max_seq, 1)
                break
            match = re.match(rf"^{re.escape(prefix)}:(\d+)$", label)
            if match:
                max_seq = max(max_seq, int(match.group(1)))
                break
    return max_seq + 1


async def _get_alive(shell_id: str) -> ShellRecordProtocol | None:
    manager = await mgr()
    record = await manager.get_shell(shell_id)
    if record and _is_supported_terminal_record(record) and record.pid and record.status == "running":
        return record
    return None


async def _ensure_live_broker_io(shell_id: str) -> bool:
    record = await _get_alive(shell_id)
    if record is None:
        return False

    manager = await mgr()
    try:
        caps = await manager.get_shell_capabilities(record)
    except Exception as exc:
        log.warning("[terminal] capability check failed shell=%s: %s", shell_id, exc)
        return False

    backend = _coerce_string(caps.get("backend"))
    stdin_write = bool(caps.get("stdin_write"))
    stdout_subscribe = bool(caps.get("stdout_subscribe_bytes"))
    if backend != "pipe" or not stdin_write or not stdout_subscribe:
        log.warning("[terminal] shell=%s lacks live pipe capabilities: %s", shell_id, caps)
        return False

    return True


async def _create_shell_record(payload: CreateShellRequest | None = None) -> JsonObject:
    request = payload or CreateShellRequest()
    shell_cmd = _coerce_shell_command(request.shell)
    cwd = _normalize_cwd(request.cwd)
    cols = max(1, request.cols)
    rows = max(1, request.rows)

    manager = await mgr()
    orch = orchestrator_ctor(manager)
    label = f"{LABEL_PREFIX}:{await _next_terminal_sequence(manager)}"
    try:
        record = await orch.start_from_ref(
            SHELLSPEC_REF,
            base_dir=SHELLSPEC_DIR,
            ctx={
                "APP_ID": APP_ID,
                "BROKER_ENTRY": str(BROKER_ENTRY),
                "CWD": cwd,
                "COLS": str(cols),
                "ROWS": str(rows),
                "SCROLLBACK": str(DEFAULT_SCROLLBACK),
                "SHELL_CMD_JSON": json.dumps(shell_cmd),
            },
            label=label,
            wait_ready=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start shell: {exc}") from exc

    return await manager.describe(record)


async def _drop_connection(session: TerminalSession, conn_id: str) -> None:
    connection: TerminalConnection | None = None
    async with session.lock:
        connection = session.connections.pop(conn_id, None)
        if connection is not None and connection.attach_request_id:
            session.pending_attach.pop(connection.attach_request_id, None)
    if connection is not None:
        with suppress(asyncio.QueueFull):
            connection.queue.put_nowait(None)


async def _sender_loop(
    websocket: WebSocket,
    queue: asyncio.Queue[JsonObject | None],
) -> None:
    while True:
        payload = await queue.get()
        if payload is None:
            break
        await websocket.send_bytes(pack_message(payload))


async def _broadcast_live(session: TerminalSession, payload: JsonObject) -> None:
    async with session.lock:
        stale: list[str] = []
        for conn_id, connection in session.connections.items():
            if connection.state == "live":
                connection.queue.put_nowait(dict(payload))
                continue
            connection.buffered_frames.append(dict(payload))
            if len(connection.buffered_frames) > MAX_CATCHUP_FRAMES:
                connection.queue.put_nowait(
                    _error_frame(
                        "catchup_overflow",
                        "Terminal output exceeded the reconnect catch-up limit",
                        fatal=True,
                    )
                )
                connection.queue.put_nowait(None)
                stale.append(conn_id)
        for conn_id in stale:
            connection = session.connections.pop(conn_id, None)
            if connection is not None and connection.attach_request_id:
                session.pending_attach.pop(connection.attach_request_id, None)


async def _route_checkpoint(session: TerminalSession, payload: JsonObject) -> None:
    request_id = _coerce_string(payload.get("request_id"))
    checkpoint_sequence = _coerce_non_negative_int(payload.get("sequence"), 0)
    async with session.lock:
        conn_id = session.pending_attach.pop(request_id, None)
        connection = session.connections.get(conn_id) if conn_id else None
        if connection is None:
            return
        checkpoint = dict(payload)
        checkpoint["shell_id"] = session.shell_id
        connection.queue.put_nowait(checkpoint)
        while connection.buffered_frames:
            buffered = connection.buffered_frames.popleft()
            if _coerce_string(buffered.get("type")) == "output":
                sequence = _coerce_non_negative_int(buffered.get("sequence"), 0)
                if sequence <= checkpoint_sequence:
                    continue
            connection.queue.put_nowait(buffered)
        connection.state = "live"


async def _handle_worker_message(session: TerminalSession, payload: JsonObject) -> None:
    message_type = _coerce_string(payload.get("type"))
    if message_type == "ready":
        return
    if message_type == "checkpoint":
        await _route_checkpoint(session, payload)
        return
    if message_type in {"output", "exit"}:
        sequence = _coerce_non_negative_int(payload.get("sequence"), 0)
        async with session.lock:
            session.last_sequence = max(session.last_sequence, sequence)
            if message_type == "exit":
                session.exit_payload = dict(payload)
        await _broadcast_live(session, payload)
        return
    if message_type in {"pong", "error"}:
        await _broadcast_live(session, payload)


async def _session_output_loop(
    session: TerminalSession,
    manager: ManagerProtocol,
) -> None:
    decoder = PipeFrameDecoder()
    last_status_check = 0.0
    try:
        while not session.stop.is_set():
            try:
                chunk = await asyncio.wait_for(session.output_subscription.get(), timeout=0.5)
            except asyncio.TimeoutError:
                now = asyncio.get_running_loop().time()
                if now - last_status_check < 2.0:
                    continue
                last_status_check = now
                rec = await manager.get_shell(session.shell_id)
                live = bool(rec and rec.status == "running" and rec.pid)
                if live:
                    continue
                break

            if chunk is None:
                break
            if not chunk:
                continue
            for decoded in decoder.push(chunk):
                message = _worker_message(decoded)
                if message is None:
                    log.warning("[terminal] ignored malformed worker message shell=%s", session.shell_id)
                    continue
                await _handle_worker_message(session, message)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.exception("[terminal] broker stdout reader crashed shell=%s", session.shell_id)
        await _broadcast_live(
            session,
            _error_frame("broker_stream_failed", str(exc), fatal=False),
        )
    finally:
        if not session.stop.is_set() and session.exit_payload is None:
            with suppress(Exception):
                record = await manager.get_shell(session.shell_id)
                async with session.lock:
                    session.last_sequence += 1
                    exit_payload: JsonObject = {
                        "type": "exit",
                        "sequence": session.last_sequence,
                        "exit_code": record.exit_code if record else None,
                        "reason": (record.status if record and record.status else "missing"),
                    }
                    session.exit_payload = dict(exit_payload)
                await _broadcast_live(session, exit_payload)
        with suppress(Exception):
            await manager.unsubscribe_output_bytes(session.shell_id, session.output_subscription)


async def _get_or_create_session(shell_id: str) -> TerminalSession:
    if not await _ensure_live_broker_io(shell_id):
        raise RuntimeError("Shell is not running with live terminal pipe support")

    async with _sessions_lock:
        existing = _sessions.get(shell_id)
        if existing is not None and existing.exit_payload is None:
            return existing

        manager = await mgr()
        output_subscription = await manager.subscribe_output_bytes(shell_id)
        session = TerminalSession(
            shell_id=shell_id,
            output_subscription=output_subscription,
        )
        session.reader_task = asyncio.create_task(
            _session_output_loop(session, manager),
            name=f"terminal-reader-{shell_id}",
        )
        _sessions[shell_id] = session
        return session


async def _write_pipe_message(
    session: TerminalSession,
    payload: Mapping[str, object],
) -> None:
    manager = await mgr()
    state = manager.get_pipe_state(session.shell_id)
    if state is None or not state.stdin_supported:
        raise RuntimeError(f"Pipe stdin unavailable for shell {session.shell_id}")
    stdin = state.process.stdin
    if stdin is None or stdin.is_closing():
        raise RuntimeError(f"Pipe stdin is closed for shell {session.shell_id}")
    frame = encode_pipe_message(payload)
    async with session.write_lock:
        try:
            stdin.write(frame)
            await stdin.drain()
        except Exception as exc:
            raise RuntimeError(f"Pipe stdin write failed for shell {session.shell_id}: {exc}") from exc


async def _attach_connection(
    session: TerminalSession,
    conn_id: str,
    connection: TerminalConnection,
    *,
    request_id: str,
    cols: int,
    rows: int,
) -> None:
    async with session.lock:
        if request_id in session.pending_attach:
            raise RuntimeError("Duplicate terminal attach request id")
        connection.attach_request_id = request_id
        session.connections[conn_id] = connection
        session.pending_attach[request_id] = conn_id
    try:
        await _write_pipe_message(
            session,
            {
                "type": "attach",
                "request_id": request_id,
                "cols": cols,
                "rows": rows,
            },
        )
    except Exception:
        await _drop_connection(session, conn_id)
        raise


async def _send_worker_message(shell_id: str, payload: Mapping[str, object]) -> None:
    session = await _get_or_create_session(shell_id)
    await _write_pipe_message(session, payload)


async def _drop_session(shell_id: str) -> None:
    session: TerminalSession | None = None
    async with _sessions_lock:
        session = _sessions.pop(shell_id, None)
    if session is None:
        return
    session.stop.set()
    async with session.lock:
        connections = list(session.connections.values())
        session.connections.clear()
        session.pending_attach.clear()
    for connection in connections:
        with suppress(asyncio.QueueFull):
            connection.queue.put_nowait(None)
    if session.reader_task is not None:
        _ = session.reader_task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await session.reader_task


@terminal_bp.get("/sidebar/cwd")
async def get_sidebar_cwd() -> JsonObject:
    try:
        result = await _call_sidebar_rpc("sidebar.cwd.get", {}, timeout=5)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"sidebar cwd lookup failed: {exc}") from exc
    cwd = _coerce_optional_string(result.get("cwd"))
    if not cwd:
        raise HTTPException(status_code=502, detail="sidebar cwd lookup returned no cwd")
    payload: JsonObject = {
        "cwd": _normalize_cwd(cwd),
        "reason": _coerce_optional_string(result.get("reason")) or "request",
        "ts": result.get("ts") if isinstance(result.get("ts"), int) else int(time.time() * 1000),
    }
    return _ok(payload)


@terminal_bp.post("/sidebar/window/state")
async def publish_sidebar_window_state(payload: JsonObject | None = Body(None)) -> JsonObject:
    """
    Backend bridge for Terminal stateful sidebar app windows.

    The frontend declares the current shell state here; this backend validates
    the shell against framework-shells and asks /sidebar_ipc to persist the
    per-slot restore state. Dead or missing shells reset to the base Terminal
    state instead of failing app/backend readiness.
    """
    body = payload if isinstance(payload, dict) else {}
    host_id = _coerce_optional_string(body.get("host_id") or body.get("hostId")) or ""
    if not host_id:
        raise HTTPException(status_code=400, detail="host_id is required")
    token_id = _coerce_optional_string(body.get("token_id") or body.get("tokenId")) or SIDEBAR_TOKEN_ID
    console_worker_id = _coerce_optional_string(body.get("console_worker_id") or body.get("consoleWorkerId")) or ""
    requested_shell_id = _coerce_optional_string(body.get("shell_id") or body.get("shellId")) or ""
    raw_query_state = _coerce_json_object(body.get("query_state") or body.get("queryState")) or {}
    requested_cwd = (
        _coerce_optional_string(body.get("cwd"))
        or _coerce_optional_string(raw_query_state.get("cwd"))
        or ""
    )
    force_reset = bool(_coerce_optional_bool(body.get("reset") or body.get("clear")) or False)

    live_record = await _get_alive(requested_shell_id) if requested_shell_id and not force_reset else None
    live_shell_id = live_record.id if live_record is not None else ""
    cwd_value = ""
    if live_record is not None:
        cwd_value = _normalize_cwd(requested_cwd) if requested_cwd else await _shell_record_cwd(live_record)

    query_state: JsonObject = {}
    if live_shell_id:
        query_state["shell_id"] = live_shell_id
        if cwd_value:
            query_state["cwd"] = cwd_value

    url_value = _canonical_sidebar_url(
        host_id,
        token_id,
        shell_id=live_shell_id,
        cwd=cwd_value if live_shell_id else "",
        console_worker_id=console_worker_id,
    )
    label = f"Terminal {live_shell_id[-8:]}" if live_shell_id else "Terminal"
    params: JsonObject = {
        "lane": {
            "app_id": APP_ID,
            "base_url": APP_BASE_URL,
        },
        "app_id": APP_ID,
        "appId": APP_ID,
        "base_url": APP_BASE_URL,
        "baseUrl": APP_BASE_URL,
        "host_id": host_id,
        "hostId": host_id,
        "token_id": token_id,
        "tokenId": token_id,
        "console_worker_id": console_worker_id,
        "consoleWorkerId": console_worker_id,
        "state_kind": "shell",
        "stateKind": "shell",
        "query_state": query_state,
        "queryState": query_state,
        "url": url_value,
        "label": label,
        "title": label,
        "load": "eager",
        "activate": bool(body.get("activate", False)),
        "source": "terminal_backend",
    }
    try:
        rpc_result = await _call_sidebar_rpc(
            "sidebar.window.state.update",
            params,
            timeout=5,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"sidebar IPC update failed: {exc}") from exc

    return _ok(
        {
            "sidebar": rpc_result,
            "state": {
                "shell_id": live_shell_id,
                "cwd": cwd_value,
                "reset": not bool(live_shell_id),
                "requested_shell_id": requested_shell_id,
                "url": url_value,
                "query_state": query_state,
            },
        }
    )


@terminal_bp.get("/shells")
async def list_shells() -> JsonObject:
    manager = await mgr()
    prefixes = (LABEL_PREFIX, *LEGACY_LABEL_PREFIXES)
    records = [
        await manager.describe(record)
        for record in await manager.list_shells()
        if any((record.label or "").startswith(prefix) for prefix in prefixes)
        and _is_supported_terminal_record(record)
    ]
    return _ok(records)


@terminal_bp.post("/shells")
async def create_shell(payload: CreateShellRequest) -> JsonObject:
    return _ok(await _create_shell_record(payload))


@terminal_bp.get("/shells/{shell_id}")
async def get_shell(
    shell_id: str,
    tail: int = 0,
    logs: bool = False,
) -> JsonObject:
    manager = await mgr()
    rec = await manager.get_shell(shell_id)
    if rec is None or not _is_supported_terminal_record(rec):
        raise HTTPException(status_code=404, detail="Shell not found")
    data = await manager.describe(rec, include_logs=logs, tail_lines=tail)
    return _ok(data)


@terminal_bp.post("/shells/{shell_id}/input")
async def send_input(shell_id: str, payload: ShellInputRequest) -> JsonObject:
    text = payload.data
    if payload.newline:
        text += "\n"
    try:
        await _send_worker_message(
            shell_id,
            {"type": "input", "data": text.encode("utf-8")},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write shell input: {exc}") from exc
    return _ok({"id": shell_id})


@terminal_bp.post("/shells/{shell_id}/resize")
async def resize_shell(shell_id: str, payload: ShellResizeRequest) -> JsonObject:
    cols = max(1, payload.cols)
    rows = max(1, payload.rows)
    try:
        await _send_worker_message(
            shell_id,
            {"type": "resize", "cols": cols, "rows": rows},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Resize failed: {exc}") from exc
    return _ok({"id": shell_id, "cols": cols, "rows": rows})


@terminal_bp.post("/shells/{shell_id}/action")
async def shell_action(shell_id: str, payload: ShellActionRequest) -> JsonObject:
    action = payload.action.lower().strip()
    manager = await mgr()
    try:
        current = await manager.get_shell(shell_id)
        if current is None or not _is_supported_terminal_record(current):
            raise KeyError(shell_id)
        if action in {"stop", "terminate"}:
            record = await manager.terminate_shell(shell_id, force=False)
        elif action in {"kill", "force"}:
            record = await manager.terminate_shell(shell_id, force=True)
        elif action == "restart":
            await _drop_session(shell_id)
            record = await manager.restart_shell(shell_id)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported action '{action}'")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Shell not found") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Shell action failed: {exc}") from exc
    return _ok(await manager.describe(record))


@terminal_bp.delete("/shells/{shell_id}")
async def delete_shell(shell_id: str) -> JsonObject:
    manager = await mgr()
    try:
        current = await manager.get_shell(shell_id)
        if current is None or not _is_supported_terminal_record(current):
            raise KeyError(shell_id)
        await manager.remove_shell(shell_id, force=True)
        await _drop_session(shell_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Shell not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to remove shell: {exc}") from exc
    return _ok({"id": shell_id})


async def _receive_ws_message(websocket: WebSocket) -> JsonObject:
    event = await websocket.receive()
    event_type = _coerce_string(event.get("type"))
    if event_type == "websocket.disconnect":
        raise WebSocketDisconnect(_coerce_non_negative_int(event.get("code"), 1000))
    payload = _coerce_bytes(event.get("bytes"))
    if payload is None:
        raise ValueError("Terminal WebSocket accepts binary MessagePack messages only")
    return unpack_message(payload)


@terminal_bp.websocket("/ws/terminal")
async def terminal_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    if websocket.query_params.get("codec") != TERMINAL_STREAM_CODEC:
        await websocket.send_bytes(
            pack_message(
                _error_frame(
                    "codec_required",
                    f"Terminal WebSocket requires codec={TERMINAL_STREAM_CODEC}",
                    fatal=True,
                )
            )
        )
        await websocket.close(code=1008)
        return

    conn_id = uuid.uuid4().hex
    send_queue: asyncio.Queue[JsonObject | None] = asyncio.Queue()
    sender_task = asyncio.create_task(
        _sender_loop(websocket, send_queue),
        name=f"terminal-sender-{conn_id}",
    )
    session: TerminalSession | None = None

    try:
        try:
            attach = await _receive_ws_message(websocket)
        except ValueError as exc:
            await websocket.send_bytes(pack_message(_error_frame("invalid_attach", str(exc), fatal=True)))
            return

        if _coerce_string(attach.get("type")) != "attach":
            await websocket.send_bytes(
                pack_message(
                    _error_frame("expected_attach", "First message must be an attach request", fatal=True)
                )
            )
            return

        shell_id = _coerce_optional_string(attach.get("shell_id"))
        request_id = _coerce_optional_string(attach.get("request_id"))
        if shell_id is None or request_id is None:
            await websocket.send_bytes(
                pack_message(
                    _error_frame(
                        "invalid_attach",
                        "Attach requires shell_id and request_id",
                        fatal=True,
                    )
                )
            )
            return

        try:
            session = await _get_or_create_session(shell_id)
            connection = TerminalConnection(queue=send_queue)
            await _attach_connection(
                session,
                conn_id,
                connection,
                request_id=request_id,
                cols=_coerce_positive_int(attach.get("cols"), DEFAULT_COLS),
                rows=_coerce_positive_int(attach.get("rows"), DEFAULT_ROWS),
            )
        except (RuntimeError, ValueError) as exc:
            await websocket.send_bytes(
                pack_message(_error_frame("session_init_failed", str(exc), fatal=True))
            )
            return

        active_session = session
        while True:
            try:
                message = await _receive_ws_message(websocket)
            except ValueError as exc:
                send_queue.put_nowait(_error_frame("invalid_message", str(exc), fatal=False))
                continue

            message_type = _coerce_string(message.get("type"))
            try:
                if message_type == "input":
                    data = _coerce_bytes(message.get("data"))
                    if data is None:
                        raise ValueError("Input message requires binary data")
                    await _write_pipe_message(active_session, {"type": "input", "data": data})
                    continue
                if message_type == "resize":
                    await _write_pipe_message(
                        active_session,
                        {
                            "type": "resize",
                            "cols": _coerce_positive_int(message.get("cols"), DEFAULT_COLS),
                            "rows": _coerce_positive_int(message.get("rows"), DEFAULT_ROWS),
                        },
                    )
                    continue
                if message_type == "destroy":
                    await _write_pipe_message(active_session, {"type": "destroy"})
                    continue
                if message_type == "ping":
                    await _write_pipe_message(
                        active_session,
                        {"type": "ping", "request_id": _coerce_string(message.get("request_id"))},
                    )
                    continue
                raise ValueError(f"Unsupported terminal message '{message_type or '<missing>'}'")
            except (RuntimeError, ValueError) as exc:
                send_queue.put_nowait(_error_frame("message_failed", str(exc), fatal=False))
    except WebSocketDisconnect:
        pass
    finally:
        if session is not None:
            await _drop_connection(session, conn_id)
        with suppress(Exception):
            send_queue.put_nowait(None)
        _ = sender_task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await sender_task
