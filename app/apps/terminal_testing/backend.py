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
from typing import ClassVar, Protocol, cast
import uuid

from fastapi import APIRouter, HTTPException, WebSocket
from pydantic import BaseModel, ConfigDict
from starlette.websockets import WebSocketDisconnect

from framework_shells import get_manager as _manager  # pyright: ignore[reportMissingImports,reportUnknownVariableType]
from framework_shells.orchestrator import Orchestrator  # pyright: ignore[reportMissingImports,reportUnknownVariableType]

APP_ID = "terminal_testing"
SHELLSPEC_DIR = Path(__file__).resolve().parent / "shellspec"
SHELLSPEC_REF = "terminal_stream.yaml#terminal-stream"
BROKER_ENTRY = Path(__file__).resolve().parent / "terminal_stream_broker.mjs"
LABEL_PREFIX = "terminal-testing-stream"
SESSION_RING_MAX = 2048
DEFAULT_COLS = 80
DEFAULT_ROWS = 24

terminal_testing_bp = APIRouter()
terminal_bp = terminal_testing_bp
log = logging.getLogger("terminal_testing_backend")

JsonObject = dict[str, object]
BrokerFrame = dict[str, object]


class ShellRecordProtocol(Protocol):
    id: str
    label: str | None
    pid: int | None
    status: str | None
    exit_code: int | None
    stdout_log: str


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
        base_dir: Path,
        ctx: Mapping[str, str],
        label: str,
        wait_ready: bool,
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


def _frame_type(frame: Mapping[str, object]) -> str:
    return _coerce_string(frame.get("type"))


def _frame_seq(frame: Mapping[str, object]) -> int:
    return _coerce_non_negative_int(frame.get("seq"), 0)


def _json_line(payload: Mapping[str, object]) -> str:
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


async def _next_terminal_sequence(manager: ManagerProtocol) -> int:
    max_seq = 0
    try:
        records = await manager.list_shells()
    except Exception:
        records = []
    for rec in records:
        label = rec.label or ""
        if label == LABEL_PREFIX:
            max_seq = max(max_seq, 1)
            continue
        match = re.match(rf"^{re.escape(LABEL_PREFIX)}:(\d+)$", label)
        if not match:
            continue
        max_seq = max(max_seq, int(match.group(1)))
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
        log.warning("[terminal_testing] capability check failed shell=%s: %s", shell_id, exc)
        return False

    backend = _coerce_string(caps.get("backend"))
    stdin_write = bool(caps.get("stdin_write"))
    stdout_subscribe = bool(caps.get("stdout_subscribe_bytes"))
    if backend != "pipe" or not stdin_write or not stdout_subscribe:
        log.warning("[terminal_testing] shell=%s lacks live pipe capabilities: %s", shell_id, caps)
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
                "SHELL_CMD_JSON": json.dumps(shell_cmd),
            },
            label=label,
            wait_ready=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to spawn broker shell: {exc}") from exc

    return await manager.describe(record)


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
        record: BrokerFrame = {
            "type": "closed",
            "seq": session.last_seq,
            "ts": int(time.time() * 1000),
            "exit_code": exit_code,
            "reason": reason,
        }
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
            if not isinstance(loaded, dict):
                continue
            frame = cast(BrokerFrame, loaded)
            seq = _frame_seq(frame)
            if seq > after_seq:
                out.append(frame)
    return out


