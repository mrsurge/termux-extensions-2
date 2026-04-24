"""Diagnostics bridge: adapter WS → editor Socket.IO.

Subscribes to the workbench adapter event stream (WS on port 18181) and
forwards diagnostics/update events through the editor Socket.IO channel.

Important: we only forward diagnostics/update once the Monaco iframe tells us
it is ready to consume markers for the active open request. This eliminates a
real race where workbench diagnostics can arrive before the editor model/marker
plumbing is initialized (especially on refresh / worker restart).
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

ADAPTER_PORT = 18181
DIAG_CACHE_MAX = 500

# Server-side diagnostics cache: (abs_path, owner) -> {ts_ms, owner, path, markers, type}
_diag_cache: Dict[tuple, Dict[str, Any]] = {}

# Diagnostics gating state (single-doc model).
# The editor (Monaco iframe) emits consumer_pending/consumer_ready over Socket.IO.
_consumer_expected_path: Optional[str] = None
_consumer_expected_request_id: str = ""
_consumer_ready: bool = False
_pending_entries: list = []  # Buffered entries per-owner while consumer not ready

# Keep an sio ref so consumer_ready can flush without waiting for a new adapter frame.
_SIO_REF = None

# Background task handle
_bridge_task: Optional[asyncio.Task] = None
_bridge_running = False

# ENOSPC dedup: only forward to frontend once per bridge session.
# Resets in stop_bridge() so each project switch gets a fresh allowance.
# The sidecar mode check alone isn't enough because mode defaults to "ipc" on first event.
# Once forwarded, the flag stays true until stop_bridge() resets it on project switch.
_enospc_forwarded = False


def is_bridge_active() -> bool:
    """Return True if the diagnostics bridge WS listener is active."""
    return _bridge_running and _bridge_task is not None and not _bridge_task.done()


def _abs_path_from_vscode_uri(raw: Any) -> str:
    """Extract absolute filesystem path from a vscode-remote:// or file:// URI."""
    if not raw:
        return ""
    s = str(raw)
    if s.startswith("/") or (len(s) > 2 and s[1:3] == ":/"):
        return s
    if s.startswith("file://"):
        from urllib.parse import unquote
        return unquote(s[len("file://"):])
    if s.startswith("vscode-remote://"):
        rest = s[len("vscode-remote://"):]
        slash = rest.find("/")
        if slash == -1:
            return ""
        from urllib.parse import unquote
        return unquote(rest[slash:])
    # Fallback: try URL parse
    try:
        u = urlparse(s)
        if u.path:
            from urllib.parse import unquote
            return unquote(u.path)
    except Exception:
        pass
    return ""


async def nudge_diagnostics_for_file(abs_path: str, language_id: str = "") -> bool:
    """Ask the adapter to re-open a file, forcing the extension host to re-emit diagnostics."""
    try:
        from .workbench_adapter_shell_manager import adapter_rpc
        from .stores import _history_store
        project = _history_store.get_active_project()
        request_id = f"diag_{int(time.time() * 1000)}_nudge"
        await adapter_rpc(
            "vscode.openFile",
            {
                "path": abs_path,
                "languageId": language_id or "",
                "requestId": request_id,
                "forceRefresh": True,
                "workspaceFolder": project or "",
            },
        )
        return True
    except Exception as exc:
        logger.debug("[diag_bridge] nudge failed: %s", exc)
        return False


def _process_diagnostics_update(params: dict):
    """Process a diagnostics/update event: update cache, return normalized items."""
    items = params.get("items") if isinstance(params, dict) else None
    if not isinstance(items, list):
        return []

    owner = str(params.get("owner", "unknown"))
    ts_ms = int(time.time() * 1000)
    result = []

    for item in items:
        if not isinstance(item, dict):
            continue
        uri = item.get("uri", "")
        abs_path = _abs_path_from_vscode_uri(uri)
        if not abs_path:
            continue
        markers = item.get("markers", [])
        if not isinstance(markers, list):
            markers = []

        entry = {
            "type": "diagnostics/update",
            "ts_ms": ts_ms,
            "owner": owner,
            "path": abs_path,
            "markers": markers,
        }
        _diag_cache[(abs_path, owner)] = entry
        result.append(entry)

    # Evict oldest if cache too large
    while len(_diag_cache) > DIAG_CACHE_MAX:
        oldest_key = min(_diag_cache, key=lambda k: _diag_cache[k].get("ts_ms", 0))
        del _diag_cache[oldest_key]

    return result


