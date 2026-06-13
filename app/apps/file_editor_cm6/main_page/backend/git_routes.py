# pyright: strict, reportUnusedFunction=false
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Protocol, cast

from fastapi import APIRouter, Body, HTTPException, Query

from ...git_helper import GitBranches, GitCommit, GitError, GitStatus
from ...worker_services import git_service as worker_git_service
from .state_payload import JsonObject


class HistoryStoreLike(Protocol):
    def get_active_project(self) -> str | None: ...

    def set_diff_base(self, project_path: str, ref: str | None) -> str: ...

    def set_project_origin(self, project_path: str, origin: str | None) -> None: ...


class CommitChangesFn(Protocol):
    def __call__(self, project_root: Path, message: str, amend: bool = False) -> GitStatus: ...


class PushChangesFn(Protocol):
    def __call__(
        self,
        project_root: Path,
        remote: str | None = None,
        branch: str | None = None,
        force: bool = False,
    ) -> GitStatus: ...


class PullChangesFn(Protocol):
    def __call__(
        self,
        project_root: Path,
        remote: str | None = None,
        branch: str | None = None,
        rebase: bool = False,
    ) -> GitStatus: ...


class InvalidateDiffCacheFn(Protocol):
    def __call__(self, project_root: Path | None = None, rel_path: str | None = None) -> None: ...


@dataclass(frozen=True, slots=True)
class GitRoutesDeps:
    history: HistoryStoreLike
    get_active_project_root: Callable[[], Path]
    get_project_root: Callable[[], Path]
    list_branches: Callable[[Path], GitBranches]
    checkout_branch: Callable[[Path, str], GitBranches]
    create_branch: Callable[[Path, str], GitBranches]
    get_status: Callable[[Path], GitStatus]
    stage_all: Callable[[Path], GitStatus]
    unstage_all: Callable[[Path], GitStatus]
    commit_changes: CommitChangesFn
    push_changes: PushChangesFn
    pull_changes: PullChangesFn
    stage_paths: Callable[[Path, list[str]], GitStatus]
    unstage_paths: Callable[[Path, list[str]], GitStatus]
    get_commits_for_path: Callable[[Path, str, int], list[GitCommit]]
    restore_path: Callable[[Path, str, str], None]
    get_commits: Callable[[Path, int], list[GitCommit]]
    reset_hard: Callable[[Path, str], GitStatus]
    is_git_repository: Callable[[Path], bool]
    init_repository: Callable[[Path], GitStatus]
    get_commit_info: Callable[[Path, str], GitCommit | None]
    add_remote: Callable[[Path, str, str], None]
    get_origin_url: Callable[[Path], str | None]
    status_to_payload: Callable[[GitStatus], JsonObject]
    diff_base_payload: Callable[[str | None], JsonObject]
    invalidate_diff_cache: InvalidateDiffCacheFn
    mark_git_cache_dirty: Callable[[Path], None]


def _string_payload(payload: JsonObject, key: str) -> str | None:
    value = payload.get(key)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _bool_payload(payload: JsonObject, key: str) -> bool:
    return bool(payload.get(key))


def _path_list_payload(payload: JsonObject) -> list[str]:
    value = payload.get("paths")
    if not isinstance(value, list):
        return []

    paths: list[str] = []
    for item in cast(list[object], value):
        if isinstance(item, str) and item:
            paths.append(item)
    return paths


def _branches_payload(info: GitBranches) -> JsonObject:
    return {"current": info.current, "branches": info.branches}


def _commit_payload(commit: GitCommit) -> JsonObject:
    return {
        "hash": commit.hash,
        "short_hash": commit.short_hash,
        "summary": commit.summary,
        "author": commit.author,
        "date": commit.date,
    }


