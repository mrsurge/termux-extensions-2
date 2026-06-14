# pyright: strict
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from .file_ops import list_dir, set_project_root
from ..transport.connection_manager import ExplorerConnection, manager
from ...project_sidecar import ProjectSidecar
from ...open_state_backend import read_sidecar_open_state
from ...stores import get_history_store, get_preferences_store
from ..contracts.watcher import build_watcher_config_payload
from ..context import AsyncNoArg, EmitPersonal

logger = logging.getLogger(__name__)
JsonObject = dict[str, object]

_history_store = get_history_store()
_preferences_store = get_preferences_store()


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items() if isinstance(key, str)}


@dataclass(frozen=True)
class ExplorerBootstrapResult:
    project_root: Path
    was_new_sidecar: bool


async def bootstrap_explorer_session(
    *,
    websocket: ExplorerConnection,
    project_root: Path,
    emit_personal: EmitPersonal,
    broadcast_git_status: AsyncNoArg,
    broadcast_review_state: AsyncNoArg,
) -> ExplorerBootstrapResult:
    resolved_project_root = project_root

    try:
        active_project = _history_store.get_active_project()
        if isinstance(active_project, str) and active_project.strip():
            resolved_project_root = set_project_root(active_project)
    except Exception:
        pass

    was_new_sidecar = not ProjectSidecar.sidecar_exists(str(resolved_project_root))

    await manager.accept_and_register(websocket, str(resolved_project_root))

    await emit_personal(
        "explorer.project.active.updated",
        {"path": str(resolved_project_root), "new_sidecar": was_new_sidecar},
    )

    try:
        prefs = _preferences_store.get_preferences()
        ui_prefs = _as_object(prefs.get("ui"))
        await emit_personal("explorer.prefs.ui.updated", {"ui": ui_prefs})
    except Exception as exc:
        logger.warning("Failed to load UI preferences: %s", exc)

    await broadcast_git_status()
    await emit_personal(
        "explorer.list.updated",
        await asyncio.to_thread(list_dir, "."),
    )
    await broadcast_review_state()

    try:
        sidecar = ProjectSidecar.load_or_create(str(resolved_project_root))
        open_dirs = sidecar.get_open_directories()
        await emit_personal("explorer.openDirs.updated", {"dirs": open_dirs})
    except Exception as exc:
        logger.warning("Failed to load open directories: %s", exc)

    try:
        open_state = read_sidecar_open_state(str(resolved_project_root), reason="reconnect")
        await emit_personal("explorer.openState.changed", dict(open_state))
        current_path = open_state["openFile"]
        rel = open_state["openFileRel"]
        await emit_personal(
            "explorer.activeFile.updated",
            {"rel": rel, "abs": current_path, "openState": dict(open_state)},
        )
    except Exception as exc:
        logger.warning("Failed to rehydrate active file: %s", exc)

    try:
        from ...watchexec_shell_manager import (
            ensure_watchexec_shell,
            is_watchexec_available,
        )

        sidecar_watcher = ProjectSidecar.load_or_create(str(resolved_project_root))
        sidecar_state = sidecar_watcher.dump_raw()
        watcher_config = build_watcher_config_payload(
            sidecar_state.get("watcher"),
            watchexec_available=is_watchexec_available(),
        )
        watcher_mode = watcher_config["mode"]
        await emit_personal("explorer.watcher.config.updated", dict(watcher_config))
        if watcher_mode == "watchexec" and watcher_config["watchexec_available"]:
            await ensure_watchexec_shell(
                str(resolved_project_root),
                watcher_config["poll_interval_ms"],
            )
    except Exception as exc:
        logger.warning("Failed to send watcher config: %s", exc)

    return ExplorerBootstrapResult(
        project_root=resolved_project_root,
        was_new_sidecar=was_new_sidecar,
    )
