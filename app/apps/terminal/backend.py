import asyncio
import base64
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
from typing import ClassVar, Literal, NotRequired, Protocol, TypeAlias, TypedDict, cast
import uuid

from fastapi import APIRouter, HTTPException, WebSocket
from pydantic import BaseModel, ConfigDict
from starlette.websockets import WebSocketDisconnect

from framework_shells import get_manager as _manager  # pyright: ignore[reportMissingImports,reportUnknownVariableType]
from framework_shells.orchestrator import Orchestrator  # pyright: ignore[reportMissingImports,reportUnknownVariableType]

APP_ID = "terminal"
SHELLSPEC_DIR = Path(__file__).resolve().parent / "shellspec"
DEFAULT_SHELL_KIND = "python"
TERMINAL_STREAM_KIND_ENV = "TERMINAL_STREAM_KIND"
SHELLSPEC_REFS: dict[str, str] = {
    "python": "terminal_stream.yaml#terminal-stream",
    "native": "native_terminal_stream.yaml#terminal-stream",
    "node": "node_terminal_stream.yaml#terminal-stream",
}
BROKER_ENTRY = Path(__file__).resolve().parent / "terminal_stream_broker.mjs"
LABEL_PREFIX = "terminal-stream"
LEGACY_LABEL_PREFIXES = ("terminal-testing-stream",)
SESSION_RING_MAX = 2048
DEFAULT_COLS = 80
DEFAULT_ROWS = 24

terminal_bp = APIRouter()
log = logging.getLogger("terminal_backend")

JsonObject = dict[str, object]
TerminalMethod: TypeAlias = Literal[
    "terminal.connect",
    "terminal.input",
    "terminal.resize",
    "terminal.destroy",
    "terminal.ping",
]
FlushMode: TypeAlias = Literal["auto", "immediate"]


class TerminalConnectParams(TypedDict, total=False):
    session_id: str
    shell_id: str
    cols: int
    rows: int
    resume_after_seq: int
    create_if_missing: bool
    cwd: str
    shell: str | list[str]
    kind: str


class TerminalInputParams(TypedDict):
    data_b64: str
    flush: NotRequired[FlushMode]


class TerminalResizeParams(TypedDict):
    cols: int
    rows: int


class TerminalDestroyParams(TypedDict):
    pass


class TerminalPingParams(TypedDict, total=False):
    nonce: str


class TerminalHelloFrame(TypedDict):
    type: Literal["hello"]
    session_id: str
    shell_id: str
    next_seq: NotRequired[int]
    resume_mode: NotRequired[str]


class TerminalDataFrame(TypedDict):
    type: Literal["data"]
    seq: int
    data_b64: str


class TerminalClosedFrame(TypedDict, total=False):
    type: Literal["closed"]
    seq: int
    exit_code: int | None
    reason: str


class TerminalErrorFrame(TypedDict, total=False):
    type: Literal["error"]
    code: str
    message: str
    fatal: bool


class TerminalPongFrame(TypedDict, total=False):
    type: Literal["pong"]
    nonce: str


class TerminalReadyFrame(TypedDict):
    type: Literal["ready"]


BrokerFrame: TypeAlias = (
    TerminalHelloFrame
    | TerminalDataFrame
    | TerminalClosedFrame
    | TerminalErrorFrame
    | TerminalPongFrame
    | TerminalReadyFrame
)


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
    async def write_to_pipe(self, shell_id: str, data: str) -> None: ...
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
    kind: str | None = None


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
class TerminalSession:
    session_id: str
    shell_id: str
    stdout_log_path: str
    last_seq: int = 0
    ring_buffer: deque[BrokerFrame] = field(default_factory=lambda: deque(maxlen=SESSION_RING_MAX))
    subscribers: dict[str, asyncio.Queue[BrokerFrame | None]] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    reader_task: asyncio.Task[None] | None = None
    closed_payload: BrokerFrame | None = None


_sessions: dict[str, TerminalSession] = {}
_shell_to_session: dict[str, str] = {}
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


def _coerce_optional_bool(raw: object) -> bool | None:
    if isinstance(raw, bool):
        return raw
    return None


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


def _coerce_optional_non_negative_int(raw: object) -> int | None:
    value = _coerce_optional_int(raw)
    if value is None or value < 0:
        return None
    return value


