import hashlib
from collections import deque
from pathlib import Path
from typing import Optional, TypedDict, cast
import asyncio
import json
import logging
import time

from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.record import ShellRecord

from .code_te2_paths import code_te2_paths
from .diagnostics_latency_metrics import (
    diagnostics_latency_metrics_enabled,
    elapsed_ms,
    record_latency_event,
)

JsonObject = dict[str, object]

APP_ID = "code_te2"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "workbench_adapter.yaml#workbench-adapter"

WORKBENCH_ADAPTER_FIXED_PORT = 18181

log = logging.getLogger("workbench_adapter_shell_manager")

_active_shell_id: Optional[str] = None
_rpc_counter: int = 0
_rpc_pending: dict[int, asyncio.Future[JsonObject]] = {}
_stdout_reader_task: asyncio.Task[None] | None = None
_stdout_bytes_queue: Optional[asyncio.Queue[bytes]] = None
_stdout_subscription_shell_id: Optional[str] = None
_rpc_write_lock: Optional[asyncio.Lock] = None
_push_drain_task: asyncio.Task[None] | None = None


class PendingPush(TypedDict):
    obj: JsonObject
    diagnostics_owner: str | None
    items_by_uri: dict[str, JsonObject]
    event_count: int
    payload_bytes: int
    queued_ns: int | None


_pending_pushes: deque[PendingPush] = deque()

# Adapter lifecycle state — authoritative store for fact projection.
_adapter_state: dict[str, object] = {"status": "idle", "project": None, "error": None}


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _decode_json_object(value: str) -> JsonObject:
    return _json_object(cast(object, json.loads(value)))


def get_adapter_state() -> dict[str, object]:
    """Return a copy of the current adapter lifecycle state."""
    return dict(_adapter_state)


async def _publish_adapter_state_fact() -> None:
    """Publish the current adapter state as a backend fact."""
    try:
        from .adapter_lifecycle_events import publish_adapter_state_changed

        project_obj = _adapter_state.get("project")
        project_root = (
            str(project_obj)
            if isinstance(project_obj, str) and project_obj.strip()
            else None
        )
        await publish_adapter_state_changed(
            dict(_adapter_state),
            project_root=project_root,
            source="workbench_adapter_shell_manager",
        )
    except Exception as exc:
        log.warning("[adapter_state] fact publish failed: %s", exc)


def _set_adapter_state(status: str, project: Optional[str] = None, error: Optional[str] = None) -> None:
    """Update state dict. Caller must await _publish_adapter_state_fact() after."""
    _adapter_state["status"] = status
    _adapter_state["project"] = project
    _adapter_state["error"] = error


async def mark_adapter_workspace_switching(project_root: str) -> None:
    """Publish that the shared adapter is changing workspace roots."""
    _set_adapter_state("switching", project=str(project_root), error=None)
    await _publish_adapter_state_fact()


async def mark_adapter_workspace_ready(project_root: str) -> None:
    """Publish that the shared adapter workspace now matches project_root."""
    _set_adapter_state("ready", project=str(project_root), error=None)
    await _publish_adapter_state_fact()


async def mark_adapter_workspace_error(project_root: str, error: str) -> None:
    """Publish that the shared adapter workspace switch failed."""
    _set_adapter_state("error", project=str(project_root), error=str(error))
    await _publish_adapter_state_fact()


def _project_hash(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:8]


def _label() -> str:
    # Global instance (single active project invariant is enforced in TE2).
    return f"workbench_adapter:{APP_ID}:global"


def _expected_port() -> str:
    return str(WORKBENCH_ADAPTER_FIXED_PORT)


def _matches_expected_target(record: ShellRecord, code_server_socket_path: Optional[str]) -> bool:
    env = _json_object(record.env_overrides)
    if str(env.get("TE2_ADAPTER_PORT") or "").strip() != _expected_port():
        return False
    env_socket = str(env.get("TE2_CODE_SERVER_SOCKET") or "").strip()
    expected_socket = str(code_server_socket_path or "").strip()
    return env_socket == expected_socket


async def _get_alive(shell_id: str) -> Optional[ShellRecord]:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def get_shell_record(shell_id: str) -> Optional[ShellRecord]:
    """Return a shell record by id for route-level boot-record reuse."""
    mgr = await get_manager()
    return await mgr.get_shell(shell_id)


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

    await _clear_pending_pushes()

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
                        obj = _decode_json_object(payload)
                        rid_obj = obj.get("id")
                        rid = rid_obj if isinstance(rid_obj, int) else None
                        fut = _rpc_pending.pop(rid, None) if rid is not None else None
                        if fut and not fut.done():
                            fut.set_result(obj)
                        else:
                            log.debug("[adapter_stdio] unmatched RPC response id=%s", rid)
                    except json.JSONDecodeError:
                        log.warning("[adapter_stdio] bad RPC JSON: %s", payload[:200])
                elif line_bytes.startswith(PUSH_PREFIX):
                    payload = line_bytes[len(PUSH_PREFIX):].decode("utf-8", errors="replace")
                    try:
                        obj = _decode_json_object(payload)
                        _queue_push(
                            obj,
                            payload_bytes=len(line_bytes) - len(PUSH_PREFIX),
                        )
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


