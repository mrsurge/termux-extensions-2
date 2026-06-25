# pyright: strict
from __future__ import annotations

import asyncio
import importlib
import logging
from typing import Protocol, cast

from ..contracts.git import (
    GitCommitParams,
    GitDiffBaseParams,
    GitJobCancelParams,
    GitListCommitsParams,
    GitNoParams,
    GitPathListParams,
    GitPullParams,
    GitPushParams,
    GitResetParams,
    GitRestoreParams,
)
from ..context import ExplorerGitHandlerContext
from ..services.state_facts import (
    publish_git_diff_base_changed,
    publish_git_path_restored,
)
from ..services.tracked_jobs import forget_tracked_job, remember_tracked_job
from ..services.file_ops import mark_git_cache_dirty
from ...worker_services import git_service as worker_git_service

logger = logging.getLogger(__name__)


class ExplorerHistoryStore(Protocol):
    def get_diff_base(self, project_path: str | None) -> str: ...

    def set_diff_base(self, project_path: str, ref: str | None) -> str: ...


async def handle_git_status(
    context: ExplorerGitHandlerContext,
    params: GitNoParams,
    msg_id: str | None,
) -> None:
    del params, msg_id
    await _mark_dirty_and_refresh(context)


async def handle_git_stage(
    context: ExplorerGitHandlerContext,
    params: GitPathListParams,
    msg_id: str | None,
) -> None:
    del msg_id
    _ = await asyncio.to_thread(
        worker_git_service.stage_paths,
        context.project_root,
        params["paths"],
    )
    await _mark_dirty_and_refresh(context)


async def handle_git_unstage(
    context: ExplorerGitHandlerContext,
    params: GitPathListParams,
    msg_id: str | None,
) -> None:
    del msg_id
    _ = await asyncio.to_thread(
        worker_git_service.unstage_paths,
        context.project_root,
        params["paths"],
    )
    await _mark_dirty_and_refresh(context)


async def handle_git_stage_all(
    context: ExplorerGitHandlerContext,
    params: GitNoParams,
    msg_id: str | None,
) -> None:
    del params, msg_id
    _ = await asyncio.to_thread(worker_git_service.stage_all, context.project_root)
    await _mark_dirty_and_refresh(context)


async def handle_git_unstage_all(
    context: ExplorerGitHandlerContext,
    params: GitNoParams,
    msg_id: str | None,
) -> None:
    del params, msg_id
    _ = await asyncio.to_thread(worker_git_service.unstage_all, context.project_root)
    await _mark_dirty_and_refresh(context)


async def handle_git_restore(
    context: ExplorerGitHandlerContext,
    params: GitRestoreParams,
    msg_id: str | None,
) -> None:
    del msg_id
    await asyncio.to_thread(
        worker_git_service.restore_path,
        context.project_root,
        params["path"],
        params["commit"],
    )
    mark_git_cache_dirty(context.project_root)
    await publish_git_path_restored(
        context.project_root,
        path=params["path"],
        source="explorer_git:restore",
    )
    await context.broadcast_git_status()


async def handle_git_commit(
    context: ExplorerGitHandlerContext,
    params: GitCommitParams,
    msg_id: str | None,
) -> None:
    del msg_id
    _ = await asyncio.to_thread(
        worker_git_service.commit_changes,
        context.project_root,
        params["message"],
        params["amend"],
    )
    await _mark_dirty_and_refresh(context)
    await publish_git_diff_base_changed(
        context.project_root,
        ref="HEAD",
        refresh=True,
        source="explorer_git:commit",
    )


async def handle_git_push(
    context: ExplorerGitHandlerContext,
    params: GitPushParams,
    msg_id: str | None,
) -> None:
    op_id = worker_git_service.new_git_job_op_id("git_push")
    remember_tracked_job(context.project_root, context.tracked_job_ids, op_id)
    logger.info("[GIT_PUSH] Starting pipe push job %s for %s", op_id, context.project_root)
    try:
        _ = await asyncio.to_thread(
            worker_git_service.start_push_job,
            context.project_root,
            remote=params["remote"],
            branch=params["branch"],
            force=params["force"],
            op_id=op_id,
        )
        await context.emit_personal("explorer.git.push.started", {"job_id": op_id}, msg_id)
    except Exception as exc:
        forget_tracked_job(context.project_root, context.tracked_job_ids, op_id)
        logger.exception("[GIT_PUSH] Failed to start pipe job: %s", exc)
        raise RuntimeError(f"Failed to start push: {exc}") from exc


