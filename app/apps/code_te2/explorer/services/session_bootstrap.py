# pyright: strict
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from .file_ops import mark_git_cache_dirty, set_project_root
from .render_state import build_bootstrap_snapshot, emit_bootstrap_snapshot
from ..transport.connection_manager import ExplorerConnection, manager
from ...project_sidecar import ProjectSidecar
from ...open_state_backend import read_client_foreground, read_sidecar_open_state
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

    return ExplorerBootstrapResult(
        project_root=resolved_project_root,
        was_new_sidecar=was_new_sidecar,
    )


async def replay_explorer_session_bootstrap(
    *,
    project_root: Path,
    was_new_sidecar: bool,
    emit_personal: EmitPersonal,
    client_instance_id: str,
    broadcast_git_status: AsyncNoArg,
    broadcast_review_state: AsyncNoArg,
) -> None:
    await emit_personal(
        "explorer.project.active.updated",
        {"path": str(project_root), "new_sidecar": was_new_sidecar},
    )

    try:
        prefs = _preferences_store.get_preferences()
        ui_prefs = _as_object(prefs.get("ui"))
        await emit_personal("explorer.prefs.ui.updated", {"ui": ui_prefs})
    except Exception as exc:
        logger.warning("Failed to load UI preferences: %s", exc)

    open_state: JsonObject | None = None
    active_file_rel: str | None = None
    active_file_abs: str | None = None
    try:
        raw_open_state = read_sidecar_open_state(str(project_root), reason="reconnect")
        open_state = dict(raw_open_state)
        foreground = read_client_foreground(
            str(project_root),
            client_instance_id,
            reason="explorer_reconnect",
        )
        active_file_rel = foreground["rel"]
        active_file_abs = foreground["path"]
    except Exception as exc:
        logger.warning("Failed to rehydrate active file: %s", exc)

    mark_git_cache_dirty(project_root)
    await emit_bootstrap_snapshot(
        emit_personal,
        await build_bootstrap_snapshot(
            project_root,
            extra_open_directories=_active_file_parent_directories(active_file_rel),
        ),
    )
    _schedule_bootstrap_git_status(project_root, broadcast_git_status)
    await broadcast_review_state()

    if open_state is not None:
        await emit_personal("explorer.openState.changed", dict(open_state))
        await emit_personal(
            "explorer.activeFile.updated",
            {
                "rel": active_file_rel,
                "abs": active_file_abs,
                "openState": dict(open_state),
            },
        )

    try:
        from ...watchexec_shell_manager import (
            ensure_watchexec_shell,
            is_watchexec_available,
        )

        sidecar_watcher = ProjectSidecar.load_or_create(str(project_root))
        sidecar_state = sidecar_watcher.dump_raw()
        watcher_config = build_watcher_config_payload(
            sidecar_state.get("watcher"),
            watchexec_available=is_watchexec_available(),
        )
        watcher_mode = watcher_config["mode"]
        await emit_personal("explorer.watcher.config.updated", dict(watcher_config))
        if watcher_mode == "watchexec" and watcher_config["watchexec_available"]:
            _ = await ensure_watchexec_shell(
                str(project_root),
                watcher_config["poll_interval_ms"],
            )
    except Exception as exc:
        logger.warning("Failed to send watcher config: %s", exc)


def _schedule_bootstrap_git_status(
    project_root: Path,
    broadcast_git_status: AsyncNoArg,
) -> None:
    async def _run() -> None:
        try:
            await broadcast_git_status()
        except Exception as exc:
            logger.warning("Failed to load bootstrap git status for %s: %s", project_root, exc)

    _ = asyncio.create_task(_run(), name="explorer_bootstrap_git_status")


def _active_file_parent_directories(rel: str | None) -> list[str]:
    if not rel:
        return []
    parts = [part for part in rel.strip("/").split("/") if part]
    return ["/".join(parts[:index]) for index in range(1, len(parts))]
