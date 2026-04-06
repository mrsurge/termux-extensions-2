import hashlib
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
import asyncio
import json
import logging

from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.record import ShellRecord

APP_ID = "file_editor_cm6"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "workbench_adapter.yaml#workbench-adapter"

WORKBENCH_ADAPTER_FIXED_PORT = 18181

log = logging.getLogger("workbench_adapter_shell_manager")

_active_shell_id: Optional[str] = None
_rpc_counter: int = 0
_rpc_pending: dict[int, asyncio.Future] = {}
_stdout_reader_task: Optional[asyncio.Task] = None
_stdout_bytes_queue: Optional[asyncio.Queue[bytes]] = None
_stdout_subscription_shell_id: Optional[str] = None
_rpc_write_lock: Optional[asyncio.Lock] = None

# Adapter lifecycle state — broadcast to all UI IPC clients on change.
_adapter_state: dict = {"status": "idle", "project": None, "error": None}


def get_adapter_state() -> dict:
    """Return a copy of the current adapter lifecycle state."""
    return dict(_adapter_state)


async def _broadcast_adapter_state() -> None:
    """Push current adapter state to all UI IPC clients."""
    try:
        from .ui_ipc.ui_ipc_socketio import UI_IPC_SIO
        await UI_IPC_SIO.emit(
            "ui_event",
            {"type": "adapter_state", **_adapter_state},
            namespace="/ui_ipc",
            room="ui_ipc",
        )
    except Exception as exc:
        log.warning("[adapter_state] broadcast failed: %s", exc)


def _set_adapter_state(status: str, project: str = None, error: str = None) -> None:
    """Update state dict. Caller must await _broadcast_adapter_state() after."""
    _adapter_state["status"] = status
    _adapter_state["project"] = project
    _adapter_state["error"] = error


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


def _fail_pending_rpcs(message: str) -> None:
    for fut in list(_rpc_pending.values()):
        if not fut.done():
            fut.set_exception(RuntimeError(message))
    _rpc_pending.clear()


async def _clear_stdout_subscription() -> None:
    global _stdout_reader_task, _stdout_bytes_queue, _stdout_subscription_shell_id

    task = _stdout_reader_task
    queue = _stdout_bytes_queue
    shell_id = _stdout_subscription_shell_id

    _stdout_reader_task = None
    _stdout_bytes_queue = None
    _stdout_subscription_shell_id = None

    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    if queue is not None and shell_id:
        try:
            mgr = await get_manager()
            await mgr.unsubscribe_output_bytes(shell_id, queue)
        except Exception as exc:
            log.debug("[adapter_stdio] unsubscribe failed shell=%s: %s", shell_id, exc)


async def _ensure_stdout_subscription(shell_id: str) -> None:
    global _stdout_reader_task, _stdout_bytes_queue, _stdout_subscription_shell_id

    if (
        _stdout_subscription_shell_id == shell_id
        and _stdout_bytes_queue is not None
        and _stdout_reader_task is not None
        and not _stdout_reader_task.done()
    ):
        return

    await _clear_stdout_subscription()

    mgr = await get_manager()
    queue = await mgr.subscribe_output_bytes(shell_id)
    _stdout_bytes_queue = queue
    _stdout_subscription_shell_id = shell_id
    _stdout_reader_task = asyncio.create_task(
        _stdout_reader_loop(shell_id, queue),
        name="adapter_stdout_reader",
    )


async def _ensure_live_adapter_io(shell_id: str) -> bool:
    record = await _get_alive(shell_id)
    if record is None:
        return False

    mgr = await get_manager()
    try:
        caps = await mgr.get_shell_capabilities(record)
    except Exception as exc:
        log.warning("[adapter] capability check failed shell=%s: %s", shell_id, exc)
        return False

    if (
        caps.get("backend") != "pipe"
        or not caps.get("stdin_write")
        or not caps.get("stdout_subscribe_bytes")
    ):
        log.warning("[adapter] shell=%s lacks live pipe capabilities: %s", shell_id, caps)
        return False

    try:
        await _ensure_stdout_subscription(shell_id)
    except Exception as exc:
        log.warning("[adapter] stdout subscription failed shell=%s: %s", shell_id, exc)
        return False

    return True


