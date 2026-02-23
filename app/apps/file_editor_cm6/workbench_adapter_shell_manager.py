import hashlib
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
import asyncio
import json
import logging

from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.pty import PipeState
from framework_shells.record import ShellRecord

APP_ID = "file_editor_cm6"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "workbench_adapter.yaml#workbench-adapter"

WORKBENCH_ADAPTER_FIXED_PORT = 18181

log = logging.getLogger("workbench_adapter_shell_manager")

_active_shell_id: Optional[str] = None
_pipe_state: Optional[PipeState] = None
_rpc_counter: int = 0
_rpc_pending: dict[int, asyncio.Future] = {}
_stdout_reader_task: Optional[asyncio.Task] = None
_rpc_write_lock: Optional[asyncio.Lock] = None


def _project_hash(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:8]


def _label() -> str:
    # Global instance (single active project invariant is enforced in TE2).
    return f"workbench_adapter:{APP_ID}:global"


def _expected_port() -> str:
    return str(WORKBENCH_ADAPTER_FIXED_PORT)


def _matches_expected_port(record: ShellRecord) -> bool:
    env = record.env_overrides or {}
    return str(env.get("TE2_ADAPTER_PORT") or "").strip() == _expected_port()


async def _get_alive(shell_id: str) -> Optional[ShellRecord]:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def _stdout_reader_loop(proc: asyncio.subprocess.Process) -> None:
    """Read adapter stdout, route RPC responses to pending futures, log the rest."""
    RPC_PREFIX = "<<<RPC>>> "
    PUSH_PREFIX = "<<<PUSH>>> "
    # asyncio subprocess default limit is 64KB which is too small for hover responses.
    # Read raw chunks and split on newlines ourselves.
    buf = b""
    try:
        while True:
            chunk = await proc.stdout.read(1024 * 1024)  # 1MB reads
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line_bytes, buf = buf.split(b"\n", 1)
                line = line_bytes.decode("utf-8", errors="replace")
                if line.startswith(RPC_PREFIX):
                    payload = line[len(RPC_PREFIX):]
                    try:
                        obj = json.loads(payload)
                        rid = obj.get("id")
                        fut = _rpc_pending.pop(rid, None)
                        if fut and not fut.done():
                            fut.set_result(obj)
                        else:
                            log.debug("[adapter_stdio] unmatched RPC response id=%s", rid)
                    except json.JSONDecodeError:
                        log.warning("[adapter_stdio] bad RPC JSON: %s", payload[:200])
                elif line.startswith(PUSH_PREFIX):
                    payload = line[len(PUSH_PREFIX):]
                    try:
                        obj = json.loads(payload)
                        asyncio.create_task(_handle_push_event(obj))
                    except json.JSONDecodeError:
                        log.warning("[adapter_stdio] bad PUSH JSON: %s", payload[:200])
                else:
                    if line.startswith("[rpc-config]"):
                        print(f"[adapter_stdout] {line[:500]}", flush=True)
                    log.debug("[adapter_stdout] %s", line[:500])
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        log.error("[adapter_stdio] reader crashed: %s", exc)


async def _handle_push_event(obj: dict) -> None:
    """Forward adapter push events to the editor frontend via Socket.IO."""
    event_name = obj.get("event", "")
    if event_name == "semantic_tokens_provider_registered":
        try:
            from .monaco_editor.editor_socketio import EDITOR_SIO
            await EDITOR_SIO.emit(
                f"editor:{event_name}",
                obj,
                namespace="/editor",
            )
            log.info("[push] forwarded %s lang=%s", event_name, obj.get("language"))
        except Exception as exc:
            log.warning("[push] failed to emit %s: %s", event_name, exc)


async def adapter_rpc(method: str, params: Optional[dict] = None, timeout: float = 30.0) -> dict:
    """Send a JSON-RPC request to the adapter over stdio and await the response.

    Returns the full JSON-RPC response object (with 'result' or 'error').
    Raises RuntimeError if the pipe is not available or on timeout.
    """
    global _rpc_counter

    if _pipe_state is None or _pipe_state.process.stdin is None:
        raise RuntimeError("Adapter pipe not available — shell not started or stdin closed")

    global _rpc_write_lock
    if _rpc_write_lock is None:
        _rpc_write_lock = asyncio.Lock()

    async with _rpc_write_lock:
        _rpc_counter += 1
        rid = _rpc_counter
        msg = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            msg["params"] = params

        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        _rpc_pending[rid] = fut

        line = json.dumps(msg) + "\n"
        try:
            _pipe_state.process.stdin.write(line.encode("utf-8"))
            await _pipe_state.process.stdin.drain()
        except Exception:
            _rpc_pending.pop(rid, None)
            raise

    try:
        result = await asyncio.wait_for(fut, timeout=timeout)
        return result
    except asyncio.TimeoutError:
        _rpc_pending.pop(rid, None)
        raise RuntimeError(f"adapter_rpc timeout: method={method} id={rid} after {timeout}s")


async def terminate_adapter_shell() -> bool:
    """Kill the active workbench adapter shell and clean up pipe/reader state.

    Returns True if a shell was terminated, False if nothing was running.
    Safe to call even if no adapter is active.
    """
    global _active_shell_id, _pipe_state, _stdout_reader_task, _rpc_counter, _rpc_write_lock

    if not _active_shell_id:
        return False

    try:
        mgr = await get_manager()
        await mgr.terminate_shell(_active_shell_id, force=True)
        print(f"[adapter_shell_mgr] terminated adapter shell {_active_shell_id}", flush=True)
    except Exception as exc:
        log.warning("[adapter_shell_mgr] terminate error: %s", exc)

    _active_shell_id = None
    _pipe_state = None
    if _stdout_reader_task and not _stdout_reader_task.done():
        _stdout_reader_task.cancel()
    _stdout_reader_task = None
    # Clear pending RPC futures so callers don't hang
    for fut in _rpc_pending.values():
        if not fut.done():
            fut.set_exception(RuntimeError("adapter shell terminated"))
    _rpc_pending.clear()
    _rpc_counter = 0
    _rpc_write_lock = None
    return True