def _te2_push_event(obj: JsonObject) -> JsonObject | None:
    event_name = obj.get("event")
    method_name = obj.get("method")
    if event_name != "te2.event" and method_name != "te2.event":
        return None
    return _json_object(obj.get("params", obj.get("payload")))


def _queue_push(obj: JsonObject, *, payload_bytes: int) -> None:
    """Preserve push order while coalescing contiguous diagnostics updates."""
    global _push_drain_task

    event = _te2_push_event(obj)
    is_diagnostics = (
        event is not None
        and str(event.get("type") or "") == "diagnostics/update"
    )
    owner = str(event.get("owner") or "unknown") if is_diagnostics and event else None
    batch: PendingPush | None = None
    if (
        owner is not None
        and _pending_pushes
        and _pending_pushes[-1]["diagnostics_owner"] == owner
    ):
        batch = _pending_pushes[-1]
    if batch is None:
        batch = PendingPush(
            obj=dict(obj),
            diagnostics_owner=owner,
            items_by_uri={},
            event_count=0,
            payload_bytes=0,
            queued_ns=(
                time.perf_counter_ns()
                if owner is not None and diagnostics_latency_metrics_enabled()
                else None
            ),
        )
        _pending_pushes.append(batch)

    batch["event_count"] += 1
    batch["payload_bytes"] += payload_bytes
    if owner is not None and event is not None:
        queued_obj: JsonObject = {
            "event": "te2.event",
            "params": dict(event),
        }
        batch["obj"] = queued_obj
        raw_items = event.get("items")
        if isinstance(raw_items, list):
            items = cast(list[object], raw_items)
            for index, raw_item in enumerate(items):
                item = _json_object(raw_item)
                if not item:
                    continue
                uri = str(item.get("uri") or "")
                item_key = uri or f"__missing_uri__:{batch['event_count']}:{index}"
                batch["items_by_uri"][item_key] = item

    if _push_drain_task is None or _push_drain_task.done():
        _push_drain_task = asyncio.create_task(
            _drain_pushes(),
            name="adapter_push_drain",
        )


async def _drain_pushes() -> None:
    global _push_drain_task

    try:
        while _pending_pushes:
            batch = _pending_pushes.popleft()
            obj = batch["obj"]
            if batch["diagnostics_owner"] is not None:
                event = _te2_push_event(obj)
                if event is None:
                    continue
                event["items"] = list(batch["items_by_uri"].values())
                obj = {"event": "te2.event", "params": event}
            await _handle_push_event(
                obj,
                queued_ns=batch["queued_ns"],
                payload_bytes=batch["payload_bytes"],
                backlog_at_schedule=batch["event_count"],
                coalesced_events=batch["event_count"],
                coalesced_items=len(batch["items_by_uri"]),
            )
    except asyncio.CancelledError:
        pass
    finally:
        if _push_drain_task is asyncio.current_task():
            _push_drain_task = None


async def _clear_pending_pushes() -> None:
    global _push_drain_task

    task = _push_drain_task
    _push_drain_task = None
    _pending_pushes.clear()
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


async def _handle_push_event(
    obj: JsonObject,
    *,
    queued_ns: int | None = None,
    payload_bytes: int = 0,
    backlog_at_schedule: int = 0,
    coalesced_events: int = 1,
    coalesced_items: int = 0,
) -> None:
    """Consume adapter control-plane push frames from the existing FWS pipe."""
    event = _te2_push_event(obj)
    if event is not None:
        if not event:
            log.debug("[adapter_stdio] ignored empty te2.event push")
            return
        event_type = str(event.get("type") or "")
        dispatch_started_ns = time.perf_counter_ns()
        if event_type == "diagnostics/update":
            record_latency_event(
                "diagnostics_push_started",
                {
                    "payload_bytes": payload_bytes,
                    "backlog_at_schedule": backlog_at_schedule,
                    "active_push_tasks": 1,
                    "coalesced_events": coalesced_events,
                    "coalesced_items": coalesced_items,
                    "schedule_delay_ms": elapsed_ms(queued_ns) if queued_ns is not None else 0.0,
                },
            )
        try:
            from .wba_event_bridge import dispatch_wba_pipe_event

            await dispatch_wba_pipe_event(event)
        except Exception as exc:
            log.warning("[adapter_stdio] te2.event push handling failed: %s", exc)
        finally:
            if event_type == "diagnostics/update":
                record_latency_event(
                    "diagnostics_push_finished",
                    {
                        "payload_bytes": payload_bytes,
                        "backlog_at_schedule": backlog_at_schedule,
                        "active_push_tasks": 1,
                        "coalesced_events": coalesced_events,
                        "coalesced_items": coalesced_items,
                        "dispatch_ms": elapsed_ms(dispatch_started_ns),
                    },
                )
        return

    if obj and log.isEnabledFor(logging.DEBUG):
        log.debug("[push] ignored legacy adapter push frame; direct WBA socket owns editor notifications")