async def _stdout_reader_loop(shell_id: str, queue: asyncio.Queue[bytes]) -> None:
    """Read adapter stdout chunks from FWS, route RPC responses, and log the rest."""
    global _stdout_reader_task

    RPC_PREFIX = b"<<<RPC>>> "
    PUSH_PREFIX = b"<<<PUSH>>> "
    buf = b""
    try:
        while True:
            chunk = await queue.get()
            if not chunk:
                continue
            buf += chunk
            while b"\n" in buf:
                line_bytes, buf = buf.split(b"\n", 1)
                if line_bytes.endswith(b"\r"):
                    line_bytes = line_bytes[:-1]
                if line_bytes.startswith(RPC_PREFIX):
                    payload = line_bytes[len(RPC_PREFIX):].decode("utf-8", errors="replace")
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
                elif line_bytes.startswith(PUSH_PREFIX):
                    payload = line_bytes[len(PUSH_PREFIX):].decode("utf-8", errors="replace")
                    try:
                        obj = json.loads(payload)
                        asyncio.create_task(_handle_push_event(obj))
                    except json.JSONDecodeError:
                        log.warning("[adapter_stdio] bad PUSH JSON: %s", payload[:200])
                else:
                    line = line_bytes.decode("utf-8", errors="replace")
                    if line.startswith("[rpc-config]"):
                        print(f"[adapter_stdout] {line[:500]}", flush=True)
                    log.debug("[adapter_stdout] %s", line[:500])
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        log.error("[adapter_stdio] reader crashed shell=%s: %s", shell_id, exc)
        _fail_pending_rpcs("adapter stdout reader crashed")
    finally:
        if _stdout_reader_task is asyncio.current_task():
            _stdout_reader_task = None


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

    if not _active_shell_id:
        raise RuntimeError("Adapter pipe not available — shell not started")

    global _rpc_write_lock
    if _rpc_write_lock is None:
        _rpc_write_lock = asyncio.Lock()

    async with _rpc_write_lock:
        shell_id = _active_shell_id
        if not shell_id:
            raise RuntimeError("Adapter pipe not available — shell not started")

        if not await _ensure_live_adapter_io(shell_id):
            raise RuntimeError("Adapter pipe not available — shell missing live pipe capabilities")

        mgr = await get_manager()
        _rpc_counter += 1
        rid = _rpc_counter
        msg = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            msg["params"] = params

        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        _rpc_pending[rid] = fut

        line = json.dumps(msg) + "\n"
        try:
            await mgr.write_to_pipe(shell_id, line)
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
    global _active_shell_id, _rpc_counter, _rpc_write_lock

    if not _active_shell_id:
        return False

    await _clear_stdout_subscription()

    try:
        mgr = await get_manager()
        await mgr.terminate_shell(_active_shell_id, force=True)
        print(f"[adapter_shell_mgr] terminated adapter shell {_active_shell_id}", flush=True)
    except Exception as exc:
        log.warning("[adapter_shell_mgr] terminate error: %s", exc)

    _active_shell_id = None
    # Clear pending RPC futures so callers don't hang
    _fail_pending_rpcs("adapter shell terminated")
    _rpc_counter = 0
    _rpc_write_lock = None
    _set_adapter_state("idle")
    try:
        await _broadcast_adapter_state()
    except Exception:
        pass
    return True