def set_consumer_pending(abs_path: str, request_id: str = ""):
    """Set the expected active document and mark consumer not-ready yet."""
    global _consumer_expected_path, _consumer_expected_request_id, _consumer_ready, _pending_entries
    _consumer_expected_path = abs_path or None
    _consumer_expected_request_id = str(request_id or "")
    _consumer_ready = False
    _pending_entries = []
    try:
        print(
            f"[diag_bridge] consumer_pending path={_consumer_expected_path or '?'} request_id={_consumer_expected_request_id or '-'}",
            flush=True,
        )
    except Exception:
        pass


async def set_consumer_ready(sio, abs_path: str, request_id: str = ""):
    """Mark the consumer as ready; flush any buffered diagnostics for the expected file."""
    global _consumer_expected_path, _consumer_expected_request_id, _consumer_ready, _pending_entries
    _consumer_expected_path = abs_path or None
    _consumer_expected_request_id = str(request_id or "")
    _consumer_ready = True
    try:
        print(
            f"[diag_bridge] consumer_ready path={_consumer_expected_path or '?'} request_id={_consumer_expected_request_id or '-'} pending={len(_pending_entries)}",
            flush=True,
        )
    except Exception:
        pass

    if not _pending_entries or not _consumer_expected_path:
        return

    for pending in _pending_entries:
        if str(pending.get("path", "")) != str(_consumer_expected_path):
            continue
        try:
            await sio.emit(
                "editor:diagnostics",
                pending,
                room="file_editor_cm6",
                namespace="/editor",
            )
            print(
                f"[diag_bridge] flush OK owner={pending.get('owner','?')} path={pending.get('path','?')} markers={len(pending.get('markers',[]) or [])}",
                flush=True,
            )
        except Exception as exc:
            print(f"[diag_bridge] flush FAIL: {exc}", flush=True)
    _pending_entries = []


# ── Debounce state for explorer/problems emission ───────────────────
# Trailing-edge debounce: once a timer starts, it runs to completion.
# New events during the window just mark dirty so the timer re-fires
# instead of cancelling/restarting (which starves emission during bursts
# like pyright's clear-then-re-emit cycle).
_diag_emit_task: Optional[asyncio.Task] = None
_diag_emit_dirty: bool = False
_DIAG_EMIT_DEBOUNCE_S = 0.3


async def _emit_diagnostics_to_explorer_and_ui(entries: list):
    """Debounced: aggregate full _diag_cache and emit to explorer + problems."""
    global _diag_emit_task, _diag_emit_dirty
    _diag_emit_dirty = True
    # If a timer is already running, let it fire — it will see dirty and re-loop.
    if _diag_emit_task and not _diag_emit_task.done():
        return
    _diag_emit_task = asyncio.ensure_future(_emit_diagnostics_debounced())


async def _emit_diagnostics_debounced():
    """Wait for debounce window, then emit aggregated diagnostics.
    Re-fires if new events arrived during the wait (trailing edge)."""
    global _diag_emit_dirty
    while _diag_emit_dirty:
        _diag_emit_dirty = False
        await asyncio.sleep(_DIAG_EMIT_DEBOUNCE_S)
    try:
        from .explorer.transport.socketio_app import EXPLORER_SIO
        from .explorer.services.file_ops import get_project_root
    except Exception as exc:
        print(f"[diag_bridge] import fail for explorer emit: {exc}", flush=True)
        return

    proj = ""
    try:
        proj = str(get_project_root() or "").rstrip("/")
    except Exception:
        pass

    # Build per-file summary (rel paths) and detail (abs paths) from cache.
    summary_rel: Dict[str, Dict[str, int]] = {}   # rel_path → {errors, warnings}
    detail_abs: Dict[str, list] = {}               # abs_path → [marker, ...]

    for (abs_path, owner), entry in _diag_cache.items():
        markers = entry.get("markers") or []
        if not markers:
            continue

        # Detail: full marker objects keyed by abs path
        if abs_path not in detail_abs:
            detail_abs[abs_path] = []
        detail_abs[abs_path].extend(markers)

        # Summary: count errors/warnings, keyed by workspace-relative path
        if proj and abs_path.startswith(proj + "/"):
            rel = abs_path[len(proj) + 1:]
        else:
            rel = abs_path
        if rel not in summary_rel:
            summary_rel[rel] = {"errors": 0, "warnings": 0}
        for m in markers:
            sev = m.get("severity", 0)
            if sev == 8:       # MarkerSeverity.Error
                summary_rel[rel]["errors"] += 1
            elif sev == 4:     # MarkerSeverity.Warning
                summary_rel[rel]["warnings"] += 1

    # Prune entries with zero counts
    summary_rel = {k: v for k, v in summary_rel.items() if v["errors"] > 0 or v["warnings"] > 0}

    try:
        # Problems panel + explorer tree badges (full marker detail)
        from .workspace_events import publish_diagnostics_detail

        await publish_diagnostics_detail(proj, detail_abs)
        total_markers = sum(len(v) for v in detail_abs.values())
        print(f"[diag_bridge] emitted explorer diagnostics: {len(summary_rel)} files, {total_markers} markers", flush=True)
    except Exception as exc:
        print(f"[diag_bridge] explorer/problems emit error: {exc}", flush=True)


