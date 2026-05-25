# pyright: strict
from __future__ import annotations

import importlib
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable, cast

from .file_ops import set_project_root
from ..transport.connection_manager import ExplorerConnection, manager
from ...project_sidecar import ProjectSidecar
from ..contracts.watcher import build_watcher_config_payload
from .project_session import reset_project_session

logger = logging.getLogger(__name__)

AdapterRpc = Callable[[str, dict[str, object] | None, float], Awaitable[object]]
InitWatcher = Callable[[Path], None]
EnsureWatchexecShell = Callable[[str, int], Awaitable[object | None]]
EmitProjectSwitchFn = Callable[..., Awaitable[dict[str, object]]]
MarkAdapterWorkspaceStateFn = Callable[..., Awaitable[None]]


@dataclass(frozen=True)
class ExplorerProjectSwitchResult:
    project_root: Path
    display_path: str
    was_new_sidecar: bool


async def switch_project_connection(
    websocket: ExplorerConnection | None,
    project_path: str,
    *,
    display_path: str | None = None,
    initialize_watcher: bool,
    switch_adapter_workspace: bool,
    open_state_reason: str = "project_open",
    open_state_source: str = "explorer_project_open",
) -> ExplorerProjectSwitchResult:
    normalized_display_path = display_path or os.path.abspath(
        os.path.expanduser(str(project_path))
    )

    if websocket is not None:
        manager.disconnect(websocket)

    try:
        from ...watchexec_shell_manager import stop_watchexec_shell

        await stop_watchexec_shell()
    except Exception:
        pass

    new_root = set_project_root(project_path)
    switch_notice = await _broadcast_project_switching(
        new_root,
        display_path=normalized_display_path,
        reason=open_state_reason,
        source=open_state_source,
    )
    switch_id = str(switch_notice.get("switchId") or "")
    adapter_status = "unchanged"

    if initialize_watcher:
        init_watcher = _get_init_watcher()
        init_watcher(new_root)

    was_new_sidecar = await reset_project_session(normalized_display_path)
    if websocket is not None:
        manager.register_existing(websocket, str(new_root))
    manager.reassign_all(str(new_root))

    if switch_adapter_workspace:
        try:
            await _mark_adapter_workspace_switching(new_root)
            adapter_status = "switching"
            adapter_rpc = _get_adapter_rpc()
            await adapter_rpc(
                "adapter.switchWorkspace",
                {"folder": str(new_root)},
                30,
            )
            await _mark_adapter_workspace_ready(new_root)
            adapter_status = "ready"
            logger.info("[project_open] adapter workspace switched to %s", new_root)
        except Exception as exc:
            adapter_status = "error"
            try:
                await _mark_adapter_workspace_error(new_root, str(exc))
            except Exception:
                pass
            logger.warning(
                "[project_open] adapter switchWorkspace failed: %s",
                exc,
            )

    await _start_project_watchexec_if_needed(new_root)
    open_state = await _replay_sidecar_open_state(
        new_root,
        reason=open_state_reason,
        source=open_state_source,
    )
    await _broadcast_project_git_state(new_root)
    await _broadcast_project_switched(
        new_root,
        display_path=normalized_display_path,
        reason=open_state_reason,
        source=open_state_source,
        switch_id=switch_id,
        open_state=open_state if isinstance(open_state, dict) else None,
        adapter_status=adapter_status,
        status="ready" if adapter_status != "error" else "error",
    )

    return ExplorerProjectSwitchResult(
        project_root=new_root,
        display_path=normalized_display_path,
        was_new_sidecar=was_new_sidecar,
    )


async def _start_project_watchexec_if_needed(project_root: Path) -> None:
    try:
        from ...watchexec_shell_manager import is_watchexec_available

        sidecar = ProjectSidecar.load_or_create(str(project_root))
        sidecar_data = _sidecar_data_dict(sidecar)
        watcher_config = build_watcher_config_payload(
            sidecar_data.get("watcher") if sidecar_data is not None else {},
            watchexec_available=is_watchexec_available(),
        )
        if watcher_config["mode"] == "watchexec" and watcher_config["watchexec_available"]:
            ensure_watchexec_shell = _get_ensure_watchexec_shell()
            await ensure_watchexec_shell(
                str(project_root),
                watcher_config["poll_interval_ms"],
            )
    except Exception as exc:
        logger.warning("[project_open] watchexec start failed: %s", exc)


async def _replay_sidecar_open_state(
    project_root: Path,
    *,
    reason: str,
    source: str,
) -> dict[str, object] | None:
    editor_module = importlib.import_module("app.apps.file_editor_cm6.monaco_editor.editor_ws")
    replay_obj = getattr(editor_module, "editor_runtime_replay_sidecar_open_state", None)
    if not callable(replay_obj):
        raise RuntimeError("editor_runtime_replay_sidecar_open_state unavailable")
    replay = cast(Callable[..., Awaitable[object | None]], replay_obj)
    result = await replay(str(project_root), reason=reason, source=source)
    return cast(dict[str, object], result) if isinstance(result, dict) else None


