# pyright: strict
from __future__ import annotations

import logging
import os
import asyncio
import time
from collections.abc import Awaitable
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, cast

from .file_ops import set_project_root
from ..transport.connection_manager import ExplorerConnection, manager
from ...project_sidecar import ProjectSidecar
from ...worker_services.event_bus import build_event, current_project_generation, next_project_generation, publish
from ..contracts.watcher import build_watcher_config_payload
from .project_session import reset_project_session

logger = logging.getLogger(__name__)

AdapterRpc = Callable[[str, dict[str, object] | None, float], Awaitable[object]]
EnsureWatchexecShell = Callable[[str, int], Awaitable[object | None]]
SyncExplorerProject = Callable[[Path], None]
RefreshExplorerProject = Callable[[Path, int], Awaitable[bool]]
_project_switch_seq = 0


@dataclass(frozen=True)
class ExplorerProjectSwitchResult:
    project_root: Path
    display_path: str
    was_new_sidecar: bool
    project_generation: int
    open_state: dict[str, object] | None


async def switch_project_connection(
    websocket: ExplorerConnection | None,
    project_path: str,
    *,
    display_path: str | None = None,
    initialize_watcher: bool,
    switch_adapter_workspace: bool,
    open_state_reason: str = "project_open",
    open_state_source: str = "explorer_project_open",
    before_switch: Callable[[], None] | None = None,
) -> ExplorerProjectSwitchResult:
    from ...project_autosave import project_switch, flush_before_project_switch, release_project_switch
    from ...stores import get_history_store
    previous = get_history_store().get_active_project()
    token = await flush_before_project_switch(previous)
    try:
        if get_history_store().get_active_project() != previous:
            raise ValueError("Project changed while preparing the switch")
        with project_switch(previous, project_path, token):
            return await _switch_project_connection(
                websocket, project_path, display_path=display_path,
                initialize_watcher=initialize_watcher, switch_adapter_workspace=switch_adapter_workspace,
                open_state_reason=open_state_reason, open_state_source=open_state_source,
                before_switch=before_switch,
            )
    finally:
        await release_project_switch(token)


async def _switch_project_connection(
    websocket: ExplorerConnection | None,
    project_path: str,
    *,
    display_path: str | None = None,
    initialize_watcher: bool,
    switch_adapter_workspace: bool,
    open_state_reason: str = "project_open",
    open_state_source: str = "explorer_project_open",
    before_switch: Callable[[], None] | None = None,
) -> ExplorerProjectSwitchResult:
    if before_switch is not None:
        before_switch()
    sync_explorer_project, refresh_explorer_project = _get_explorer_project_hooks()

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

    if before_switch is not None:
        before_switch()
    new_root = set_project_root(project_path)
    project_generation = next_project_generation(new_root)
    switch_id = _next_project_switch_id()
    await publish(
        build_event(
            "ProjectSwitchStarted",
            project_root=new_root,
            project_generation=project_generation,
            source=open_state_source,
            correlation_id=switch_id or None,
            payload={
                "displayPath": normalized_display_path,
                "reason": open_state_reason,
                "source": open_state_source,
                "switchId": switch_id,
            },
        )
    )
    await asyncio.sleep(0)
    adapter_status = "unchanged"

    _ = initialize_watcher

    was_new_sidecar = await reset_project_session(normalized_display_path)
    _require_current_switch(new_root, project_generation)
    if websocket is not None:
        manager.register_existing(websocket, str(new_root))
    manager.reassign_all(str(new_root))
    sync_explorer_project(new_root)
    await _reset_project_diagnostics(new_root, project_generation=project_generation)

    if switch_adapter_workspace:
        try:
            await _mark_adapter_workspace_switching(new_root)
            adapter_status = "switching"
            adapter_rpc = _get_adapter_rpc()
            from ...workbench_document_initialization import build_initial_documents
            initial_documents = await asyncio.to_thread(build_initial_documents, str(new_root))
            _require_current_switch(new_root, project_generation)
            switch_response = await adapter_rpc(
                "adapter.reconnect",
                {"workspaceFolder": str(new_root), "initialDocuments": initial_documents},
                75,
            )
            _require_switch_ack(switch_response, method="adapter.reconnect")
            await _mark_adapter_workspace_ready(new_root)
            adapter_status = "ready"
            await _reset_project_diagnostics(new_root, project_generation=project_generation)
            logger.info("[project_open] adapter reconnected to workspace %s", new_root)
        except Exception as exc:
            adapter_status = "error"
            try:
                await _mark_adapter_workspace_error(new_root, str(exc))
            except Exception:
                pass
            logger.warning(
                "[project_open] adapter reconnect failed: %s",
                exc,
            )

    _require_current_switch(new_root, project_generation)
    await _start_project_watchexec_if_needed(new_root)
    open_state = await _replay_sidecar_open_state(
        new_root,
        reason=open_state_reason,
        source=open_state_source,
        project_generation=project_generation,
    )
    _require_current_switch(new_root, project_generation)
    await publish(
        build_event(
            "ProjectSwitchFinished",
            project_root=new_root,
            project_generation=project_generation,
            source=open_state_source,
            correlation_id=switch_id or None,
            payload={
                "displayPath": normalized_display_path,
                "reason": open_state_reason,
                "source": open_state_source,
                "switchId": switch_id,
                "adapterStatus": adapter_status,
                "status": "ready" if adapter_status != "error" else "error",
                "new_sidecar": was_new_sidecar,
                "openState": open_state if isinstance(open_state, dict) else None,
            },
        )
    )

    # Every entry point uses the working Explorer refresh, after the opened fact
    # that resets the tree. One refresh publishes listings/Git/review to all peers.
    if not await refresh_explorer_project(new_root, project_generation):
        _require_current_switch(new_root, project_generation)
        await _broadcast_project_git_state(new_root, project_generation=project_generation)
    _require_current_switch(new_root, project_generation)

    return ExplorerProjectSwitchResult(
        project_root=new_root,
        display_path=normalized_display_path,
        was_new_sidecar=was_new_sidecar,
        project_generation=project_generation,
        open_state=open_state if isinstance(open_state, dict) else None,
    )