async def ensure_workbench_adapter_shell(project_root: str, code_server_http: str) -> ShellRecord:
    """Ensure the Node workbench adapter framework shell is running.

    This is the browser-facing control plane for read-only language intelligence:
    openFile → (hover/symbols/diagnostics) via code-server remote extension host.
    """

    global _active_shell_id, _pipe_state, _stdout_reader_task

    # Generate / validate rpc-config.json before launching the adapter.
    # The adapter reads this file synchronously on startup.
    try:
        from .extension_registry import ensure_rpc_config
        ensure_rpc_config()
    except Exception as exc:
        log.warning("[adapter] ensure_rpc_config failed: %s", exc)

    mgr = await get_manager()
    orch = Orchestrator(mgr)

    label = _label()

    if _active_shell_id:
        cached = await _get_alive(_active_shell_id)
        if cached and cached.label == label:
            if _matches_expected_port(cached):
                if _pipe_state is not None:
                    return cached
                # Pipe state lost (process restart) — kill and re-spawn for fresh pipe
                log.info("[adapter] cached shell alive but pipe lost, re-spawning")
                await mgr.terminate_shell(cached.id, force=True)
                await asyncio.sleep(1.5)  # let port 18181 release
            else:
                await mgr.terminate_shell(cached.id, force=True)
                await asyncio.sleep(1.5)
        _active_shell_id = None

    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        if _matches_expected_port(existing):
            if _pipe_state is not None:
                _active_shell_id = existing.id
                return existing
            # Pipe state lost — kill and re-spawn
            log.info("[adapter] existing shell alive but pipe lost, re-spawning")
        await mgr.terminate_shell(existing.id, force=True)
        await asyncio.sleep(1.5)  # let port 18181 release

    # IMPORTANT: adapter command path is relative to the TE2 repo, not the user's project.
    repo_root = Path(__file__).resolve().parents[3]
    project_root_abs = Path(project_root).resolve(strict=False)
    adapter_entry = (repo_root / "app" / "apps" / "file_editor_cm6" / "workbench_protocol_proxy" / "node_workbench_adapter" / "server.mjs").resolve(strict=False)
    u = urlparse(str(code_server_http))
    code_server_port = u.port or (443 if u.scheme == "https" else 80)
    remote_authority = f"localhost:{code_server_port}"

    shell = await orch.start_from_ref(
        SHELLSPEC_REF,
        base_dir=SHELLSPEC_DIR,
        ctx={
            "APP_ID": APP_ID,
            "REPO_ROOT": str(repo_root),
            "PROJECT_ROOT": str(project_root_abs),
            "PROJECT_HASH": _project_hash(str(project_root_abs)),
            "INSTANCE_ID": "primary",
            "WORKBENCH_ADAPTER_PORT": str(WORKBENCH_ADAPTER_FIXED_PORT),
            "WORKBENCH_ADAPTER_ENTRY": str(adapter_entry),
            "CODE_SERVER_HTTP": str(code_server_http),
            "REMOTE_AUTHORITY": remote_authority,
        },
        label=label,
        record_spec_id=f"service:{APP_ID}:workbench_adapter",
        wait_ready=False,  # We do our own readiness check via stdio ping
    )

    _active_shell_id = shell.id
    # Stash pipe state and start stdout reader
    mgr_inst = await get_manager()
    ps = mgr_inst.get_pipe_state(shell.id)
    if ps is not None:
        _pipe_state = ps
        if _stdout_reader_task is None or _stdout_reader_task.done():
            _stdout_reader_task = asyncio.create_task(
                _stdout_reader_loop(ps.process),
                name="adapter_stdout_reader",
            )
        log.info("[adapter] pipe state stashed, stdout reader started for shell=%s", shell.id)

        # Readiness: ping the adapter over stdio until it responds
        for attempt in range(20):
            try:
                ping_resp = await adapter_rpc("te2.ping", timeout=2.0)
                if ping_resp.get("result"):
                    print(f"[adapter_shell_mgr] stdio ping OK on attempt {attempt + 1}")
                    break
            except Exception as exc:
                print(f"[adapter_shell_mgr] stdio ping attempt {attempt + 1} failed: {exc}")
                await asyncio.sleep(0.5)
        else:
            print("[adapter_shell_mgr] stdio ping failed after 20 attempts")

        # Bootstrap: connect adapter to code-server
        try:
            print(f"[adapter_shell_mgr] calling adapter.connect proxyHttp={code_server_http} authority={remote_authority}")
            connect_resp = await adapter_rpc(
                "adapter.connect",
                {
                    "proxyHttp": code_server_http,
                    "authority": remote_authority,
                    "folder": str(project_root_abs),
                },
                timeout=15.0,
            )
            print(f"[adapter_shell_mgr] bootstrap connect resp: {connect_resp}")
        except Exception as exc:
            print(f"[adapter_shell_mgr] bootstrap adapter.connect FAILED: {exc}")
    else:
        log.warning("[adapter] no pipe state for shell=%s — stdio RPC unavailable", shell.id)
    return shell