async def _adapter_ws_loop(sio):
    """Connect to adapter WS, listen for diagnostics, broadcast via Socket.IO."""
    import websockets

    url = f"ws://127.0.0.1:{ADAPTER_PORT}/ws"
    backoff = 1.0

    while _bridge_running:
        try:
            async with websockets.connect(url, open_timeout=10, close_timeout=5) as ws:
                logger.info("[diag_bridge] connected to adapter ws %s", url)
                backoff = 1.0  # reset on successful connect

                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except (json.JSONDecodeError, TypeError):
                        continue

                    if not isinstance(msg, dict):
                        continue
                    if msg.get("method") != "te2.event":
                        continue

                    ev = msg.get("params")
                    if not isinstance(ev, dict):
                        continue
                    ev_type = ev.get("type")

                    # Forward adapter/ready so browser knows adapter is connected.
                    if ev_type == "adapter/ready":
                        try:
                            await sio.emit(
                                "editor:adapter_ready",
                                {"ts_ms": ev.get("ts_ms", 0)},
                                room="file_editor_cm6",
                                namespace="/editor",
                            )
                            print("[diag_bridge] adapter/ready forwarded", flush=True)
                        except Exception as exc:
                            print(f"[diag_bridge] adapter/ready emit FAIL: {exc}", flush=True)
                        continue

                    # Forward file watcher events to editor and explorer SIO.
                    if ev_type == "watcher/enospc":
                        global _enospc_forwarded
                        # Suppress repeated ENOSPC — only forward once per bridge session
                        if _enospc_forwarded:
                            continue
                        # Suppress ENOSPC when user is on polling/watchexec fallback —
                        # they already know inotify is limited, that's why they switched.
                        proj = ""
                        try:
                            from .explorer.services.file_ops import get_project_root
                            from .project_sidecar import ProjectSidecar
                            proj = str(get_project_root())
                            sc = ProjectSidecar.load_or_create(proj)
                            watcher_mode = sc.data.get("watcher", {}).get("mode", "ipc")
                            if watcher_mode != "ipc":
                                print(f"[diag_bridge] watcher/enospc suppressed (mode={watcher_mode})", flush=True)
                                _enospc_forwarded = True
                                continue
                        except Exception:
                            pass
                        _enospc_forwarded = True
                        try:
                            from .workspace_events import publish_watcher_error
                            payload = {
                                "message": ev.get("message", "Inotify limit reached (ENOSPC)"),
                                "limit": 524288,
                            }
                            await publish_watcher_error(
                                proj,
                                payload,
                            )
                            print(f"[diag_bridge] watcher/enospc forwarded (once)", flush=True)
                        except Exception as exc:
                            print(f"[diag_bridge] watcher/enospc emit FAIL: {exc}", flush=True)
                        continue

                    if ev_type == "watcher/fileChanges":
                        try:
                            changes = ev.get("changes", [])
                            # Get project root for abs→rel conversion
                            try:
                                from .explorer.services.file_ops import get_project_root
                                proj = str(get_project_root())
                            except Exception:
                                proj = ""
                            created, changed, deleted = [], [], []
                            created_abs, changed_abs, deleted_abs = [], [], []
                            for c in changes:
                                p = c.get("path", "") if isinstance(c, dict) else ""
                                t = c.get("type", 0) if isinstance(c, dict) else 0
                                if not p:
                                    continue
                                # Convert absolute path to relative
                                rel = p
                                if proj and p.startswith(proj):
                                    rel = p[len(proj):].lstrip("/") or "."
                                # type: 0=UPDATED, 1=ADDED, 2=DELETED (VS Code FileChangeType)
                                if t == 1:
                                    created.append(rel)
                                    created_abs.append(p)
                                elif t == 2:
                                    deleted.append(rel)
                                    deleted_abs.append(p)
                                else:
                                    changed.append(rel)
                                    changed_abs.append(p)
                            total = len(created) + len(changed) + len(deleted)
                            if total > 0:
                                try:
                                    from .workspace_events import publish_file_change_batch

                                    await publish_file_change_batch(
                                        proj,
                                        created_abs=created_abs,
                                        changed_abs=changed_abs,
                                        deleted_abs=deleted_abs,
                                    )
                                except Exception:
                                    pass
                                print(f"[diag_bridge] watcher/fileChanges forwarded ({total} paths)", flush=True)
                        except Exception as exc:
                            print(f"[diag_bridge] watcher/fileChanges emit FAIL: {exc}", flush=True)
                        continue

                    if ev_type != "diagnostics/update":
                        continue

                    entries = _process_diagnostics_update(ev)
                    print(f"[diag_bridge] rx {len(entries)} entries, paths={[e.get('path','?') for e in entries]}", flush=True)

                    # ── Emit to explorer + problems panel (pipe-direct, no iframe) ──
                    try:
                        await _emit_diagnostics_to_explorer_and_ui(entries)
                    except Exception as exc:
                        print(f"[diag_bridge] explorer/problems emit FAIL: {exc}", flush=True)

                    for entry in entries:
                        try:
                            path = str(entry.get("path", ""))
                            # Gate forwarding until the editor consumer is ready for the active open.
                            if _consumer_expected_path and path == str(_consumer_expected_path):
                                if _consumer_ready:
                                    await sio.emit(
                                        "editor:diagnostics",
                                        entry,
                                        room="file_editor_cm6",
                                        namespace="/editor",
                                    )
                                    print(
                                        f"[diag_bridge] emit OK path={path} markers={len(entry.get('markers',[]) or [])}",
                                        flush=True,
                                    )
                                else:
                                    # Buffer per-owner entries for the expected file.
                                    global _pending_entries
                                    # Replace any existing entry for the same owner.
                                    _pending_entries = [e for e in _pending_entries if e.get("owner") != entry.get("owner")]
                                    _pending_entries.append(entry)
                                    print(
                                        f"[diag_bridge] buffer owner={entry.get('owner','?')} path={path} markers={len(entry.get('markers',[]) or [])} buffered={len(_pending_entries)}",
                                        flush=True,
                                    )
                            else:
                                # Not the active doc (single-doc model): do not forward to the editor.
                                pass
                        except Exception as exc:
                            print(f"[diag_bridge] emit/buffer FAIL: {exc}", flush=True)

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.debug("[diag_bridge] adapter ws error: %s, reconnecting in %.0fs", exc, backoff)

        if not _bridge_running:
            break
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 30.0)


