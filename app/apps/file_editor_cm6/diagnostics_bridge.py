"""WBA backend event relay for Explorer/backend projections.

This module owns:

- Node WBA ``/ws`` event intake for backend-owned projections
- workbench IPC watcher events -> workspace event bus
- WBA-normalized diagnostics -> Explorer/problems diagnostics detail

Editor diagnostics consume the direct ``/wba`` Socket.IO lane in the editor
frontend and should not be routed through this Python relay.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from importlib import import_module
from typing import Awaitable, Callable, cast
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

ADAPTER_PORT = 18181
DIAG_CACHE_MAX = 500

JsonObject = dict[str, object]
Marker = JsonObject
DiagEntry = JsonObject
DiagCacheKey = tuple[str, str]
AdapterRpc = Callable[[str, JsonObject | None, float], Awaitable[JsonObject]]


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _json_object_list(value: object) -> list[JsonObject]:
    if not isinstance(value, list):
        return []
    result: list[JsonObject] = []
    for item in cast(list[object], value):
        if isinstance(item, dict):
            result.append(_json_object(cast(object, item)))
    return result


def _marker_list(value: object) -> list[Marker]:
    return _json_object_list(value)


def _int_value(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int | float | str):
        try:
            return int(value)
        except ValueError:
            return default
    return default


# Server-side diagnostics cache: (abs_path, owner) -> {ts_ms, owner, path, markers, type}
_diag_cache: dict[DiagCacheKey, DiagEntry] = {}

# Background task handle
_bridge_task: asyncio.Task[None] | None = None
_bridge_running = False

# ENOSPC dedup: only forward to frontend once per bridge session.
# Resets in stop_bridge() so each project switch gets a fresh allowance.
# The sidecar mode check alone isn't enough because mode defaults to "ipc" on first event.
# Once forwarded, the flag stays true until stop_bridge() resets it on project switch.
_enospc_forwarded = False


def is_bridge_active() -> bool:
    """Return True if the WBA backend relay listener is active."""
    return _bridge_running and _bridge_task is not None and not _bridge_task.done()


def _abs_path_from_vscode_uri(raw: object) -> str:
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
        from .stores import get_history_store

        module = import_module("app.apps.file_editor_cm6.workbench_adapter_shell_manager")
        adapter_rpc = cast(AdapterRpc, module.__dict__["adapter_rpc"])
        project = get_history_store().get_active_project()
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
            30,
        )
        return True
    except Exception as exc:
        logger.debug("[diag_bridge] nudge failed: %s", exc)
        return False


def _process_diagnostics_update(params: JsonObject) -> list[DiagEntry]:
    """Process a WBA-normalized diagnostics/update event for Explorer."""
    items = _json_object_list(params.get("items"))
    if not items:
        return []

    owner = str(params.get("owner", "unknown"))
    ts_ms = int(time.time() * 1000)
    result: list[DiagEntry] = []

    for item in items:
        uri = item.get("uri", "")
        abs_path = _abs_path_from_vscode_uri(uri)
        if not abs_path:
            continue
        markers = _marker_list(item.get("markers", []))

        entry: DiagEntry = {
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
        oldest_key = min(_diag_cache, key=lambda k: _int_value(_diag_cache[k].get("ts_ms")))
        del _diag_cache[oldest_key]

    return result


# ── Debounce state for Explorer/problems emission ───────────────────
# Trailing-edge debounce: once a timer starts, it runs to completion.
# New events during the window just mark dirty so the timer re-fires
# instead of cancelling/restarting (which starves emission during bursts
# like pyright's clear-then-re-emit cycle).
_diag_emit_task: asyncio.Task[None] | None = None
_diag_emit_dirty: bool = False
_DIAG_EMIT_DEBOUNCE_S = 0.3


async def _emit_diagnostics_to_explorer_and_ui(entries: list[DiagEntry]) -> None:
    """Debounced: aggregate full _diag_cache and emit to Explorer/problems."""
    global _diag_emit_task, _diag_emit_dirty
    _diag_emit_dirty = True
    # If a timer is already running, let it fire — it will see dirty and re-loop.
    if _diag_emit_task and not _diag_emit_task.done():
        return
    _diag_emit_task = asyncio.ensure_future(_emit_diagnostics_debounced())


async def _emit_diagnostics_debounced() -> None:
    """Wait for debounce window, then emit aggregated diagnostics.
    Re-fires if new events arrived during the wait (trailing edge)."""
    global _diag_emit_dirty
    while _diag_emit_dirty:
        _diag_emit_dirty = False
        await asyncio.sleep(_DIAG_EMIT_DEBOUNCE_S)
    try:
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
    summary_rel: dict[str, dict[str, int]] = {}   # rel_path -> {errors, warnings}
    detail_abs: dict[str, list[object]] = {}      # abs_path -> [marker, ...]

    for (abs_path, _owner), entry in _diag_cache.items():
        markers = _marker_list(entry.get("markers", []))
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
            sev = _int_value(m.get("severity", 0))
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


async def _adapter_ws_loop(_sio: object) -> None:
    """Connect to Node WBA /ws and project backend-owned events."""
    del _sio
    import websockets

    url = f"ws://127.0.0.1:{ADAPTER_PORT}/ws"
    backoff = 1.0

    while _bridge_running:
        try:
            async with websockets.connect(url, open_timeout=10, close_timeout=5) as ws:
                logger.info("[wba_relay] connected to adapter ws %s", url)
                backoff = 1.0  # reset on successful connect

                async for raw in ws:
                    try:
                        decoded = cast(object, json.loads(str(raw)))
                        msg = _json_object(decoded)
                    except (json.JSONDecodeError, TypeError):
                        continue

                    if msg.get("method") != "te2.event":
                        continue

                    ev = _json_object(msg.get("params"))
                    if not ev:
                        continue
                    ev_type = str(ev.get("type") or "")

                    # Adapter readiness flows through the editor RPC adapter-state lane.
                    if ev_type == "adapter/ready":
                        continue

                    # Forward workbench IPC watcher events to backend workspace events.
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
                            watcher = _json_object(sc.dump_raw().get("watcher", {}))
                            watcher_mode = str(watcher.get("mode", "ipc"))
                            if watcher_mode != "ipc":
                                print(f"[wba_relay] watcher/enospc suppressed (mode={watcher_mode})", flush=True)
                                _enospc_forwarded = True
                                continue
                        except Exception:
                            pass
                        _enospc_forwarded = True
                        try:
                            from .workspace_events import publish_watcher_error
                            payload: JsonObject = {
                                "message": str(ev.get("message", "Inotify limit reached (ENOSPC)")),
                                "limit": 524288,
                            }
                            await publish_watcher_error(
                                proj,
                                payload,
                            )
                            print(f"[wba_relay] watcher/enospc forwarded (once)", flush=True)
                        except Exception as exc:
                            print(f"[wba_relay] watcher/enospc emit FAIL: {exc}", flush=True)
                        continue

                    if ev_type == "watcher/fileChanges":
                        try:
                            changes = _json_object_list(ev.get("changes", []))
                            # Get project root for abs→rel conversion
                            try:
                                from .explorer.services.file_ops import get_project_root
                                proj = str(get_project_root())
                            except Exception:
                                proj = ""
                            created: list[str] = []
                            changed: list[str] = []
                            deleted: list[str] = []
                            created_abs: list[str] = []
                            changed_abs: list[str] = []
                            deleted_abs: list[str] = []
                            for c in changes:
                                p = str(c.get("path", ""))
                                t = _int_value(c.get("type", 0))
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
                                    from .workspace_events import publish_file_change_event

                                    await publish_file_change_event(
                                        proj,
                                        created_abs=created_abs,
                                        changed_abs=changed_abs,
                                        deleted_abs=deleted_abs,
                                    )
                                except Exception:
                                    pass
                                print(f"[wba_relay] watcher/fileChanges forwarded ({total} paths)", flush=True)
                        except Exception as exc:
                            print(f"[wba_relay] watcher/fileChanges emit FAIL: {exc}", flush=True)
                        continue

                    if ev_type != "diagnostics/update":
                        continue

                    entries = _process_diagnostics_update(ev)
                    print(f"[wba_relay] diagnostics/update rx {len(entries)} entries, paths={[e.get('path','?') for e in entries]}", flush=True)

                    # Emit WBA-normalized diagnostics to Explorer/problems only.
                    try:
                        await _emit_diagnostics_to_explorer_and_ui(entries)
                    except Exception as exc:
                        print(f"[wba_relay] explorer/problems emit FAIL: {exc}", flush=True)
                    continue

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.debug("[wba_relay] adapter ws error: %s, reconnecting in %.0fs", exc, backoff)

        if not _bridge_running:
            break
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 30.0)


def start_bridge(sio: object) -> None:
    """Start the background WBA backend relay task. Safe to call multiple times."""
    global _bridge_task, _bridge_running

    if _bridge_task and not _bridge_task.done():
        return  # already running

    _bridge_running = True
    _bridge_task = asyncio.ensure_future(_adapter_ws_loop(sio))


def stop_bridge() -> None:
    """Stop the background relay task and clear stale projected diagnostics."""
    global _bridge_running, _bridge_task, _enospc_forwarded, _diag_cache
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