def _coerce_json_object(raw: object) -> JsonObject | None:
    if not isinstance(raw, Mapping):
        return None
    payload: JsonObject = {}
    for key, value in raw.items():
        if isinstance(key, str):
            payload[key] = value
    return payload


def _coerce_string_list(raw: object) -> list[str] | None:
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes, bytearray)):
        values = [str(item) for item in raw if str(item).strip()]
        return values or None
    return None


def _frame_type(frame: BrokerFrame) -> str:
    return frame["type"]


def _frame_seq(frame: BrokerFrame) -> int:
    return frame["seq"] if frame["type"] in {"data", "closed"} and "seq" in frame else 0


def _jsonrpc_method(payload: Mapping[str, object]) -> str:
    if _coerce_string(payload.get("jsonrpc")) != "2.0":
        return ""
    return _coerce_string(payload.get("method"))


def _jsonrpc_params(payload: Mapping[str, object]) -> JsonObject:
    raw = payload.get("params")
    return _coerce_json_object(raw) or {}


def _parse_connect_params(payload: Mapping[str, object]) -> TerminalConnectParams:
    params: TerminalConnectParams = {}
    session_id = _coerce_optional_string(payload.get("session_id"))
    if session_id is not None:
        params["session_id"] = session_id
    shell_id = _coerce_optional_string(payload.get("shell_id"))
    if shell_id is not None:
        params["shell_id"] = shell_id
    cols = _coerce_optional_non_negative_int(payload.get("cols"))
    if cols is not None and cols > 0:
        params["cols"] = cols
    rows = _coerce_optional_non_negative_int(payload.get("rows"))
    if rows is not None and rows > 0:
        params["rows"] = rows
    resume_after_seq = _coerce_optional_non_negative_int(payload.get("resume_after_seq"))
    if resume_after_seq is not None:
        params["resume_after_seq"] = resume_after_seq
    create_if_missing = _coerce_optional_bool(payload.get("create_if_missing"))
    if create_if_missing is not None:
        params["create_if_missing"] = create_if_missing
    cwd = _coerce_optional_string(payload.get("cwd"))
    if cwd is not None:
        params["cwd"] = cwd
    shell_value = payload.get("shell")
    shell_parts = _coerce_string_list(shell_value)
    if shell_parts is not None:
        params["shell"] = shell_parts
    else:
        shell_text = _coerce_optional_string(shell_value)
        if shell_text is not None:
            params["shell"] = shell_text
    kind = _coerce_optional_string(payload.get("kind"))
    if kind is not None:
        params["kind"] = kind
    return params


def _parse_input_params(payload: Mapping[str, object]) -> TerminalInputParams | None:
    data_b64 = _coerce_optional_string(payload.get("data_b64"))
    if data_b64 is None:
        return None
    params: TerminalInputParams = {"data_b64": data_b64}
    flush = _coerce_optional_string(payload.get("flush"))
    if flush in {"auto", "immediate"}:
        params["flush"] = cast(FlushMode, flush)
    return params


def _parse_resize_params(payload: Mapping[str, object]) -> TerminalResizeParams:
    return {
        "cols": _coerce_positive_int(payload.get("cols"), DEFAULT_COLS),
        "rows": _coerce_positive_int(payload.get("rows"), DEFAULT_ROWS),
    }


def _parse_ping_params(payload: Mapping[str, object]) -> TerminalPingParams:
    params: TerminalPingParams = {}
    nonce = _coerce_optional_string(payload.get("nonce"))
    if nonce is not None:
        params["nonce"] = nonce
    return params


def _error_frame(code: str, message: str, *, fatal: bool) -> TerminalErrorFrame:
    return {
        "type": "error",
        "code": code,
        "message": message,
        "fatal": fatal,
    }


def _pong_frame(nonce: str | None = None) -> TerminalPongFrame:
    frame: TerminalPongFrame = {"type": "pong"}
    if nonce is not None:
        frame["nonce"] = nonce
    return frame


def _hello_frame(
    *,
    session_id: str,
    shell_id: str,
    next_seq: int | None = None,
    resume_mode: str | None = None,
) -> TerminalHelloFrame:
    frame: TerminalHelloFrame = {
        "type": "hello",
        "session_id": session_id,
        "shell_id": shell_id,
    }
    if next_seq is not None:
        frame["next_seq"] = next_seq
    if resume_mode is not None:
        frame["resume_mode"] = resume_mode
    return frame


