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
from .project_sidecar import ProjectSidecar
from .history_store import HistoryStore
from .stores import get_history_store, get_preferences_store

log = logging.getLogger(__name__)
_boot_prepare_tasks: dict[str, asyncio.Task[None]] = {}
EnsureCodeServerShellFn = Callable[[str], Awaitable[object]]
EnsureWorkbenchAdapterShellFn = Callable[..., Awaitable[object]]


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

        code_server_shell = await ensure_code_server_shell(project_root)
        code_server_env_raw = getattr(code_server_shell, "env_overrides", None)
        code_server_env = cast(
            dict[object, object],
            code_server_env_raw if isinstance(code_server_env_raw, dict) else {},
        )
        port_s_obj = code_server_env.get("TE_CODE_SERVER_PORT")
        port_s = str(port_s_obj) if port_s_obj is not None else ""
        try:
            code_server_port = int(str(port_s))
        except Exception:
            code_server_port = 0
        code_server_http = (
            f"http://127.0.0.1:{code_server_port}"
            if code_server_port
            else "http://127.0.0.1:18180"
        )
        await ensure_workbench_adapter_shell(project_root, code_server_http=code_server_http)
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

    last_file = history.get_last_file(project_path)
    last_file_exists = bool(last_file and Path(last_file).is_file())
    last_file_label = HistoryStore.format_label(last_file)
    last_file_message = ""
    if last_file and not last_file_exists:
        last_file_message = f'File "{last_file_label or last_file}" not found.'

    recents_raw = history.list_files(project_path) if project_path else []
    recents: list[JsonMap] = []
    for entry in recents_raw:
        entry_path = entry.get("path")
        entry_path_str = entry_path if isinstance(entry_path, str) else None
        exists = bool(entry_path_str and Path(entry_path_str).is_file())
        recents.append({
            "path": entry_path_str,
            "label": entry.get("label") or HistoryStore.format_label(entry_path_str),
            "opened_at": entry.get("opened_at"),
            "exists": exists,
            "scroll_line": entry.get("scroll_line"),
        })

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
        "currentPath": session_state.get("currentPath"),
        "unsaved": session_state.get("unsaved"),
        "editorState": session_state,
    }


def _build_explorer_bootstrap_payload(
    *,
    project_root: str | None,
    session_state: JsonMap,
) -> ExplorerBootstrapPayload | None:
    if not project_root:
        return None

    resolved_project_root = str(project_root)
    try:
        resolved_project_root = str(Path(project_root).expanduser().resolve(strict=False))
    except Exception:
        resolved_project_root = str(project_root)

    active_file_payload: ExplorerActiveFilePayload | None = None
    current_path_obj = session_state.get("currentPath")
    if isinstance(current_path_obj, str) and current_path_obj.strip():
        rel = abs_to_rel(current_path_obj, resolved_project_root)
        if isinstance(rel, str):
            active_file_payload = {
                "rel": rel,
                "abs": current_path_obj,
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
