# pyright: strict
from __future__ import annotations

from collections.abc import Callable
from typing import cast

from .. import edit_tracker
from ..diff_helper import invalidate_diff_cache
from ..explorer.services.file_ops import get_project_root, set_project_root
from ..history_store import HistoryStore
from ..main_page.backend.project_service import (
    ProjectServiceDeps,
    create_project_from_path,
    lookup_project,
    open_project,
)
from ..main_page.backend.state_payload import StatePayloadDeps, build_state_payload
from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..project_sidecar import ProjectSidecar
from ..stores import get_history_store, get_preferences_store
from ..worker_services import git_service as worker_git_service


def _state_payload_deps() -> StatePayloadDeps:
    return StatePayloadDeps(
        history=get_history_store(),
        preferences=get_preferences_store(),
        set_project_root=set_project_root,
        is_git_repository=worker_git_service.is_git_repository,
        get_commit_info=worker_git_service.get_commit_info,
        format_label=HistoryStore.format_label,
    )


def _build_state_payload() -> dict[str, object]:
    return build_state_payload(_state_payload_deps())


async def _close_active_terminal_sockets() -> None:
    from ..terminal_backend import close_active_terminal_sockets

    await close_active_terminal_sockets()


def _stop_diagnostics_bridge() -> None:
    from ..wba_event_bridge import reset_wba_project_event_state

    reset_wba_project_event_state()


async def _terminate_adapter_shell() -> bool:
    from ..workbench_adapter_shell_manager import terminate_adapter_shell

    return await terminate_adapter_shell()


async def _emit_sidebar_cwd_set(reason: str) -> None:
    from ..ui_ipc import sidebar_ws

    await sidebar_ws.emit_sidebar_cwd_set_global(reason=reason)


async def _emit_explorer_project_opened(payload: JsonMap) -> None:
    from ..explorer.transport.rpc_emit import emit_explorer_rpc_notification

    await emit_explorer_rpc_notification("explorer.project.opened", payload)


def _create_project(parent_path: str, name: str) -> dict[str, object]:
    from ..explorer.services import file_ops

    create_project_fn = cast(
        Callable[[str, str], dict[object, object]],
        file_ops.create_project,
    )
    result = create_project_fn(parent_path, name)
    return {str(key): value for key, value in result.items()}


def _project_service_deps() -> ProjectServiceDeps:
    return ProjectServiceDeps(
        history=get_history_store(),
        get_project_root=get_project_root,
        set_project_root=set_project_root,
        invalidate_diff_cache=invalidate_diff_cache,
        set_edit_tracker_project_root=edit_tracker.set_project_root,
        close_active_terminal_sockets=_close_active_terminal_sockets,
        stop_diagnostics_bridge=_stop_diagnostics_bridge,
        terminate_adapter_shell=_terminate_adapter_shell,
        emit_sidebar_cwd_set=_emit_sidebar_cwd_set,
        build_state_payload=_build_state_payload,
        create_project=_create_project,
        format_label=HistoryStore.format_label,
        get_sidecar_path=ProjectSidecar.get_sidecar_path,
        emit_explorer_project_opened=_emit_explorer_project_opened,
    )


def _path_param(data: dict[str, object]) -> str:
    raw = data.get("path")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    raise ValueError("path is required")


def _bool_param(data: dict[str, object], key: str, *, default: bool) -> bool:
    raw = data.get(key)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        lowered = raw.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    return default


async def handle_sidebar_project_lookup_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    return lookup_project(_project_service_deps(), _path_param(data))


async def handle_sidebar_project_open_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    file_target_obj = data.get("file") or data.get("file_path") or data.get("fileTarget") or data.get("targetFile")
    file_target = file_target_obj.strip() if isinstance(file_target_obj, str) and file_target_obj.strip() else None
    result = await open_project(
        _project_service_deps(),
        _path_param(data),
        require_known_sidecar=True,
        reason="sidebar_project_open",
        file_target=file_target,
    )
    if result.get("ok") is True:
        result["source"] = source_name
    return result


async def handle_sidebar_project_create_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    result = await create_project_from_path(
        _project_service_deps(),
        path=_path_param(data),
        adopt_existing=_bool_param(data, "adoptExisting", default=False),
        open_after=_bool_param(data, "open", default=True),
    )
    if result.get("ok") is True:
        result["source"] = source_name
    return result