def _require_current_switch(project_root: Path, generation: int) -> None:
    if current_project_generation(project_root) != generation:
        raise RuntimeError("Project switch superseded by a newer project selection")


def _get_explorer_project_hooks() -> tuple[SyncExplorerProject, RefreshExplorerProject]:
    # Resolve required runtime hooks lazily: the Explorer dispatcher imports this
    # service too, so eager transport imports would form an initialization cycle.
    from ..transport.rpc_socketio import (
        sync_active_explorer_dispatchers_project_root,
        refresh_active_explorer_project,
    )
    return sync_active_explorer_dispatchers_project_root, refresh_active_explorer_project


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
            _ = await ensure_watchexec_shell(
                str(project_root),
                watcher_config["poll_interval_ms"],
            )
    except Exception as exc:
        logger.warning("[project_open] watchexec start failed: %s", exc)


def _next_project_switch_id() -> str:
    global _project_switch_seq
    _project_switch_seq += 1
    return f"project_switch_{int(time.time() * 1000)}_{_project_switch_seq}"


async def _replay_sidecar_open_state(
    project_root: Path,
    *,
    reason: str,
    source: str,
    project_generation: int,
) -> dict[str, object] | None:
    from ...monaco_editor.editor_ws import editor_runtime_replay_sidecar_open_state

    return await editor_runtime_replay_sidecar_open_state(
        str(project_root),
        reason=reason,
        source=source,
        project_generation=project_generation,
    )


async def _broadcast_project_git_state(
    project_root: Path,
    *,
    project_generation: int,
) -> None:
    try:
        from .runtime_notifications import broadcast_git_status_update

        _ = await broadcast_git_status_update(
            project_root,
            project_generation=project_generation,
            source="project_switch:replay",
        )
    except Exception as exc:
        logger.warning("[project_open] git state replay failed: %s", exc)


async def _reset_project_diagnostics(
    project_root: Path,
    *,
    project_generation: int,
) -> None:
    try:
        from ...diagnostics_bridge import reset_diagnostics_projection_for_project

        await reset_diagnostics_projection_for_project(project_root, project_generation=project_generation)
    except Exception as exc:
        logger.warning("[project_open] diagnostics reset failed: %s", exc)


def _sidecar_data_dict(sidecar: ProjectSidecar) -> dict[str, object]:
    return sidecar._data


def _get_adapter_rpc() -> AdapterRpc:
    from ...workbench_adapter_shell_manager import adapter_rpc

    return adapter_rpc


def _require_switch_ack(response: object, *, method: str = "adapter.switchWorkspace") -> None:
    if not isinstance(response, dict):
        raise RuntimeError(f"{method} returned non-object response")
    response_obj = cast(dict[str, object], response)
    raw_error = response_obj.get("error")
    if isinstance(raw_error, dict):
        error = cast(dict[str, object], raw_error)
        message = error.get("message")
        raise RuntimeError(str(message if isinstance(message, str) and message else error))
    raw_result = response_obj.get("result")
    if not isinstance(raw_result, dict):
        raise RuntimeError(f"{method} returned response without object result")
    result = cast(dict[str, object], raw_result)
    if result.get("ok") is not True or result.get("readyForDocumentOpen") is not True:
        raise RuntimeError(f"{method} did not ack readyForDocumentOpen")


async def _mark_adapter_workspace_switching(project_root: Path) -> None:
    from ...workbench_adapter_shell_manager import mark_adapter_workspace_switching

    await mark_adapter_workspace_switching(str(project_root))


async def _mark_adapter_workspace_ready(project_root: Path) -> None:
    from ...workbench_adapter_shell_manager import mark_adapter_workspace_ready

    await mark_adapter_workspace_ready(str(project_root))


async def _mark_adapter_workspace_error(project_root: Path, error: str) -> None:
    from ...workbench_adapter_shell_manager import mark_adapter_workspace_error

    await mark_adapter_workspace_error(str(project_root), error)


def _get_ensure_watchexec_shell() -> EnsureWatchexecShell:
    from ...watchexec_shell_manager import ensure_watchexec_shell

    return ensure_watchexec_shell