async def _broadcast_project_switching(
    project_root: Path,
    *,
    display_path: str,
    reason: str,
    source: str,
) -> dict[str, object]:
    editor_module = importlib.import_module("app.apps.file_editor_cm6.monaco_editor.editor_ws")
    emit_obj = getattr(editor_module, "editor_runtime_emit_project_switching", None)
    if not callable(emit_obj):
        raise RuntimeError("editor_runtime_emit_project_switching unavailable")
    emit = cast(EmitProjectSwitchFn, emit_obj)
    return await emit(
        str(project_root),
        display_path=display_path,
        reason=reason,
        source=source,
    )


async def _broadcast_project_switched(
    project_root: Path,
    *,
    display_path: str,
    reason: str,
    source: str,
    switch_id: str,
    open_state: dict[str, object] | None,
    adapter_status: str,
    status: str,
) -> None:
    editor_module = importlib.import_module("app.apps.file_editor_cm6.monaco_editor.editor_ws")
    emit_obj = getattr(editor_module, "editor_runtime_emit_project_switched", None)
    if not callable(emit_obj):
        raise RuntimeError("editor_runtime_emit_project_switched unavailable")
    emit = cast(EmitProjectSwitchFn, emit_obj)
    await emit(
        str(project_root),
        display_path=display_path,
        reason=reason,
        source=source,
        switch_id=switch_id,
        open_state=open_state,
        adapter_status=adapter_status,
        status=status,
    )


async def _broadcast_project_git_state(project_root: Path) -> None:
    try:
        from .runtime_notifications import broadcast_git_status_update

        await broadcast_git_status_update(project_root)
    except Exception as exc:
        logger.warning("[project_open] git state replay failed: %s", exc)


def _sidecar_data_dict(sidecar: ProjectSidecar) -> dict[object, object] | None:
    data = getattr(sidecar, "_data", None)
    if not isinstance(data, dict):
        return None
    return cast(dict[object, object], data)


def _get_adapter_rpc() -> AdapterRpc:
    adapter_module = importlib.import_module(
        "app.apps.file_editor_cm6.workbench_adapter_shell_manager"
    )
    adapter_rpc_obj = getattr(adapter_module, "adapter_rpc", None)
    if not callable(adapter_rpc_obj):
        raise RuntimeError("adapter_rpc unavailable")
    return cast(AdapterRpc, adapter_rpc_obj)


async def _mark_adapter_workspace_switching(project_root: Path) -> None:
    adapter_module = importlib.import_module(
        "app.apps.file_editor_cm6.workbench_adapter_shell_manager"
    )
    marker_obj = getattr(adapter_module, "mark_adapter_workspace_switching", None)
    if not callable(marker_obj):
        return
    marker = cast(MarkAdapterWorkspaceStateFn, marker_obj)
    await marker(str(project_root))


async def _mark_adapter_workspace_ready(project_root: Path) -> None:
    adapter_module = importlib.import_module(
        "app.apps.file_editor_cm6.workbench_adapter_shell_manager"
    )
    marker_obj = getattr(adapter_module, "mark_adapter_workspace_ready", None)
    if not callable(marker_obj):
        return
    marker = cast(MarkAdapterWorkspaceStateFn, marker_obj)
    await marker(str(project_root))


async def _mark_adapter_workspace_error(project_root: Path, error: str) -> None:
    adapter_module = importlib.import_module(
        "app.apps.file_editor_cm6.workbench_adapter_shell_manager"
    )
    marker_obj = getattr(adapter_module, "mark_adapter_workspace_error", None)
    if not callable(marker_obj):
        return
    marker = cast(MarkAdapterWorkspaceStateFn, marker_obj)
    await marker(str(project_root), str(error))


def _get_init_watcher() -> InitWatcher:
    core_read_module = importlib.import_module("app.apps.file_editor_cm6.core_read")
    init_watcher_obj = getattr(core_read_module, "init_watcher", None)
    if not callable(init_watcher_obj):
        raise RuntimeError("init_watcher unavailable")
    return cast(InitWatcher, init_watcher_obj)


def _get_ensure_watchexec_shell() -> EnsureWatchexecShell:
    watchexec_module = importlib.import_module(
        "app.apps.file_editor_cm6.watchexec_shell_manager"
    )
    ensure_shell_obj = getattr(watchexec_module, "ensure_watchexec_shell", None)
    if not callable(ensure_shell_obj):
        raise RuntimeError("ensure_watchexec_shell unavailable")
    return cast(EnsureWatchexecShell, ensure_shell_obj)
