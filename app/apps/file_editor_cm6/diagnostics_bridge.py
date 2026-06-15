"""WBA diagnostics projection for Explorer/backend surfaces.

This module owns:

- WBA-normalized diagnostics -> Explorer/problems diagnostics detail

Editor diagnostics consume the direct ``/wba`` Socket.IO lane in the editor
frontend and should not be routed through this Python relay.
"""

from __future__ import annotations

import asyncio
import logging
import time
from importlib import import_module
from pathlib import Path
from typing import Awaitable, Callable, cast
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

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
_active_project_root: str | None = None
_active_project_generation: int | None = None

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


def _normalize_project_path(project_path: str | Path) -> str:
    try:
        return str(Path(project_path).expanduser().resolve(strict=False))
    except Exception:
        return str(project_path or "").strip()


def _current_backend_project_root() -> str | None:
    try:
        from .explorer.services.file_ops import get_project_root

        return _normalize_project_path(get_project_root())
    except Exception:
        return None


def _diagnostics_project_root() -> str | None:
    current = _current_backend_project_root()
    if current:
        return current
    return _active_project_root


def _is_under_project(abs_path: str, project_root: str) -> bool:
    if not abs_path or not project_root:
        return False
    try:
        path = Path(abs_path).expanduser().resolve(strict=False)
        root = Path(project_root).expanduser().resolve(strict=False)
        if path == root:
            return True
        path.relative_to(root)
        return True
    except Exception:
        return False


def _prune_cache_to_project(project_root: str) -> int:
    stale_keys = [
        key
        for key in _diag_cache
        if not _is_under_project(key[0], project_root)
    ]
    for key in stale_keys:
        _diag_cache.pop(key, None)
    return len(stale_keys)


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


def _process_diagnostics_update(
    params: JsonObject,
    *,
    project_root: str,
) -> tuple[list[DiagEntry], int]:
    """Process a WBA-normalized diagnostics/update event for Explorer."""
    items = _json_object_list(params.get("items"))
    if not items:
        return [], 0

    owner = str(params.get("owner", "unknown"))
    ts_ms = int(time.time() * 1000)
    result: list[DiagEntry] = []
    ignored = 0

    for item in items:
        uri = item.get("uri", "")
        abs_path = _abs_path_from_vscode_uri(uri)
        if not abs_path:
            ignored += 1
            continue
        if not _is_under_project(abs_path, project_root):
            ignored += 1
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

    return result, ignored


# ── Debounce state for Explorer/problems emission ───────────────────
# Trailing-edge debounce: once a timer starts, it runs to completion.
# New events during the window just mark dirty so the timer re-fires
# instead of cancelling/restarting (which starves emission during bursts
# like pyright's clear-then-re-emit cycle).
_diag_emit_task: asyncio.Task[None] | None = None
_diag_emit_dirty: bool = False
_DIAG_EMIT_DEBOUNCE_S = 0.3


async def _emit_diagnostics_to_explorer_and_ui(project_root: str) -> None:
    """Debounced: aggregate full _diag_cache and emit to Explorer/problems."""
    global _diag_emit_task, _diag_emit_dirty
    del project_root
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
    proj = _diagnostics_project_root()
    if not proj:
        print("[diag_bridge] no active project for diagnostics emit", flush=True)
        return

    pruned = _prune_cache_to_project(proj)
    if pruned:
        print(
            f"[diag_bridge] pruned {pruned} out-of-project diagnostics for {proj}",
            flush=True,
        )

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
        if not _is_under_project(abs_path, proj):
            continue
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


async def handle_wba_diagnostics_update(ev: JsonObject) -> None:
    """Project WBA diagnostics/update events into Explorer/problems state."""
    project_root = _diagnostics_project_root()
    if not project_root:
        print("[diag_bridge] diagnostics/update ignored: no active project", flush=True)
        return
    _prune_cache_to_project(project_root)
    entries, ignored = _process_diagnostics_update(ev, project_root=project_root)
    print(
        f"[diag_bridge] diagnostics/update rx accepted={len(entries)} ignored={ignored} project={project_root} paths={[entry.get('path', '?') for entry in entries]}",
        flush=True,
    )
    try:
        await _emit_diagnostics_to_explorer_and_ui(project_root)
    except Exception as exc:
        print(f"[diag_bridge] explorer/problems emit FAIL: {exc}", flush=True)


def reset_diagnostics_projection() -> None:
    """Clear stale diagnostics projection state for a project transition."""
    global _diag_cache
    global _diag_emit_dirty, _diag_emit_task

    _diag_emit_dirty = False
    if _diag_emit_task and not _diag_emit_task.done():
        _diag_emit_task.cancel()
    _diag_emit_task = None
    # Purge the diagnostics cache so stale markers are never replayed
    # after the adapter changes workspace or a project switch occurs.
    _diag_cache.clear()


async def reset_diagnostics_projection_for_project(
    project_path: str | Path,
    project_generation: int | None = None,
) -> None:
    """Clear diagnostics state and publish an empty projection for project switch."""
    global _active_project_root, _active_project_generation

    normalized_project = _normalize_project_path(project_path)
    _active_project_root = normalized_project
    if project_generation is None:
        try:
            from .worker_services.event_bus import current_project_generation

            _active_project_generation = current_project_generation(normalized_project)
        except Exception:
            _active_project_generation = None
    else:
        _active_project_generation = project_generation
    reset_diagnostics_projection()
    try:
        from .workspace_events import publish_diagnostics_detail

        await publish_diagnostics_detail(normalized_project, {})
    except Exception as exc:
        logger.warning(
            "[diag_bridge] failed to publish empty diagnostics for %s: %s",
            normalized_project,
            exc,
        )

    try:
        from .monaco_editor.editor_ws import editor_runtime_emit_room_event

        await editor_runtime_emit_room_event(
            "editor:diagnostics_counts",
            {
                "errors": 0,
                "warnings": 0,
                "hints": 0,
                "total": 0,
                "path": "",
                "projectPath": normalized_project,
                "reason": "project_switch",
            },
        )
    except Exception as exc:
        logger.debug(
            "[diag_bridge] failed to publish empty diagnostics counts for %s: %s",
            normalized_project,
            exc,
        )
