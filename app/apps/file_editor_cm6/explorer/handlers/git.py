# pyright: strict
from __future__ import annotations

import importlib
import logging
from typing import Protocol, cast

from ..contracts.git import (
    GitCommitParams,
    GitDiffBaseParams,
    GitListCommitsParams,
    GitNoParams,
    GitPathListParams,
    GitPullParams,
    GitPushParams,
    GitResetParams,
    GitRestoreParams,
)
from ..context import ExplorerGitHandlerContext
from ..services.tracked_jobs import get_job_manager, remember_tracked_job
from ..services.file_ops import mark_git_cache_dirty
from ...git_helper import (
    commit_changes,
    get_commit_info,
    get_commits as git_get_commits,
    init_repository,
    is_git_repository,
    list_branches as git_list_branches,
    reset_hard,
    restore_path,
    stage_all as git_stage_all,
    stage_paths,
    unstage_all as git_unstage_all,
    unstage_paths,
)

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
    stage_paths(context.project_root, params["paths"])
    await _mark_dirty_and_refresh(context)


async def handle_git_unstage(
    context: ExplorerGitHandlerContext,
    params: GitPathListParams,
    msg_id: str | None,
) -> None:
    del msg_id
    unstage_paths(context.project_root, params["paths"])
    await _mark_dirty_and_refresh(context)


async def handle_git_stage_all(
    context: ExplorerGitHandlerContext,
    params: GitNoParams,
    msg_id: str | None,
) -> None:
    del params, msg_id
    git_stage_all(context.project_root)
    await _mark_dirty_and_refresh(context)


async def handle_git_unstage_all(
    context: ExplorerGitHandlerContext,
    params: GitNoParams,
    msg_id: str | None,
) -> None:
    del params, msg_id
    git_unstage_all(context.project_root)
    await _mark_dirty_and_refresh(context)


async def handle_git_restore(
    context: ExplorerGitHandlerContext,
    params: GitRestoreParams,
    msg_id: str | None,
) -> None:
    del msg_id
    restore_path(context.project_root, params["path"], params["commit"])
    mark_git_cache_dirty(context.project_root)
    await context.broadcast("explorer.git.restored", {"path": params["path"]})
    await context.broadcast_git_status()


async def handle_git_commit(
    context: ExplorerGitHandlerContext,
    params: GitCommitParams,
    msg_id: str | None,
) -> None:
    del msg_id
    commit_changes(context.project_root, params["message"], params["amend"])
    await _mark_dirty_and_refresh(context)
    await context.broadcast("explorer.git.diffBase.updated", {"ref": "HEAD", "refresh": True})


async def handle_git_push(
    context: ExplorerGitHandlerContext,
    params: GitPushParams,
    msg_id: str | None,
) -> None:
    logger.info("[GIT_PUSH] Starting push job for %s", context.project_root)
    try:
        job = get_job_manager().create_job(
            "git_push",
            {
                "repo_path": str(context.project_root),
                "remote": params["remote"],
                "branch": params["branch"],
                "force": params["force"],
            },
        )
        logger.info("[GIT_PUSH] Created job %s, tracking it", job.id)
        remember_tracked_job(context.project_root, context.tracked_job_ids, job.id)
        await context.emit_personal("explorer.git.push.started", {"job_id": job.id}, msg_id)
    except Exception as exc:
        logger.exception("[GIT_PUSH] Failed to create job: %s", exc)
        raise RuntimeError(f"Failed to start push: {exc}") from exc


async def handle_git_pull(
    context: ExplorerGitHandlerContext,
    params: GitPullParams,
    msg_id: str | None,
) -> None:
    try:
        job = get_job_manager().create_job(
            "git_pull",
            {
                "repo_path": str(context.project_root),
                "remote": params["remote"],
                "branch": params["branch"],
                "rebase": params["rebase"],
            },
        )
        remember_tracked_job(context.project_root, context.tracked_job_ids, job.id)
        await context.emit_personal("explorer.git.pull.started", {"job_id": job.id}, msg_id)
    except Exception as exc:
        raise RuntimeError(f"Failed to start pull: {exc}") from exc


async def handle_git_reset(
    context: ExplorerGitHandlerContext,
    params: GitResetParams,
    msg_id: str | None,
) -> None:
    del msg_id
    reset_hard(context.project_root, params["commit"])
    await _mark_dirty_and_refresh(context)


async def handle_git_init(
    context: ExplorerGitHandlerContext,
    params: GitNoParams,
    msg_id: str | None,
) -> None:
    del params, msg_id
    init_repository(context.project_root)
    await context.broadcast_git_status()


async def handle_git_set_diff_base(
    context: ExplorerGitHandlerContext,
    params: GitDiffBaseParams,
    msg_id: str | None,
) -> None:
    del msg_id
    get_commit_info(context.project_root, params["ref"])
    history_store = _get_history_store()
    history_store.set_diff_base(str(context.project_root), params["ref"])
    await context.broadcast("explorer.git.diffBase.updated", {"ref": params["ref"]})
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

    if context.project_root.exists() and is_git_repository(context.project_root):
        mode = "head" if base_ref == "HEAD" else "detached"
        try:
            commit = get_commit_info(context.project_root, base_ref)
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


async def handle_git_list_branches(
    context: ExplorerGitHandlerContext,
    params: GitNoParams,
    msg_id: str | None,
) -> None:
    del params
    branches = git_list_branches(context.project_root)
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
    commits = git_get_commits(context.project_root, params["limit"])
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