async def ensure_workbench_adapter_shell(project_root: str, code_server_http: str) -> ShellRecord:
    """Ensure the Node workbench adapter framework shell is running.

    This is the browser-facing control plane for read-only language intelligence:
    openFile → (hover/symbols/diagnostics) via code-server remote extension host.
    """

    global _active_shell_id

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
                if await _ensure_live_adapter_io(cached.id):
                    if _adapter_state["status"] != "ready":
                        _set_adapter_state("ready", project=project_root)
                        await _broadcast_adapter_state()
                    # Resync: replay cached provider registrations so late-joining
                    # clients receive semantic tokens legends, etc.
                    try:
                        await adapter_rpc("te2.resync", timeout=5.0)
                    except Exception:
                        pass
                    return cached
                # Live pipe capabilities lost (process restart or FWS owner change) — re-spawn.
                log.info("[adapter] cached shell alive but live pipe unavailable, re-spawning")
                await _clear_stdout_subscription()
                await mgr.terminate_shell(cached.id, force=True)
                await asyncio.sleep(1.5)  # let port 18181 release
            else:
                await _clear_stdout_subscription()
                await mgr.terminate_shell(cached.id, force=True)
                await asyncio.sleep(1.5)
        _active_shell_id = None

    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        if _matches_expected_port(existing):
            if await _ensure_live_adapter_io(existing.id):
                _active_shell_id = existing.id
                try:
                    await adapter_rpc("te2.resync", timeout=5.0)
                except Exception:
                    pass
                return existing
            # Live pipe capabilities lost — kill and re-spawn.
            log.info("[adapter] existing shell alive but live pipe unavailable, re-spawning")
        await _clear_stdout_subscription()
        await mgr.terminate_shell(existing.id, force=True)
        await asyncio.sleep(1.5)  # let port 18181 release

    # IMPORTANT: adapter command path is relative to the TE2 repo, not the user's project.
    repo_root = Path(__file__).resolve().parents[3]
    project_root_abs = Path(project_root).resolve(strict=False)
    adapter_entry = (repo_root / "app" / "apps" / "file_editor_cm6" / "workbench_protocol_proxy" / "node_workbench_adapter" / "server.mjs").resolve(strict=False)
    u = urlparse(str(code_server_http))
    code_server_port = u.port or (443 if u.scheme == "https" else 80)
    remote_authority = f"localhost:{code_server_port}"

    _set_adapter_state("starting", project=project_root)
    await _broadcast_adapter_state()

    try:
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
    except Exception as exc:
        _set_adapter_state("error", project=project_root, error=str(exc))
        await _broadcast_adapter_state()
        raise

    _active_shell_id = shell.id
    if await _ensure_live_adapter_io(shell.id):
        log.info("[adapter] live pipe subscription started for shell=%s", shell.id)
        # Readiness: ping the adapter over stdio until it responds
        ping_ok = False
        for attempt in range(20):
            try:
                ping_resp = await adapter_rpc("te2.ping", timeout=2.0)
                if ping_resp.get("result"):
                    print(f"[adapter_shell_mgr] stdio ping OK on attempt {attempt + 1}")
                    ping_ok = True
                    break
            except Exception as exc:
                print(f"[adapter_shell_mgr] stdio ping attempt {attempt + 1} failed: {exc}")
                await asyncio.sleep(0.5)

        if not ping_ok:
            print("[adapter_shell_mgr] stdio ping failed after 20 attempts")
            _set_adapter_state("error", project=project_root, error="Adapter ping timeout")
            await _broadcast_adapter_state()
            return shell

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
            # Resync: replay cached provider registrations so late-joining
            # frontends receive semantic tokens legends etc.
            try:
                await adapter_rpc("te2.resync", timeout=5.0)
            except Exception:
                pass
            _set_adapter_state("ready", project=project_root)
            await _broadcast_adapter_state()
        except Exception as exc:
            print(f"[adapter_shell_mgr] bootstrap adapter.connect FAILED: {exc}")
            _set_adapter_state("error", project=project_root, error=str(exc))
            await _broadcast_adapter_state()
    else:
        log.warning("[adapter] no live pipe capabilities for shell=%s — stdio RPC unavailable", shell.id)
        _set_adapter_state("error", project=project_root, error="No live pipe capabilities")
        await _broadcast_adapter_state()
    return shell