async def _read_log_frames_after(path: str, after_seq: int) -> list[BrokerFrame]:
    return await asyncio.to_thread(_read_log_after, path, after_seq)


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
                    log.warning("[terminal_testing] bad broker JSON: %s", line_bytes[:200])
                    continue
                if not isinstance(loaded, dict):
                    continue
                frame = cast(BrokerFrame, loaded)
                if _frame_type(frame) == "ready":
                    continue
                await _record_stream_frame(session, frame)
                await _broadcast(session, frame)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.exception("[terminal_testing] broker stdout reader crashed shell=%s", session.shell_id)
        await _broadcast(
            session,
            {
                "type": "error",
                "code": "broker_stream_failed",
                "message": str(exc),
                "fatal": False,
            },
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

        if not await _ensure_live_broker_io(shell_id):
            raise RuntimeError("Broker shell missing live pipe capabilities")

        manager = await mgr()
        rec = await manager.get_shell(shell_id)
        if rec is None:
            raise RuntimeError("Broker shell not found")

        session = TerminalSession(
            session_id=uuid.uuid4().hex,
            shell_id=shell_id,
            stdout_log_path=rec.stdout_log,
        )
        session.reader_task = asyncio.create_task(
            _session_output_loop(session),
            name=f"terminal-testing-reader-{shell_id}",
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
        return "fresh", [], {
            "type": "error",
            "code": "resume_gap",
            "message": "Replay history unavailable; continuing from live stream.",
            "fatal": False,
        }
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
            {
                "type": "hello",
                "session_id": session.session_id,
                "shell_id": session.shell_id,
                "next_seq": session.last_seq + 1,
                "resume_mode": resume_mode,
            }
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


async def _resolve_shell_for_hello(payload: Mapping[str, object]) -> str:
    requested_shell_id = _coerce_optional_string(payload.get("shell_id"))
    if requested_shell_id:
        manager = await mgr()
        rec = await manager.get_shell(requested_shell_id)
        if rec is None:
            raise RuntimeError("Shell not found")
        return requested_shell_id

    requested_session_id = _coerce_optional_string(payload.get("session_id"))
    if requested_session_id:
        async with _sessions_lock:
            session = _sessions.get(requested_session_id)
            if session is not None:
                return session.shell_id

    create_if_missing = bool(payload.get("create_if_missing"))
    if create_if_missing:
        create_request = CreateShellRequest(
            shell=cast(str | list[str] | None, payload.get("shell")),
            cwd=_normalize_cwd(_coerce_string(payload.get("cwd")) or "~"),
            cols=_coerce_positive_int(payload.get("cols"), DEFAULT_COLS),
            rows=_coerce_positive_int(payload.get("rows"), DEFAULT_ROWS),
        )
        created = await _create_shell_record(create_request)
        shell_id = _coerce_optional_string(created.get("id"))
        if shell_id is None:
            raise RuntimeError("Created shell did not return an id")
        return shell_id

    raise RuntimeError("Missing shell_id and no resumable session was found")


async def _send_broker_frame(shell_id: str, payload: Mapping[str, object]) -> None:
    if not await _ensure_live_broker_io(shell_id):
        raise RuntimeError("Broker shell is not writable")
    manager = await mgr()
    await manager.write_to_pipe(shell_id, _json_line(payload))


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


@terminal_testing_bp.get("/shells")
async def list_shells() -> JsonObject:
    manager = await mgr()
    records = [
        await manager.describe(record)
        for record in await manager.list_shells()
        if (record.label or "").startswith(LABEL_PREFIX)
    ]
    return _ok(records)


@terminal_testing_bp.post("/shells")
async def create_shell(payload: CreateShellRequest) -> JsonObject:
    return _ok(await _create_shell_record(payload))


@terminal_testing_bp.get("/shells/{shell_id}")
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
    return _ok(data)


@terminal_testing_bp.post("/shells/{shell_id}/input")
async def send_input(shell_id: str, payload: ShellInputRequest) -> JsonObject:
    text = payload.data
    if payload.newline:
        text += "\n"
    try:
        encoded = base64.b64encode(text.encode("utf-8")).decode("ascii")
        await _send_broker_frame(shell_id, {"type": "input", "data_b64": encoded, "flush": "immediate"})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write broker input: {exc}") from exc
    return _ok({"id": shell_id})


@terminal_testing_bp.post("/shells/{shell_id}/resize")
async def resize_shell(shell_id: str, payload: ShellResizeRequest) -> JsonObject:
    cols = max(1, payload.cols)
    rows = max(1, payload.rows)
    try:
        await _send_broker_frame(shell_id, {"type": "resize", "cols": cols, "rows": rows})
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Resize failed: {exc}") from exc
    return _ok({"id": shell_id, "cols": cols, "rows": rows})


@terminal_testing_bp.post("/shells/{shell_id}/action")
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
    return _ok(await manager.describe(record))


@terminal_testing_bp.delete("/shells/{shell_id}")
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


@terminal_testing_bp.websocket("/ws/terminal")
async def terminal_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    conn_id = uuid.uuid4().hex
    send_queue: asyncio.Queue[BrokerFrame | None] = asyncio.Queue()
    sender_task = asyncio.create_task(
        _sender_loop(websocket, send_queue),
        name=f"terminal-testing-sender-{conn_id}",
    )
    session: TerminalSession | None = None

    try:
        raw = await websocket.receive_text()
        try:
            loaded = cast(object, json.loads(raw))
        except json.JSONDecodeError:
            send_queue.put_nowait(
                {
                    "type": "error",
                    "code": "bad_json",
                    "message": "Expected JSON hello frame",
                    "fatal": True,
                }
            )
            return

        if not isinstance(loaded, dict):
            send_queue.put_nowait(
                {
                    "type": "error",
                    "code": "expected_object",
                    "message": "Hello frame must be a JSON object",
                    "fatal": True,
                }
            )
            return

        payload = cast(BrokerFrame, loaded)
        if _frame_type(payload) != "hello":
            send_queue.put_nowait(
                {
                    "type": "error",
                    "code": "expected_hello",
                    "message": "First frame must be hello",
                    "fatal": True,
                }
            )
            return

        try:
            shell_id = await _resolve_shell_for_hello(payload)
            requested_session_id = _coerce_optional_string(payload.get("session_id"))
            resume_after_seq = _coerce_non_negative_int(payload.get("resume_after_seq"), 0)
            session = await _get_or_create_session(shell_id, requested_session_id)
            await _attach_connection(session, conn_id, send_queue, resume_after_seq)
        except HTTPException as exc:
            send_queue.put_nowait(
                {
                    "type": "error",
                    "code": "session_init_failed",
                    "message": str(exc.detail),
                    "fatal": True,
                }
            )
            return
        except RuntimeError as exc:
            send_queue.put_nowait(
                {
                    "type": "error",
                    "code": "session_init_failed",
                    "message": str(exc),
                    "fatal": True,
                }
            )
            return
        active_session = session

        cols = _coerce_positive_int(payload.get("cols"), 0)
        rows = _coerce_positive_int(payload.get("rows"), 0)
        if cols > 0 and rows > 0:
            with suppress(Exception):
                await _send_broker_frame(active_session.shell_id, {"type": "resize", "cols": cols, "rows": rows})

        async for raw_frame in websocket.iter_text():
            try:
                loaded_frame = cast(object, json.loads(raw_frame))
            except json.JSONDecodeError:
                send_queue.put_nowait(
                    {
                        "type": "error",
                        "code": "bad_json",
                        "message": "Malformed frame",
                        "fatal": False,
                    }
                )
                continue

            if not isinstance(loaded_frame, dict):
                send_queue.put_nowait(
                    {
                        "type": "error",
                        "code": "expected_object",
                        "message": "Frame must be a JSON object",
                        "fatal": False,
                    }
                )
                continue

            frame = cast(BrokerFrame, loaded_frame)
            frame_type = _frame_type(frame)
            if frame_type == "ping":
                send_queue.put_nowait({"type": "pong", "nonce": frame.get("nonce")})
                continue

            if frame_type == "input":
                data_b64 = _coerce_optional_string(frame.get("data_b64"))
                if not data_b64:
                    continue
                try:
                    await _send_broker_frame(
                        active_session.shell_id,
                        {
                            "type": "input",
                            "data_b64": data_b64,
                            "flush": _coerce_optional_string(frame.get("flush")) or "auto",
                        },
                    )
                except Exception as exc:
                    send_queue.put_nowait(
                        {
                            "type": "error",
                            "code": "write_failed",
                            "message": str(exc),
                            "fatal": False,
                        }
                    )
                continue

            if frame_type == "resize":
                try:
                    resize_cols = _coerce_positive_int(frame.get("cols"), DEFAULT_COLS)
                    resize_rows = _coerce_positive_int(frame.get("rows"), DEFAULT_ROWS)
                    await _send_broker_frame(
                        active_session.shell_id,
                        {"type": "resize", "cols": resize_cols, "rows": resize_rows},
                    )
                except Exception as exc:
                    send_queue.put_nowait(
                        {
                            "type": "error",
                            "code": "resize_failed",
                            "message": str(exc),
                            "fatal": False,
                        }
                    )
                continue

            if frame_type == "destroy":
                try:
                    await _send_broker_frame(active_session.shell_id, {"type": "destroy"})
                except Exception as exc:
                    send_queue.put_nowait(
                        {
                            "type": "error",
                            "code": "destroy_failed",
                            "message": str(exc),
                            "fatal": False,
                        }
                    )
                continue

            send_queue.put_nowait(
                {
                    "type": "error",
                    "code": "unknown_frame",
                    "message": f"Unsupported frame '{frame_type}'",
                    "fatal": False,
                }
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
