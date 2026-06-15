"""Backend-owned WBA event stream bridge.

This module owns the long-lived subscription to the Node workbench adapter
``/ws`` event stream. It dispatches events into backend-owned projectors such
as workspace file-change events and diagnostics projection. Its lifecycle is
owned by app-worker startup and project switching, not frontend connections.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import cast

logger = logging.getLogger(__name__)

ADAPTER_PORT = 18181

JsonObject = dict[str, object]

_bridge_task: asyncio.Task[None] | None = None
_bridge_running = False
_enospc_forwarded = False


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


def _int_value(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int | float | str):
        try:
            return int(value)
        except ValueError:
            return default
    return default


def is_wba_event_bridge_active() -> bool:
    return _bridge_running and _bridge_task is not None and not _bridge_task.done()


def reset_wba_project_event_state() -> None:
    """Clear project-scoped WBA event projections without stopping intake."""
    global _enospc_forwarded

    _enospc_forwarded = False
    try:
        from .diagnostics_bridge import reset_diagnostics_projection

        reset_diagnostics_projection()
    except Exception:
        pass


async def _handle_watcher_enospc(ev: JsonObject) -> None:
    global _enospc_forwarded

    if _enospc_forwarded:
        return

    proj = ""
    try:
        from .explorer.services.file_ops import get_project_root
        from .project_sidecar import ProjectSidecar

        proj = str(get_project_root())
        sidecar = ProjectSidecar.load_or_create(proj)
        watcher_obj = sidecar.dump_raw().get("watcher", {})
        watcher = _json_object(watcher_obj)
        watcher_mode = str(watcher.get("mode", "ipc"))
        if watcher_mode != "ipc":
            print(
                f"[wba_event_bridge] watcher/enospc suppressed (mode={watcher_mode})",
                flush=True,
            )
            _enospc_forwarded = True
            return
    except Exception:
        pass

    _enospc_forwarded = True
    try:
        from .workspace_events import publish_watcher_error

        await publish_watcher_error(
            proj,
            {
                "message": str(ev.get("message", "Inotify limit reached (ENOSPC)")),
                "limit": 524288,
            },
        )
        print("[wba_event_bridge] watcher/enospc forwarded (once)", flush=True)
    except Exception as exc:
        print(f"[wba_event_bridge] watcher/enospc emit FAIL: {exc}", flush=True)


async def _handle_watcher_file_changes(ev: JsonObject) -> None:
    try:
        changes = _json_object_list(ev.get("changes", []))
        if not changes:
            return
        try:
            from .explorer.services.file_ops import get_project_root

            project_root = str(get_project_root())
        except Exception:
            project_root = ""

        created_abs: list[str] = []
        changed_abs: list[str] = []
        deleted_abs: list[str] = []
        for change in changes:
            path = str(change.get("path", ""))
            if not path:
                continue
            change_type = _int_value(change.get("type", 0))
            if change_type == 1:
                created_abs.append(path)
            elif change_type == 2:
                deleted_abs.append(path)
            else:
                changed_abs.append(path)

        total = len(created_abs) + len(changed_abs) + len(deleted_abs)
        if total <= 0:
            return

        from .workspace_events import publish_file_change_event

        await publish_file_change_event(
            project_root,
            created_abs=created_abs,
            changed_abs=changed_abs,
            deleted_abs=deleted_abs,
        )
        print(
            f"[wba_event_bridge] watcher/fileChanges forwarded project={project_root} paths={total}",
            flush=True,
        )
    except Exception as exc:
        print(f"[wba_event_bridge] watcher/fileChanges emit FAIL: {exc}", flush=True)


async def _dispatch_wba_event(ev: JsonObject) -> None:
    ev_type = str(ev.get("type") or "")
    if ev_type == "adapter/ready":
        return
    if ev_type == "workspace/switched":
        await _handle_workspace_switched(ev)
        return
    if ev_type == "watcher/enospc":
        await _handle_watcher_enospc(ev)
        return
    if ev_type == "watcher/fileChanges":
        await _handle_watcher_file_changes(ev)
        return
    if ev_type == "diagnostics/update":
        from .diagnostics_bridge import handle_wba_diagnostics_update

        await handle_wba_diagnostics_update(ev)


async def _handle_workspace_switched(ev: JsonObject) -> None:
    raw_root = ev.get("workspaceFolder") or ev.get("to")
    if not isinstance(raw_root, str) or not raw_root.strip():
        return
    try:
        from pathlib import Path

        from .explorer.services.file_ops import get_project_root

        switched_root = str(Path(raw_root).expanduser().resolve(strict=False))
        backend_root = str(Path(get_project_root()).expanduser().resolve(strict=False))
        if switched_root != backend_root:
            print(
                f"[wba_event_bridge] workspace/switched ignored root={switched_root} backend={backend_root}",
                flush=True,
            )
            return
        from .diagnostics_bridge import reset_diagnostics_projection_for_project

        await reset_diagnostics_projection_for_project(switched_root)
        print(
            f"[wba_event_bridge] workspace/switched diagnostics reset root={switched_root}",
            flush=True,
        )
    except Exception as exc:
        print(f"[wba_event_bridge] workspace/switched handling failed: {exc}", flush=True)


async def _adapter_ws_loop() -> None:
    import websockets

    url = f"ws://127.0.0.1:{ADAPTER_PORT}/ws"
    backoff = 1.0
    while _bridge_running:
        try:
            async with websockets.connect(url, open_timeout=10, close_timeout=5) as ws:
                logger.info("[wba_event_bridge] connected to adapter ws %s", url)
                backoff = 1.0
                async for raw in ws:
                    try:
                        decoded = cast(object, json.loads(str(raw)))
                        msg = _json_object(decoded)
                    except (json.JSONDecodeError, TypeError):
                        continue
                    if msg.get("method") != "te2.event":
                        continue
                    ev = _json_object(msg.get("params"))
                    if ev:
                        await _dispatch_wba_event(ev)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.debug(
                "[wba_event_bridge] adapter ws error: %s, reconnecting in %.0fs",
                exc,
                backoff,
            )

        if not _bridge_running:
            break
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 30.0)


def start_wba_event_bridge() -> None:
    """Ensure the backend WBA event stream subscriber is running."""
    global _bridge_task, _bridge_running

    if _bridge_task and not _bridge_task.done():
        _bridge_running = True
        return
    _bridge_running = True
    _bridge_task = asyncio.ensure_future(_adapter_ws_loop())


def stop_wba_event_bridge() -> None:
    """Stop the backend WBA event stream subscriber."""
    global _bridge_task, _bridge_running

    _bridge_running = False
    if _bridge_task and not _bridge_task.done():
        _bridge_task.cancel()
    _bridge_task = None
