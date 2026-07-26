# pyright: strict
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Awaitable, Callable, TypedDict, cast

from .explorer.contracts.watcher import WatcherConfigPayload, build_watcher_config_payload
from .explorer.transport.connection_manager import abs_to_rel
from .monaco_editor.editor_backend_services.contracts import JsonMap
from .monaco_editor.editor_ws import editor_runtime_build_connect_snapshot
from .open_state_backend import read_sidecar_open_state
from .project_sidecar import ProjectSidecar
from .history_store import HistoryStore
from .stores import get_history_store, get_preferences_store

log = logging.getLogger(__name__)
_boot_prepare_tasks: dict[str, asyncio.Task[None]] = {}
EnsureCodeServerShellFn = Callable[[str], Awaitable[object]]
EnsureWorkbenchAdapterShellFn = Callable[..., Awaitable[object]]
CodeServerConnectionTargetFn = Callable[[object], tuple[str, str | None]]


class ExplorerActiveFilePayload(TypedDict):
    rel: str
    abs: str


class ExplorerBootstrapPayload(TypedDict):
    project_root: str
    open_dirs: list[str]
    watcher_config: WatcherConfigPayload
    active_file: ExplorerActiveFilePayload | None


class BootSnapshotPayload(TypedDict):
    host_state: JsonMap
    session_state: JsonMap
    editor_ssot: JsonMap
    ui_prefs: JsonMap
    explorer_bootstrap: ExplorerBootstrapPayload | None


async def _prime_backend_runtime(project_root: str) -> None:
    try:
        from . import code_server_shell_manager, workbench_adapter_shell_manager

        ensure_code_server_shell = cast(
            EnsureCodeServerShellFn,
            code_server_shell_manager.ensure_code_server_shell,
        )
        ensure_workbench_adapter_shell = cast(
            EnsureWorkbenchAdapterShellFn,
            workbench_adapter_shell_manager.ensure_workbench_adapter_shell,
        )
        code_server_connection_target = cast(
            CodeServerConnectionTargetFn,
            code_server_shell_manager.code_server_connection_target,
        )

        code_server_shell = await ensure_code_server_shell(project_root)
        code_server_http, code_server_socket_path = code_server_connection_target(code_server_shell)
        await ensure_workbench_adapter_shell(
            project_root,
            code_server_http=code_server_http,
            code_server_socket_path=code_server_socket_path,
        )
    except Exception as exc:
        log.warning("[boot_snapshot] backend runtime prime failed: %s", exc)
    finally:
        _boot_prepare_tasks.pop(project_root, None)


def _ensure_backend_runtime_task(project_root: str | None) -> None:
    if not project_root:
        return
    existing = _boot_prepare_tasks.get(project_root)
    if existing and not existing.done():
        return
    _boot_prepare_tasks[project_root] = asyncio.create_task(
        _prime_backend_runtime(project_root),
        name="file_editor_cm6_boot_prepare",
    )


def _build_host_state_payload() -> JsonMap:
    history = get_history_store()
    prefs_store = get_preferences_store()
    project_path = history.get_active_project()
    project_exists = bool(project_path and Path(project_path).is_dir())
    project_label = HistoryStore.format_label(project_path)
    project_message = ""
    if not project_path:
        project_message = "No project selected."
    elif not project_exists:
        project_message = f'Project "{project_label or project_path}" not found.'

    last_file: str | None = None
    open_state: JsonMap | None = None
    recents: list[JsonMap] = []
    if project_path:
        try:
            sidecar_state = read_sidecar_open_state(project_path, reason="reconnect")
            open_state = dict(sidecar_state)
            last_file = sidecar_state["openFile"]
            recents = [dict(entry) for entry in sidecar_state["recents"]]
        except Exception:
            last_file = None
    last_file_exists = bool(last_file and Path(last_file).is_file())
    last_file_label = HistoryStore.format_label(last_file)
    last_file_message = ""
    if last_file and not last_file_exists:
        last_file_message = f'File "{last_file_label or last_file}" not found.'

    session_state = history.get_session_state()
    return {
        "activeProject": project_path,
        "activeProjectLabel": project_label,
        "activeProjectExists": project_exists,
        "activeProjectMessage": project_message,
        "lastFile": last_file,
        "lastFileLabel": last_file_label,
        "lastFileExists": last_file_exists,
        "lastFileMessage": last_file_message,
        "recents": recents,
        "preferences": prefs_store.get_preferences(project_path),
        "currentPath": last_file,
        "openState": open_state,
        "unsaved": session_state.get("unsaved"),
        "editorState": session_state,
    }


def _build_explorer_bootstrap_payload(
    *,
    project_root: str | None,
    session_state: JsonMap,
) -> ExplorerBootstrapPayload | None:
    del session_state
    if not project_root:
        return None

    resolved_project_root = str(project_root)
    try:
        resolved_project_root = str(Path(project_root).expanduser().resolve(strict=False))
    except Exception:
        resolved_project_root = str(project_root)

    active_file_payload: ExplorerActiveFilePayload | None = None
    open_file: str | None = None
    try:
        open_state = read_sidecar_open_state(resolved_project_root, reason="reconnect")
        open_file = open_state["openFile"]
    except Exception:
        open_file = None
    if isinstance(open_file, str) and open_file.strip():
        rel = abs_to_rel(open_file, resolved_project_root)
        if isinstance(rel, str):
            active_file_payload = {
                "rel": rel,
                "abs": open_file,
            }

    sidecar = ProjectSidecar.load_or_create(resolved_project_root)

    try:
        from .watchexec_shell_manager import is_watchexec_available

        watchexec_available = bool(is_watchexec_available())
    except Exception:
        watchexec_available = False

    watcher_config = build_watcher_config_payload(
        getattr(sidecar, "_data", {}).get("watcher"),
        watchexec_available=watchexec_available,
    )

    return {
        "project_root": resolved_project_root,
        "open_dirs": list(sidecar.get_open_directories()),
        "watcher_config": watcher_config,
        "active_file": active_file_payload,
    }


async def handle_boot_snapshot_request(
    _data: dict[str, object] | None = None,
    *,
    source_name: str,
) -> JsonMap:
    del _data
    del source_name

    history = get_history_store()
    prefs_store = get_preferences_store()
    active_project = history.get_active_project()
    _ensure_backend_runtime_task(active_project)
    session_state = history.get_session_state()
    host_state = _build_host_state_payload()
    editor_ssot = editor_runtime_build_connect_snapshot()

    ui_prefs_raw = prefs_store.get_preferences(active_project).get("ui")
    ui_prefs: JsonMap = {}
    if isinstance(ui_prefs_raw, dict):
        normalized_ui_prefs: JsonMap = {}
        for key, value in cast(dict[object, object], ui_prefs_raw).items():
            if isinstance(key, str):
                normalized_ui_prefs[key] = value
        ui_prefs = normalized_ui_prefs

    explorer_bootstrap = _build_explorer_bootstrap_payload(
        project_root=active_project,
        session_state=session_state,
    )

    snapshot: BootSnapshotPayload = {
        "host_state": host_state,
        "session_state": session_state,
        "editor_ssot": editor_ssot,
        "ui_prefs": ui_prefs,
        "explorer_bootstrap": explorer_bootstrap,
    }
    return {
        "ok": True,
        "snapshot": snapshot,
    }