async def handle_git_pull(
    context: ExplorerGitHandlerContext,
    params: GitPullParams,
    msg_id: str | None,
) -> None:
    op_id = worker_git_service.new_git_job_op_id("git_pull")
    remember_tracked_job(context.project_root, context.tracked_job_ids, op_id)
    try:
        _ = await asyncio.to_thread(
            worker_git_service.start_pull_job,
            context.project_root,
            remote=params["remote"],
            branch=params["branch"],
            rebase=params["rebase"],
            op_id=op_id,
        )
        await context.emit_personal("explorer.git.pull.started", {"job_id": op_id}, msg_id)
    except Exception as exc:
        forget_tracked_job(context.project_root, context.tracked_job_ids, op_id)
        raise RuntimeError(f"Failed to start pull: {exc}") from exc


async def handle_git_reset(
    context: ExplorerGitHandlerContext,
    params: GitResetParams,
    msg_id: str | None,
) -> None:
    del msg_id
    _ = await asyncio.to_thread(
        worker_git_service.reset_hard,
        context.project_root,
        params["commit"],
    )
    _ = await _mark_dirty_and_refresh(context)


async def handle_git_init(
    context: ExplorerGitHandlerContext,
    params: GitNoParams,
    msg_id: str | None,
) -> None:
    del params, msg_id
    _ = await asyncio.to_thread(worker_git_service.init_repository, context.project_root)
    await context.broadcast_git_status()


async def handle_git_set_diff_base(
    context: ExplorerGitHandlerContext,
    params: GitDiffBaseParams,
    msg_id: str | None,
) -> None:
    del msg_id
    _ = await asyncio.to_thread(
        worker_git_service.get_commit_info,
        context.project_root,
        params["ref"],
    )
    history_store = _get_history_store()
    _ = history_store.set_diff_base(str(context.project_root), params["ref"])
    await publish_git_diff_base_changed(
        context.project_root,
        ref=params["ref"],
        refresh=False,
        source="explorer_git:set_diff_base",
    )
    mark_git_cache_dirty(context.project_root)
    await context.broadcast_git_status()


async def handle_git_get_diff_base(
    context: ExplorerGitHandlerContext,
    params: GitNoParams,
    msg_id: str | None,
) -> None:
    del params
    history_store = _get_history_store()
    base_ref = history_store.get_diff_base(str(context.project_root)).strip() or "HEAD"
    mode = "none"
    commit_info: dict[str, object] | None = None

    if context.project_root.exists() and worker_git_service.is_git_repository(
        context.project_root
    ):
        mode = "head" if base_ref == "HEAD" else "detached"
        try:
            commit = await asyncio.to_thread(
                worker_git_service.get_commit_info,
                context.project_root,
                base_ref,
            )
        except Exception:
            commit = None
        if commit:
            commit_info = {
                "hash": commit.hash,
                "short": commit.short_hash,
                "subject": commit.summary,
                "author": commit.author,
                "date": commit.date,
            }

    await context.emit_personal(
        "git:diffBase",
        {"ref": base_ref, "mode": mode, "commit": commit_info},
        msg_id,
    )


async def handle_git_job_cancel(
    context: ExplorerGitHandlerContext,
    params: GitJobCancelParams,
    msg_id: str | None,
) -> None:
    result = await asyncio.to_thread(
        worker_git_service.cancel_git_job,
        context.project_root,
        job_id=params["job_id"],
        reason=params["reason"],
    )
    if not result["ok"]:
        forget_tracked_job(context.project_root, context.tracked_job_ids, params["job_id"])
    await context.emit_personal(
        "git:jobCancel",
        {
            "job_id": result["opId"] or result["jobId"] or params["job_id"],
            "provider_job_id": result["jobId"],
            "ok": result["ok"],
            "status": result["status"],
        },
        msg_id,
    )


async def handle_git_list_branches(
    context: ExplorerGitHandlerContext,
    params: GitNoParams,
    msg_id: str | None,
) -> None:
    del params
    branches = await asyncio.to_thread(worker_git_service.list_branches, context.project_root)
    await context.emit_personal(
        "git:branches",
        {"current": branches.current, "branches": branches.branches},
        msg_id,
    )


async def handle_git_list_commits(
    context: ExplorerGitHandlerContext,
    params: GitListCommitsParams,
    msg_id: str | None,
) -> None:
    commits = await asyncio.to_thread(
        worker_git_service.get_commits,
        context.project_root,
        params["limit"],
    )
    commit_entries: list[dict[str, str]] = [
        {
            "hash": commit.hash,
            "short_hash": commit.short_hash,
            "summary": commit.summary,
        }
        for commit in commits
    ]
    payload: dict[str, object] = {"commits": commit_entries}
    await context.emit_personal("git:commits", payload, msg_id)


async def _mark_dirty_and_refresh(context: ExplorerGitHandlerContext) -> None:
    mark_git_cache_dirty(context.project_root)
    await context.broadcast_git_status()


def _get_history_store() -> ExplorerHistoryStore:
    stores_module = importlib.import_module("app.apps.file_editor_cm6.stores")
    history_store = getattr(stores_module, "_history_store", None)
    if history_store is None:
        raise RuntimeError("_history_store unavailable")
    return cast(ExplorerHistoryStore, history_store)