def _closed_frame(
    *,
    seq: int | None = None,
    exit_code: int | None = None,
    reason: str | None = None,
) -> TerminalClosedFrame:
    frame: TerminalClosedFrame = {"type": "closed"}
    if seq is not None:
        frame["seq"] = seq
    if exit_code is not None or exit_code is None:
        frame["exit_code"] = exit_code
    if reason is not None:
        frame["reason"] = reason
    return frame


def _coerce_broker_frame(raw: object) -> BrokerFrame | None:
    payload = _coerce_json_object(raw)
    if payload is None:
        return None
    frame_type = _coerce_string(payload.get("type"))
    if frame_type == "hello":
        session_id = _coerce_optional_string(payload.get("session_id"))
        shell_id = _coerce_optional_string(payload.get("shell_id"))
        if session_id is None or shell_id is None:
            return None
        return _hello_frame(
            session_id=session_id,
            shell_id=shell_id,
            next_seq=_coerce_optional_non_negative_int(payload.get("next_seq")),
            resume_mode=_coerce_optional_string(payload.get("resume_mode")),
        )
    if frame_type == "data":
        seq = _coerce_optional_non_negative_int(payload.get("seq"))
        data_b64 = _coerce_optional_string(payload.get("data_b64"))
        if seq is None or data_b64 is None:
            return None
        return {"type": "data", "seq": seq, "data_b64": data_b64}
    if frame_type == "closed":
        return _closed_frame(
            seq=_coerce_optional_non_negative_int(payload.get("seq")),
            exit_code=_coerce_optional_int(payload.get("exit_code")),
            reason=_coerce_optional_string(payload.get("reason")),
        )
    if frame_type == "error":
        code = _coerce_optional_string(payload.get("code"))
        message = _coerce_optional_string(payload.get("message"))
        fatal = _coerce_optional_bool(payload.get("fatal"))
        frame: TerminalErrorFrame = {"type": "error"}
        if code is not None:
            frame["code"] = code
        if message is not None:
            frame["message"] = message
        if fatal is not None:
            frame["fatal"] = fatal
        return frame
    if frame_type == "pong":
        return _pong_frame(_coerce_optional_string(payload.get("nonce")))
    if frame_type == "ready":
        return {"type": "ready"}
    return None


def _jsonrpc_line(method: TerminalMethod, params: JsonObject | None = None) -> str:
    payload: JsonObject = {
        "jsonrpc": "2.0",
        "method": method,
        "params": dict(params or {}),
    }
    return json.dumps(payload, separators=(",", ":")) + "\n"


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


def _normalize_shell_kind(raw: str | None) -> str:
    value = (raw or DEFAULT_SHELL_KIND).strip().lower()
    if value in SHELLSPEC_REFS:
        return value
    return DEFAULT_SHELL_KIND


def _record_shell_kind(record: ShellRecordProtocol) -> str | None:
    raw = record.env_overrides.get(TERMINAL_STREAM_KIND_ENV)
    if raw is None:
        return None
    return _normalize_shell_kind(raw)


