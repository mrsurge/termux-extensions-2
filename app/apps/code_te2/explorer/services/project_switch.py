# pyright: strict
from __future__ import annotations

import importlib
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
from ...worker_services.event_bus import build_event, next_project_generation, publish
from ..contracts.watcher import build_watcher_config_payload
from .project_session import reset_project_session

logger = logging.getLogger(__name__)

AdapterRpc = Callable[[str, dict[str, object] | None, float], Awaitable[object]]
EnsureWatchexecShell = Callable[[str, int], Awaitable[object | None]]
MarkAdapterWorkspaceStateFn = Callable[..., Awaitable[None]]
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

    del initialize_watcher

    was_new_sidecar = await reset_project_session(normalized_display_path)
    if websocket is not None:
        manager.register_existing(websocket, str(new_root))
    manager.reassign_all(str(new_root))
    await _reset_project_diagnostics(new_root, project_generation=project_generation)

    if switch_adapter_workspace:
        try:
            await _mark_adapter_workspace_switching(new_root)
            adapter_status = "switching"
            adapter_rpc = _get_adapter_rpc()
            switch_response = await adapter_rpc(
                "adapter.reconnect",
                {"workspaceFolder": str(new_root)},
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

    await _start_project_watchexec_if_needed(new_root)
    open_state = await _replay_sidecar_open_state(
        new_root,
        reason=open_state_reason,
        source=open_state_source,
        project_generation=project_generation,
    )
    await _broadcast_project_git_state(new_root, project_generation=project_generation)
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

    return ExplorerProjectSwitchResult(
        project_root=new_root,
        display_path=normalized_display_path,
        was_new_sidecar=was_new_sidecar,
        project_generation=project_generation,
        open_state=open_state if isinstance(open_state, dict) else None,
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
    editor_module = importlib.import_module("app.apps.code_te2.monaco_editor.editor_ws")
    replay_obj = getattr(editor_module, "editor_runtime_replay_sidecar_open_state", None)
    if not callable(replay_obj):
        raise RuntimeError("editor_runtime_replay_sidecar_open_state unavailable")
    replay = cast(Callable[..., Awaitable[object | None]], replay_obj)
    result = await replay(
        str(project_root),
        reason=reason,
        source=source,
        project_generation=project_generation,
    )
    return cast(dict[str, object], result) if isinstance(result, dict) else None


async def _broadcast_project_git_state(
    project_root: Path,
    *,
    project_generation: int,
) -> None:
    try:
        from .runtime_notifications import broadcast_git_status_update

        await broadcast_git_status_update(
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
        diagnostics_module = importlib.import_module(
            "app.apps.code_te2.diagnostics_bridge"
        )
        reset_obj = getattr(
            diagnostics_module,
            "reset_diagnostics_projection_for_project",
            None,
        )
        if not callable(reset_obj):
            return
        reset = cast(Callable[..., Awaitable[None]], reset_obj)
        await reset(project_root, project_generation=project_generation)
    except Exception as exc:
        logger.warning("[project_open] diagnostics reset failed: %s", exc)


def _sidecar_data_dict(sidecar: ProjectSidecar) -> dict[object, object] | None:
    data = getattr(sidecar, "_data", None)
    if not isinstance(data, dict):
        return None
    return cast(dict[object, object], data)


def _get_adapter_rpc() -> AdapterRpc:
    adapter_module = importlib.import_module(
        "app.apps.code_te2.workbench_adapter_shell_manager"
    )
    adapter_rpc_obj = getattr(adapter_module, "adapter_rpc", None)
    if not callable(adapter_rpc_obj):
        raise RuntimeError("adapter_rpc unavailable")
    return cast(AdapterRpc, adapter_rpc_obj)


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
    adapter_module = importlib.import_module(
        "app.apps.code_te2.workbench_adapter_shell_manager"
    )
    marker_obj = getattr(adapter_module, "mark_adapter_workspace_switching", None)
    if not callable(marker_obj):
        return
    marker = cast(MarkAdapterWorkspaceStateFn, marker_obj)
    await marker(str(project_root))


async def _mark_adapter_workspace_ready(project_root: Path) -> None:
    adapter_module = importlib.import_module(
        "app.apps.code_te2.workbench_adapter_shell_manager"
    )
    marker_obj = getattr(adapter_module, "mark_adapter_workspace_ready", None)
    if not callable(marker_obj):
        return
    marker = cast(MarkAdapterWorkspaceStateFn, marker_obj)
    await marker(str(project_root))


async def _mark_adapter_workspace_error(project_root: Path, error: str) -> None:
    adapter_module = importlib.import_module(
        "app.apps.code_te2.workbench_adapter_shell_manager"
    )
    marker_obj = getattr(adapter_module, "mark_adapter_workspace_error", None)
    if not callable(marker_obj):
        return
    marker = cast(MarkAdapterWorkspaceStateFn, marker_obj)
    await marker(str(project_root), str(error))


def _get_ensure_watchexec_shell() -> EnsureWatchexecShell:
    watchexec_module = importlib.import_module(
        "app.apps.code_te2.watchexec_shell_manager"
    )
    ensure_shell_obj = getattr(watchexec_module, "ensure_watchexec_shell", None)
    if not callable(ensure_shell_obj):
        raise RuntimeError("ensure_watchexec_shell unavailable")
    return cast(EnsureWatchexecShell, ensure_shell_obj)