async def adapter_rpc(method: str, params: JsonObject | None = None, timeout: float = 30.0) -> JsonObject:
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
        msg: JsonObject = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            msg["params"] = params

        fut: asyncio.Future[JsonObject] = asyncio.get_event_loop().create_future()
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
        await _publish_adapter_state_fact()
    except Exception:
        pass
    return True


async def ensure_workbench_adapter_shell(
    project_root: str,
    code_server_http: str,
    code_server_socket_path: Optional[str] = None,
) -> ShellRecord:
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
            if _matches_expected_target(cached, code_server_socket_path):
                if await _ensure_live_adapter_io(cached.id):
                    if _adapter_state["status"] != "ready":
                        _set_adapter_state("ready", project=project_root)
                        await _publish_adapter_state_fact()
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
        if _matches_expected_target(existing, code_server_socket_path):
            if await _ensure_live_adapter_io(existing.id):
                _active_shell_id = existing.id
                return existing
            # Live pipe capabilities lost — kill and re-spawn.
            log.info("[adapter] existing shell alive but live pipe unavailable, re-spawning")
        await _clear_stdout_subscription()
        await mgr.terminate_shell(existing.id, force=True)
        await asyncio.sleep(1.5)  # let port 18181 release

    # IMPORTANT: adapter command path is relative to the TE2 repo, not the user's project.
    repo_root = Path(__file__).resolve().parents[3]
    project_root_abs = Path(project_root).resolve(strict=False)
    adapter_entry = (repo_root / "app" / "apps" / "code_te2" / "workbench_protocol_proxy" / "node_workbench_adapter" / "dist" / "server" / "server.mjs").resolve(strict=False)
    if not code_server_socket_path:
        raise RuntimeError("code-server UDS socket path is required")
    remote_authority = "localhost"
    paths = code_te2_paths()

    _set_adapter_state("starting", project=project_root)
    await _publish_adapter_state_fact()

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
                "CODE_SERVER_SOCKET": str(code_server_socket_path or ""),
                "CODE_SERVER_EXTENSIONS_JSON": str(
                    paths.code_server_extensions_manifest_path
                ),
                "CODE_SERVER_USER_SETTINGS": str(
                    paths.code_server_user_settings_path
                ),
                "CODE_SERVER_RPC_CONFIG": str(paths.code_server_rpc_config_path),
                "REMOTE_AUTHORITY": remote_authority,
            },
            label=label,
            record_spec_id=f"service:{APP_ID}:workbench_adapter",
            wait_ready=False,  # We do our own readiness check via stdio ping
        )
    except Exception as exc:
        _set_adapter_state("error", project=project_root, error=str(exc))
        await _publish_adapter_state_fact()
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
            await _publish_adapter_state_fact()
            return shell

        # Bootstrap: connect adapter to code-server
        try:
            print(
                "[adapter_shell_mgr] calling adapter.connect "
                f"proxyHttp={code_server_http} "
                f"socket={'set' if code_server_socket_path else 'unset'} "
                f"authority={remote_authority}"
            )
            connect_params: JsonObject = {
                "proxyHttp": code_server_http,
                "authority": remote_authority,
                "folder": str(project_root_abs),
            }
            if code_server_socket_path:
                connect_params["codeServerSocketPath"] = code_server_socket_path
            connect_resp = await adapter_rpc(
                "adapter.connect",
                connect_params,
                timeout=15.0,
            )
            print(f"[adapter_shell_mgr] bootstrap connect resp: {connect_resp}")
            _set_adapter_state("ready", project=project_root)
            await _publish_adapter_state_fact()
        except Exception as exc:
            print(f"[adapter_shell_mgr] bootstrap adapter.connect FAILED: {exc}")
            _set_adapter_state("error", project=project_root, error=str(exc))
            await _publish_adapter_state_fact()
    else:
        log.warning("[adapter] no live pipe capabilities for shell=%s — stdio RPC unavailable", shell.id)
        _set_adapter_state("error", project=project_root, error="No live pipe capabilities")
        await _publish_adapter_state_fact()
    return shell