def _annotate_shell_payload(record: ShellRecordProtocol, payload: JsonObject) -> JsonObject:
    kind = _record_shell_kind(record)
    if kind is not None:
        payload["kind"] = kind
    return payload


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
    if record and record.pid and record.status == "running":
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
    kind = _normalize_shell_kind(request.kind)
    shellspec_ref = SHELLSPEC_REFS[kind]

    manager = await mgr()
    orch = orchestrator_ctor(manager)
    label = f"{LABEL_PREFIX}:{await _next_terminal_sequence(manager)}"
    try:
        record = await orch.start_from_ref(
            shellspec_ref,
            base_dir=SHELLSPEC_DIR,
            ctx={
                "APP_ID": APP_ID,
                "BROKER_ENTRY": str(BROKER_ENTRY),
                "CWD": cwd,
                "COLS": str(cols),
                "ROWS": str(rows),
                "SHELL_CMD_JSON": json.dumps(shell_cmd),
            },
            label=label,
            env_overrides={
                TERMINAL_STREAM_KIND_ENV: kind,
            },
            wait_ready=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start shell: {exc}") from exc

    return _annotate_shell_payload(record, await manager.describe(record))


async def _drop_subscriber(session: TerminalSession, conn_id: str) -> None:
    async with session.lock:
        queue = session.subscribers.pop(conn_id, None)
    if queue is not None:
        with suppress(asyncio.QueueFull):
            queue.put_nowait(None)


async def _broadcast(session: TerminalSession, payload: BrokerFrame) -> None:
    async with session.lock:
        items = list(session.subscribers.items())
    stale: list[str] = []
    for conn_id, queue in items:
        try:
            queue.put_nowait(dict(payload))
        except Exception:
            stale.append(conn_id)
    for conn_id in stale:
        await _drop_subscriber(session, conn_id)


async def _sender_loop(
    websocket: WebSocket,
    queue: asyncio.Queue[BrokerFrame | None],
) -> None:
    while True:
        payload = await queue.get()
        if payload is None:
            break
        await websocket.send_text(json.dumps(payload, separators=(",", ":")))


async def _record_stream_frame(session: TerminalSession, frame: BrokerFrame) -> None:
    seq = _frame_seq(frame)
    async with session.lock:
        if seq > 0:
            session.last_seq = max(session.last_seq, seq)
            session.ring_buffer.append(dict(frame))
        if _frame_type(frame) == "closed":
            session.closed_payload = dict(frame)


async def _make_synthetic_closed(
    session: TerminalSession,
    reason: str,
    exit_code: int | None,
) -> BrokerFrame:
    async with session.lock:
        if session.closed_payload is not None:
            return dict(session.closed_payload)
        session.last_seq += 1
        record = _closed_frame(seq=session.last_seq, exit_code=exit_code, reason=reason)
        session.closed_payload = dict(record)
        session.ring_buffer.append(dict(record))
        return record


def _read_log_after(path: str, after_seq: int) -> list[BrokerFrame]:
    out: list[BrokerFrame] = []
    log_path = Path(path)
    if not log_path.exists():
        return out
    with log_path.open("r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.strip()
            if not line:
                continue
            try:
                loaded = cast(object, json.loads(line))
            except json.JSONDecodeError:
                continue
            frame = _coerce_broker_frame(loaded)
            if frame is None:
                continue
            seq = _frame_seq(frame)
            if seq > after_seq:
                out.append(frame)
    return out


async def _read_log_frames_after(path: str, after_seq: int) -> list[BrokerFrame]:
    return await asyncio.to_thread(_read_log_after, path, after_seq)


def _slice_history_frames(frames: list[BrokerFrame], limit: int) -> list[BrokerFrame]:
    if limit <= 0 or len(frames) <= limit:
        return frames
    return frames[-limit:]


async def _prime_dead_session_from_log(
    session: TerminalSession,
    *,
    fallback_reason: str,
    fallback_exit_code: int | None,
) -> None:
    frames = await _read_log_frames_after(session.stdout_log_path, 0)
    if frames:
        replay_tail = _slice_history_frames(frames, SESSION_RING_MAX)
        async with session.lock:
            session.last_seq = max((_frame_seq(frame) for frame in frames), default=0)
            session.ring_buffer.extend(dict(frame) for frame in replay_tail)
            for frame in reversed(frames):
                if _frame_type(frame) == "closed":
                    session.closed_payload = dict(frame)
                    break
    if session.closed_payload is None:
        _ = await _make_synthetic_closed(session, fallback_reason, fallback_exit_code)


async def _session_output_loop(session: TerminalSession) -> None:
    manager = await mgr()
    queue: OutputSubscriptionProtocol | None = None
    buf = b""
    last_status_check = 0.0
    try:
        queue = await manager.subscribe_output_bytes(session.shell_id)
        while not session.stop.is_set():
            try:
                chunk = await asyncio.wait_for(queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                now = asyncio.get_running_loop().time()
                if now - last_status_check < 2.0:
                    continue
                last_status_check = now
                rec = await manager.get_shell(session.shell_id)
                live = bool(rec and rec.status == "running" and rec.pid)
                if live:
                    continue
                closed = await _make_synthetic_closed(
                    session,
                    (rec.status if rec and rec.status else "missing"),
                    rec.exit_code if rec else None,
                )
                await _broadcast(session, closed)
                break

            if not chunk:
                continue
            buf += bytes(chunk)
            while b"\n" in buf:
                line_bytes, buf = buf.split(b"\n", 1)
                if line_bytes.endswith(b"\r"):
                    line_bytes = line_bytes[:-1]
                if not line_bytes:
                    continue
                try:
                    loaded = cast(object, json.loads(line_bytes.decode("utf-8", errors="replace")))
                except json.JSONDecodeError:
                    log.warning("[terminal] bad broker JSON: %s", line_bytes[:200])
                    continue
                frame = _coerce_broker_frame(loaded)
                if frame is None:
                    continue
                if _frame_type(frame) == "ready":
                    continue
                await _record_stream_frame(session, frame)
                await _broadcast(session, frame)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.exception("[terminal] broker stdout reader crashed shell=%s", session.shell_id)
        await _broadcast(
            session,
            _error_frame("broker_stream_failed", str(exc), fatal=False),
        )
    finally:
        if queue is not None:
            with suppress(Exception):
                await manager.unsubscribe_output_bytes(session.shell_id, queue)


async def _get_or_create_session(shell_id: str, requested_session_id: str | None) -> TerminalSession:
    async with _sessions_lock:
        if requested_session_id:
            existing = _sessions.get(requested_session_id)
            if existing is not None and existing.shell_id == shell_id:
                return existing

        existing_id = _shell_to_session.get(shell_id)
        if existing_id:
            existing = _sessions.get(existing_id)
            if existing is not None:
                return existing

        manager = await mgr()
        rec = await manager.get_shell(shell_id)
        if rec is None:
            raise RuntimeError("Shell not found")
        live_broker_io = await _ensure_live_broker_io(shell_id)

        session = TerminalSession(
            session_id=uuid.uuid4().hex,
            shell_id=shell_id,
            stdout_log_path=rec.stdout_log,
        )
        if live_broker_io:
            session.reader_task = asyncio.create_task(
                _session_output_loop(session),
                name=f"terminal-reader-{shell_id}",
            )
        else:
            await _prime_dead_session_from_log(
                session,
                fallback_reason=rec.status or "missing",
                fallback_exit_code=rec.exit_code,
            )
        _sessions[session.session_id] = session
        _shell_to_session[shell_id] = session.session_id
        return session


async def _plan_replay(
    session: TerminalSession,
    after_seq: int,
) -> tuple[str, list[BrokerFrame], BrokerFrame | None]:
    if after_seq <= 0:
        return "fresh", [], None

    async with session.lock:
        if session.ring_buffer:
            first_seq = _frame_seq(session.ring_buffer[0])
            last_seq = _frame_seq(session.ring_buffer[-1])
            if after_seq >= last_seq:
                return "noop", [], None
            if after_seq >= first_seq - 1:
                frames = [dict(item) for item in session.ring_buffer if _frame_seq(item) > after_seq]
                return "memory", frames, None

    log_frames = await _read_log_frames_after(session.stdout_log_path, after_seq)
    if log_frames:
        return "log", log_frames, None

    async with session.lock:
        current_seq = session.last_seq
    if current_seq > after_seq:
        return "fresh", [], _error_frame(
            "resume_gap",
            "Replay history unavailable; continuing from live stream.",
            fatal=False,
        )
    return "noop", [], None


async def _attach_connection(
    session: TerminalSession,
    conn_id: str,
    queue: asyncio.Queue[BrokerFrame | None],
    after_seq: int,
) -> None:
    resume_mode, replay_frames, resume_error = await _plan_replay(session, after_seq)
    last_replayed_seq = after_seq
    if replay_frames:
        last_replayed_seq = _frame_seq(replay_frames[-1])

    async with session.lock:
        queue.put_nowait(
            _hello_frame(
                session_id=session.session_id,
                shell_id=session.shell_id,
                next_seq=session.last_seq + 1,
                resume_mode=resume_mode,
            )
        )
        for frame in replay_frames:
            queue.put_nowait(dict(frame))
        if last_replayed_seq < session.last_seq:
            for frame in session.ring_buffer:
                if _frame_seq(frame) > last_replayed_seq:
                    queue.put_nowait(dict(frame))
        if resume_error is not None:
            queue.put_nowait(dict(resume_error))
        if session.closed_payload is not None:
            queue.put_nowait(dict(session.closed_payload))
        session.subscribers[conn_id] = queue


async def _resolve_shell_for_connect(payload: TerminalConnectParams) -> str:
    requested_shell_id = payload.get("shell_id")
    if requested_shell_id:
        manager = await mgr()
        rec = await manager.get_shell(requested_shell_id)
        if rec is None:
            raise RuntimeError("Shell not found")
        return requested_shell_id

    requested_session_id = payload.get("session_id")
    if requested_session_id:
        async with _sessions_lock:
            session = _sessions.get(requested_session_id)
            if session is not None:
                return session.shell_id

    create_if_missing = bool(payload.get("create_if_missing"))
    if create_if_missing:
        create_request = CreateShellRequest(
            shell=payload.get("shell"),
            cwd=_normalize_cwd(payload.get("cwd") or "~"),
            cols=payload.get("cols", DEFAULT_COLS),
            rows=payload.get("rows", DEFAULT_ROWS),
            kind=payload.get("kind"),
        )
        created = await _create_shell_record(create_request)
        shell_id = _coerce_optional_string(created.get("id"))
        if shell_id is None:
            raise RuntimeError("Created shell did not return an id")
        return shell_id

    raise RuntimeError("Missing shell_id and no resumable session was found")


async def _send_broker_notification(
    shell_id: str,
    method: TerminalMethod,
    params: JsonObject | None = None,
) -> None:
    manager = await mgr()
    await manager.write_to_pipe(shell_id, _jsonrpc_line(method, params))


async def _drop_session(shell_id: str) -> None:
    session: TerminalSession | None = None
    async with _sessions_lock:
        session_id = _shell_to_session.pop(shell_id, None)
        if session_id:
            session = _sessions.pop(session_id, None)
    if session is None:
        return
    session.stop.set()
    async with session.lock:
        subscribers = list(session.subscribers.keys())
    for conn_id in subscribers:
        await _drop_subscriber(session, conn_id)
    if session.reader_task is not None:
        _ = session.reader_task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await session.reader_task


@terminal_bp.get("/shells")
async def list_shells() -> JsonObject:
    manager = await mgr()
    prefixes = (LABEL_PREFIX, *LEGACY_LABEL_PREFIXES)
    records = [
        _annotate_shell_payload(record, await manager.describe(record))
        for record in await manager.list_shells()
        if any((record.label or "").startswith(prefix) for prefix in prefixes)
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
    if rec is None:
        raise HTTPException(status_code=404, detail="Shell not found")
    data = await manager.describe(rec, include_logs=logs, tail_lines=tail)
    return _ok(_annotate_shell_payload(rec, data))


@terminal_bp.get("/shells/{shell_id}/history")
async def get_shell_history(
    shell_id: str,
    after_seq: int = 0,
    limit: int = 0,
) -> JsonObject:
    manager = await mgr()
    rec = await manager.get_shell(shell_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Shell not found")
    frames = await _read_log_frames_after(rec.stdout_log, max(0, after_seq))
    sliced = _slice_history_frames(frames, max(0, limit))
    return _ok(
        {
            "frames": sliced,
            "after_seq": max(0, after_seq),
            "count": len(sliced),
            "total_count": len(frames),
        }
    )


@terminal_bp.post("/shells/{shell_id}/input")
async def send_input(shell_id: str, payload: ShellInputRequest) -> JsonObject:
    text = payload.data
    if payload.newline:
        text += "\n"
    try:
        encoded = base64.b64encode(text.encode("utf-8")).decode("ascii")
        await _send_broker_notification(
            shell_id,
            "terminal.input",
            {"data_b64": encoded, "flush": "immediate"},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write shell input: {exc}") from exc
    return _ok({"id": shell_id})


@terminal_bp.post("/shells/{shell_id}/resize")
async def resize_shell(shell_id: str, payload: ShellResizeRequest) -> JsonObject:
    cols = max(1, payload.cols)
    rows = max(1, payload.rows)
    try:
        await _send_broker_notification(
            shell_id,
            "terminal.resize",
            {"cols": cols, "rows": rows},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Resize failed: {exc}") from exc
    return _ok({"id": shell_id, "cols": cols, "rows": rows})


@terminal_bp.post("/shells/{shell_id}/action")
async def shell_action(shell_id: str, payload: ShellActionRequest) -> JsonObject:
    action = payload.action.lower().strip()
    manager = await mgr()
    try:
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
    return _ok(_annotate_shell_payload(record, await manager.describe(record)))


@terminal_bp.delete("/shells/{shell_id}")
async def delete_shell(shell_id: str) -> JsonObject:
    manager = await mgr()
    try:
        await manager.remove_shell(shell_id, force=True)
        await _drop_session(shell_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Shell not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to remove shell: {exc}") from exc
    return _ok({"id": shell_id})


@terminal_bp.websocket("/ws/terminal")
async def terminal_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    conn_id = uuid.uuid4().hex
    send_queue: asyncio.Queue[BrokerFrame | None] = asyncio.Queue()
    sender_task = asyncio.create_task(
        _sender_loop(websocket, send_queue),
        name=f"terminal-sender-{conn_id}",
    )
    session: TerminalSession | None = None

    try:
        raw = await websocket.receive_text()
        try:
            loaded = cast(object, json.loads(raw))
        except json.JSONDecodeError:
            send_queue.put_nowait(_error_frame("bad_json", "Expected JSON-RPC connect notification", fatal=True))
            return

        payload = _coerce_json_object(loaded)
        if payload is None:
            send_queue.put_nowait(_error_frame("expected_object", "Connect notification must be a JSON object", fatal=True))
            return

        if _jsonrpc_method(payload) != "terminal.connect":
            send_queue.put_nowait(_error_frame("expected_connect", "First notification must be terminal.connect", fatal=True))
            return

        connect_params = _parse_connect_params(_jsonrpc_params(payload))

        try:
            shell_id = await _resolve_shell_for_connect(connect_params)
            requested_session_id = connect_params.get("session_id")
            resume_after_seq = connect_params.get("resume_after_seq", 0)
            session = await _get_or_create_session(shell_id, requested_session_id)
            await _attach_connection(session, conn_id, send_queue, resume_after_seq)
        except HTTPException as exc:
            send_queue.put_nowait(_error_frame("session_init_failed", str(exc.detail), fatal=True))
            return
        except RuntimeError as exc:
            send_queue.put_nowait(_error_frame("session_init_failed", str(exc), fatal=True))
            return
        active_session = session
        connect_notice: JsonObject = {
            "session_id": active_session.session_id,
            "shell_id": active_session.shell_id,
            "resume_after_seq": resume_after_seq,
        }
        cols = connect_params.get("cols", 0)
        rows = connect_params.get("rows", 0)
        if cols > 0:
            connect_notice["cols"] = cols
        if rows > 0:
            connect_notice["rows"] = rows
        with suppress(Exception):
            await _send_broker_notification(
                active_session.shell_id,
                "terminal.connect",
                connect_notice,
            )

        async for raw_frame in websocket.iter_text():
            try:
                loaded_frame = cast(object, json.loads(raw_frame))
            except json.JSONDecodeError:
                send_queue.put_nowait(_error_frame("bad_json", "Malformed JSON-RPC notification", fatal=False))
                continue

            frame = _coerce_json_object(loaded_frame)
            if frame is None:
                send_queue.put_nowait(_error_frame("expected_object", "Notification must be a JSON object", fatal=False))
                continue

            frame_method = _jsonrpc_method(frame)
            frame_params = _jsonrpc_params(frame)
            if frame_method == "terminal.ping":
                ping_params = _parse_ping_params(frame_params)
                send_queue.put_nowait(_pong_frame(ping_params.get("nonce")))
                continue

            if frame_method == "terminal.input":
                input_params = _parse_input_params(frame_params)
                if input_params is None:
                    continue
                try:
                    await _send_broker_notification(
                        active_session.shell_id,
                        "terminal.input",
                        dict(input_params),
                    )
                except Exception as exc:
                    send_queue.put_nowait(_error_frame("write_failed", str(exc), fatal=False))
                continue

            if frame_method == "terminal.resize":
                try:
                    resize_params = _parse_resize_params(frame_params)
                    await _send_broker_notification(
                        active_session.shell_id,
                        "terminal.resize",
                        dict(resize_params),
                    )
                except Exception as exc:
                    send_queue.put_nowait(_error_frame("resize_failed", str(exc), fatal=False))
                continue

            if frame_method == "terminal.destroy":
                try:
                    await _send_broker_notification(active_session.shell_id, "terminal.destroy")
                except Exception as exc:
                    send_queue.put_nowait(_error_frame("destroy_failed", str(exc), fatal=False))
                continue

            send_queue.put_nowait(
                _error_frame(
                    "unknown_method",
                    f"Unsupported notification '{frame_method or '<missing>'}'",
                    fatal=False,
                )
            )
    except WebSocketDisconnect:
        pass
    finally:
        if session is not None:
            await _drop_subscriber(session, conn_id)
        with suppress(Exception):
            send_queue.put_nowait(None)
        _ = sender_task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await sender_task