def start_bridge(sio):
    """Start the background diagnostics bridge task. Safe to call multiple times."""
    global _bridge_task, _bridge_running
    global _SIO_REF

    _SIO_REF = sio

    if _bridge_task and not _bridge_task.done():
        return  # already running

    _bridge_running = True
    _bridge_task = asyncio.ensure_future(_adapter_ws_loop(sio))


def stop_bridge():
    """Stop the background bridge task and clear stale diagnostics state."""
    global _bridge_running, _bridge_task, _enospc_forwarded, _diag_cache
    global _consumer_expected_path, _consumer_expected_request_id, _consumer_ready, _pending_entries
    global _diag_emit_dirty, _diag_emit_task

    _bridge_running = False
    _enospc_forwarded = False
    _diag_emit_dirty = False
    if _diag_emit_task and not _diag_emit_task.done():
        _diag_emit_task.cancel()
    _diag_emit_task = None
    if _bridge_task and not _bridge_task.done():
        _bridge_task.cancel()
    _bridge_task = None
    # Purge the diagnostics cache so stale markers are never replayed
    # after the adapter shuts down or a project switch occurs.
    _diag_cache.clear()
    _consumer_expected_path = None
    _consumer_expected_request_id = ""
    _consumer_ready = False
    _pending_entries = []