def _handle_git_error(exc: GitError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


def create_git_router(deps: GitRoutesDeps) -> APIRouter:
    router = APIRouter()

    @router.get("/git/branches", response_model=None)
    def git_branches() -> JsonObject:
        try:
            project_root = deps.get_active_project_root()
            info = deps.list_branches(project_root)
            return {"ok": True, "data": _branches_payload(info)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/checkout", response_model=None)
    async def git_checkout_route(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        name = _string_payload(data, "name")
        if not name:
            raise HTTPException(status_code=400, detail="Branch name required")
        try:
            project_root = deps.get_active_project_root()
            info = deps.checkout_branch(project_root, name)
            return {"ok": True, "data": _branches_payload(info)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/branch", response_model=None)
    async def git_create_branch_route(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        name = _string_payload(data, "name")
        if not name:
            raise HTTPException(status_code=400, detail="Branch name required")
        try:
            project_root = deps.get_active_project_root()
            info = deps.create_branch(project_root, name)
            return {"ok": True, "data": _branches_payload(info)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.get("/git/status", response_model=None)
    def git_status_route() -> JsonObject:
        try:
            project_root = deps.get_active_project_root()
            status = worker_git_service.get_status(project_root)
            return {"ok": True, "data": deps.status_to_payload(status)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.get("/git/diff_base", response_model=None)
    def git_diff_base_route() -> JsonObject:
        project_path = deps.history.get_active_project()
        return {"ok": True, "data": deps.diff_base_payload(project_path)}

    @router.post("/git/diff_base", response_model=None)
    def git_set_diff_base_route(payload: Annotated[JsonObject, Body(...)]) -> JsonObject:
        project_path = deps.history.get_active_project()
        if not project_path:
            raise HTTPException(status_code=400, detail="No project selected")

        ref = _string_payload(payload, "ref") or "HEAD"
        project_root = deps.get_active_project_root()
        if not deps.is_git_repository(project_root):
            raise HTTPException(status_code=400, detail="Not a git repository")

        if ref != "HEAD":
            try:
                commit = deps.get_commit_info(project_root, ref)
            except GitError as exc:
                raise _handle_git_error(exc) from exc
            if not commit:
                raise HTTPException(status_code=400, detail="Commit not found")

        deps.history.set_diff_base(project_path, ref)
        deps.invalidate_diff_cache(project_root)
        deps.mark_git_cache_dirty(project_root)
        return {"ok": True, "data": deps.diff_base_payload(project_path)}

    @router.post("/git/stage_all", response_model=None)
    def git_stage_all_route() -> JsonObject:
        try:
            project_root = deps.get_active_project_root()
            status = deps.stage_all(project_root)
            return {"ok": True, "data": deps.status_to_payload(status)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/unstage_all", response_model=None)
    def git_unstage_all_route() -> JsonObject:
        try:
            project_root = deps.get_active_project_root()
            status = deps.unstage_all(project_root)
            return {"ok": True, "data": deps.status_to_payload(status)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/commit", response_model=None)
    async def git_commit_route(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        message = _string_payload(data, "message")
        amend = _bool_payload(data, "amend")
        if not message:
            raise HTTPException(status_code=400, detail="Commit message required")
        try:
            project_root = deps.get_active_project_root()
            status = deps.commit_changes(project_root, message, amend=amend)
            return {"ok": True, "data": deps.status_to_payload(status)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/push", response_model=None)
    async def git_push_route(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        remote = _string_payload(data, "remote")
        branch = _string_payload(data, "branch")
        force = _bool_payload(data, "force")
        try:
            project_root = deps.get_active_project_root()
            status = deps.push_changes(project_root, remote=remote, branch=branch, force=force)
            return {"ok": True, "data": deps.status_to_payload(status)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/pull", response_model=None)
    async def git_pull_route(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        remote = _string_payload(data, "remote")
        branch = _string_payload(data, "branch")
        rebase = _bool_payload(data, "rebase")
        try:
            project_root = deps.get_active_project_root()
            status = deps.pull_changes(project_root, remote=remote, branch=branch, rebase=rebase)
            return {"ok": True, "data": deps.status_to_payload(status)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/stage", response_model=None)
    async def git_stage_route(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        paths = _path_list_payload(data)
        if not paths:
            raise HTTPException(status_code=400, detail="Paths required")
        try:
            project_root = deps.get_active_project_root()
            status = deps.stage_paths(project_root, paths)
            deps.mark_git_cache_dirty(project_root)
            return {"ok": True, "data": deps.status_to_payload(status)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/unstage", response_model=None)
    async def git_unstage_route(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        paths = _path_list_payload(data)
        if not paths:
            raise HTTPException(status_code=400, detail="Paths required")
        try:
            project_root = deps.get_active_project_root()
            status = deps.unstage_paths(project_root, paths)
            deps.mark_git_cache_dirty(project_root)
            return {"ok": True, "data": deps.status_to_payload(status)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.get("/git/commits_for_path", response_model=None)
    async def git_commits_for_path(path: str = Query(...), limit: int = Query(20)) -> JsonObject:
        try:
            project_root = deps.get_active_project_root()
            commits = deps.get_commits_for_path(project_root, path, limit)
            return {"ok": True, "data": [_commit_payload(commit) for commit in commits]}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/restore", response_model=None)
    async def git_restore_route(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        path = _string_payload(data, "path")
        commit = _string_payload(data, "commit") or "HEAD"
        if not path:
            raise HTTPException(status_code=400, detail="Path required")
        try:
            project_root = deps.get_active_project_root()
            deps.restore_path(project_root, path, commit)
            deps.mark_git_cache_dirty(project_root)
            deps.invalidate_diff_cache(project_root, path)
            return {"ok": True, "data": {"path": path, "commit": commit}}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.get("/git/commits", response_model=None)
    async def git_commits() -> JsonObject:
        try:
            project_root = deps.get_active_project_root()
            commits = deps.get_commits(project_root, 50)
            return {"ok": True, "data": [_commit_payload(commit) for commit in commits]}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/reset_hard", response_model=None)
    async def git_reset_hard_route(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        commit = _string_payload(data, "commit") or "HEAD"
        try:
            project_root = deps.get_active_project_root()
            status = deps.reset_hard(project_root, commit)
            deps.mark_git_cache_dirty(project_root)
            deps.invalidate_diff_cache(project_root)
            return {"ok": True, "data": deps.status_to_payload(status)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.get("/git/is_repo", response_model=None)
    async def git_is_repo() -> JsonObject:
        try:
            project_root = deps.get_active_project_root()
            is_repo = worker_git_service.is_git_repository(project_root)
            return {"ok": True, "data": {"is_repo": is_repo}}
        except Exception:
            return {"ok": True, "data": {"is_repo": False}}

    @router.post("/git/init", response_model=None)
    async def git_init_route() -> JsonObject:
        try:
            project_root = deps.get_active_project_root()
            status = deps.init_repository(project_root)
            deps.mark_git_cache_dirty(project_root)
            return {"ok": True, "data": deps.status_to_payload(status)}
        except GitError as exc:
            raise _handle_git_error(exc) from exc

    @router.post("/git/remote/add", response_model=None)
    async def add_git_remote(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        name = _string_payload(data, "name")
        url = _string_payload(data, "url")
        if not name or not url:
            raise HTTPException(status_code=400, detail="Name and URL required")

        root = deps.get_project_root()
        try:
            deps.add_remote(root, name, url)
            origin = deps.get_origin_url(root)
            deps.history.set_project_origin(str(root), origin)
            return {"ok": True}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
