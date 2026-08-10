# pyright: strict
from __future__ import annotations

import asyncio
import importlib
import logging
import os
from pathlib import Path
from typing import Callable, Protocol, cast

from ..contracts.project import (
    GitCloneParams,
    ProjectCreateParams,
    ProjectListParams,
    ProjectOpenParams,
)
from ..context import ExplorerProjectHandlerContext
from ..services.project_switch import (
    ExplorerProjectSwitchResult,
    switch_project_connection,
)
from ..services.tracked_jobs import forget_tracked_job, remember_tracked_job
from ...worker_services import git_service as worker_git_service

logger = logging.getLogger(__name__)
ExplorerHelperCall = Callable[..., object]


class ExplorerHistoryStore(Protocol):
    def list_projects(self) -> list[dict[str, object]]: ...


async def handle_project_open(
    context: ExplorerProjectHandlerContext,
    params: ProjectOpenParams,
    msg_id: str | None,
) -> ExplorerProjectSwitchResult:
    switch_result = await switch_project_connection(
        context.websocket,
        params["path"],
        initialize_watcher=False,
        switch_adapter_workspace=True,
        open_state_reason="explorer_project_open",
    )
    context.set_project_root(switch_result.project_root)
    await context.emit_personal(
        "explorer.project.opened",
        {
            "path": switch_result.display_path,
            "resolved_path": str(switch_result.project_root),
            "new_sidecar": switch_result.was_new_sidecar,
            "openState": switch_result.open_state,
        },
        msg_id,
    )
    return switch_result


async def handle_project_create(
    context: ExplorerProjectHandlerContext,
    params: ProjectCreateParams,
    msg_id: str | None,
) -> ExplorerProjectSwitchResult:
    project_payload = _call_explorer_helper_dict(
        "create_project",
        params["parent_path"],
        params["name"],
    )
    project_path = _require_project_path(project_payload)
    open_params: ProjectOpenParams = {"path": project_path}
    return await handle_project_open(context, open_params, msg_id)


async def handle_project_list(
    context: ExplorerProjectHandlerContext,
    params: ProjectListParams,
    msg_id: str | None,
) -> None:
    del params
    projects = _get_history_store().list_projects()
    await context.emit_personal("project:list", {"projects": projects}, msg_id)


async def handle_git_clone(
    context: ExplorerProjectHandlerContext,
    params: GitCloneParams,
    msg_id: str | None,
) -> ExplorerProjectSwitchResult:
    target_display = os.path.abspath(os.path.expanduser(params["target_path"]))
    target = Path(params["target_path"]).expanduser().resolve()
    logger.info("[GIT_CLONE] Target: %s", target)

    if target.exists():
        if any(target.iterdir()):
            raise RuntimeError(
                f"Directory '{target}' already exists and is not empty"
            )
    else:
        target.mkdir(parents=True, exist_ok=True)

    switch_result = await switch_project_connection(
        context.websocket,
        str(target),
        display_path=target_display,
        initialize_watcher=True,
        switch_adapter_workspace=False,
        open_state_reason="explorer_git_clone",
    )
    context.set_project_root(switch_result.project_root)

    await context.emit_personal(
        "explorer.project.opened",
        {
            "path": switch_result.display_path,
            "resolved_path": str(switch_result.project_root),
            "new_sidecar": switch_result.was_new_sidecar,
            "openState": switch_result.open_state,
        },
        None,
    )

    op_id = worker_git_service.new_git_job_op_id("git_clone")
    remember_tracked_job(switch_result.project_root, context.tracked_job_ids, op_id)
    try:
        _ = await asyncio.to_thread(
            worker_git_service.start_clone_job,
            switch_result.project_root,
            url=params["url"],
            destination=str(target),
            branch=params["branch"],
            depth=_clone_depth(params["depth"]),
            op_id=op_id,
        )
        await context.emit_personal(
            "explorer.git.clone.started",
            {"job_id": op_id, "target_path": str(target)},
            msg_id,
        )
    except Exception:
        forget_tracked_job(switch_result.project_root, context.tracked_job_ids, op_id)
        raise
    return switch_result


def _clone_depth(value: int | str | None) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    try:
        parsed = int(value.strip())
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def _call_explorer_helper_dict(name: str, *args: object) -> dict[str, object]:
    helper = _get_explorer_helper_callable(name)
    result = helper(*args)
    if not isinstance(result, dict):
        return {}
    normalized: dict[str, object] = {}
    for key, item in cast(dict[object, object], result).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized


def _get_explorer_helper_callable(name: str) -> ExplorerHelperCall:
    helper_module = importlib.import_module("app.apps.code_te2.explorer.services.file_ops")
    helper = getattr(helper_module, name, None)
    if not callable(helper):
        raise RuntimeError(f"explorer.services.file_ops.{name} unavailable")
    return helper


def _require_project_path(payload: dict[str, object]) -> str:
    path = payload.get("path")
    if isinstance(path, str) and path:
        return path
    raise RuntimeError("create_project did not return a project path")


def _get_history_store() -> ExplorerHistoryStore:
    stores_module = importlib.import_module("app.apps.code_te2.stores")
    history_store = getattr(stores_module, "_history_store", None)
    if history_store is None:
        raise RuntimeError("_history_store unavailable")
    return cast(ExplorerHistoryStore, history_store)
