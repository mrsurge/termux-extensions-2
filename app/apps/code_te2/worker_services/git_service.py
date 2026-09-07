# pyright: strict
from __future__ import annotations

import sys
import threading
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypedDict, cast

from app.libs import pipe_runtime


@dataclass
class GitBranches:
    current: str
    branches: list[str]


@dataclass
class GitStatus:
    branch: str
    detached: bool
    ahead: int
    behind: int
    staged: list[str]
    unstaged: list[str]
    untracked: list[str]


@dataclass
class GitCommit:
    hash: str
    short_hash: str
    summary: str
    author: str
    date: str


@dataclass
class GitChangeEntry:
    path: str
    code: str
    original_path: str | None = None

GitPathStatus = Literal[
    "clean",
    "modified",
    "staged",
    "staged_modified",
    "added",
    "deleted",
    "renamed",
    "conflict",
    "untracked",
    "ignored",
]
VALID_GIT_PATH_STATUSES: frozenset[str] = frozenset(
    {
        "clean",
        "modified",
        "staged",
        "staged_modified",
        "added",
        "deleted",
        "renamed",
        "conflict",
        "untracked",
        "ignored",
    }
)


class GitHeadRef(TypedDict, total=False):
    full: str
    short: str


class GitSnapshot(TypedDict):
    dto: Literal["GitSnapshot"]
    version: int
    root: str
    projectPath: str
    projectGeneration: int | None
    isRepository: bool
    hasHead: bool
    branch: str | None
    detached: bool
    head: GitHeadRef | None
    ahead: int
    behind: int
    staged: list[str]
    unstaged: list[str]
    untracked: list[str]
    statuses: dict[str, GitPathStatus]


class GitMutationResult(TypedDict):
    dto: Literal["GitMutationResult"]
    version: int
    root: str
    operation: str
    ok: bool
    changedPaths: list[str]
    statusInvalidated: bool


class GitBranchItem(TypedDict):
    name: str
    current: bool
    remote: bool


class GitBranchList(TypedDict):
    dto: Literal["GitBranchList"]
    version: int
    root: str
    current: str | None
    branches: list[GitBranchItem]


class GitRemoteItem(TypedDict):
    name: str
    fetchUrl: str | None
    pushUrl: str | None


class GitRemoteList(TypedDict):
    dto: Literal["GitRemoteList"]
    version: int
    root: str
    remotes: list[GitRemoteItem]


class GitHistoryCommit(TypedDict):
    id: str
    short: str
    summary: str | None
    authorName: str | None
    authorEmail: str | None
    time: int


class GitHistoryResult(TypedDict):
    dto: Literal["GitHistoryResult"]
    version: int
    root: str
    projectGeneration: int | None
    commits: list[GitHistoryCommit]


class GitWorktreeChange(TypedDict):
    path: str
    code: str
    originalPath: str | None


class GitWorktreeChanges(TypedDict):
    dto: Literal["GitWorktreeChanges"]
    version: int
    root: str
    projectGeneration: int | None
    base: str
    isRepository: bool
    changes: list[GitWorktreeChange]
    truncated: bool


class GitCommitInfo(TypedDict):
    hash: str
    shortHash: str
    summary: str | None
    author: str | None
    date: str


class GitCommitInfoResult(TypedDict):
    dto: Literal["GitCommitInfoResult"]
    version: int
    root: str
    projectGeneration: int | None
    found: bool
    commit: GitCommitInfo | None


class GitPathIndex(TypedDict):
    dto: Literal["GitPathIndex"]
    version: int
    root: str
    projectGeneration: int | None
    isRepository: bool
    paths: list[str]
    source: str
    truncated: bool


class GitDiffHunkLine(TypedDict):
    type: str
    text: str


class GitDiffHunk(TypedDict):
    oldStart: int
    oldLines: int
    newStart: int
    newLines: int
    lines: list[GitDiffHunkLine]


class GitDiffHunksSummary(TypedDict):
    added: int
    deleted: int
    tracked: bool


class GitDiffHunks(TypedDict, total=False):
    dto: Literal["GitDiffHunks"]
    version: int
    root: str
    projectGeneration: int | None
    relativePath: str
    base: str
    hunks: list[GitDiffHunk]
    summary: GitDiffHunksSummary
    error: str


class GitJobStarted(TypedDict):
    dto: Literal["GitJobStarted"]
    version: int
    jobId: str
    opId: str
    type: str
    operation: str
    root: str
    projectGeneration: int | None
    status: str
    message: str


class GitJobCancelResult(TypedDict):
    dto: Literal["GitJobCancelResult"]
    version: int
    jobId: str
    opId: str
    ok: bool
    status: str


JsonObject = dict[str, object]


@dataclass
class GitSnapshotCacheEntry:
    snapshot: GitSnapshot
    dirty: bool


_SNAPSHOT_CACHE_LOCK = threading.RLock()
_SNAPSHOT_CACHE: dict[str, GitSnapshotCacheEntry] = {}


def _git_log(message: str) -> None:
    print(f"[worker_git_service] {message}", file=sys.stderr, flush=True)


def mark_status_cache_dirty(project_root: Path | None = None) -> None:
    """Prevent list hydration from projecting stale Git state."""
    with _SNAPSHOT_CACHE_LOCK:
        if project_root is None:
            for entry in _SNAPSHOT_CACHE.values():
                entry.dirty = True
            return
        key = _snapshot_cache_key(project_root)
        cached = _SNAPSHOT_CACHE.get(key)
        if cached is not None:
            cached.dirty = True


def get_cached_snapshot(project_root: Path) -> GitSnapshot | None:
    """Return the last clean Git snapshot without calling service.git."""
    key = _snapshot_cache_key(project_root)
    with _SNAPSHOT_CACHE_LOCK:
        cached = _SNAPSHOT_CACHE.get(key)
        if cached is None or cached.dirty:
            return None
        return cached.snapshot


def get_cached_statuses(project_root: Path) -> dict[str, str]:
    """Return cached statuses for FS hydration, or no statuses when dirty/unknown."""
    snapshot = get_cached_snapshot(project_root)
    if snapshot is None:
        return {}
    return {path: status for path, status in snapshot["statuses"].items()}


def get_status_snapshot(project_root: Path) -> dict[str, str]:
    """Return git decorations from framework service.git, or raise on transport failure."""
    return {path: status for path, status in get_snapshot(project_root)["statuses"].items()}


def refresh_status_snapshot(project_root: Path) -> dict[str, str]:
    """Return a fresh git decorations snapshot from service.git."""
    return get_status_snapshot(project_root)


def get_statuses_for_root(project_root: Path) -> dict[str, str]:
    """Return non-clean file statuses for Explorer decorations."""
    status_map = get_status_snapshot(project_root)
    return {
        rel_path: status
        for rel_path, status in status_map.items()
        if status and status != "clean"
    }


def get_snapshot(project_root: Path, *, project_generation: int | None = None) -> GitSnapshot:
    """Return the GitSnapshot DTO from framework service.git only."""
    root = project_root.expanduser().resolve(strict=False)
    root_str = str(root)
    _git_log(f"snapshot.pipe start root={root_str}")
    data = pipe_runtime.call(
        "git.snapshot.get",
        {
            "root": root_str,
            "includeStatus": True,
            "includeDecorations": True,
            "untracked": "normal",
        },
        target_nid=2200,
        target_name="service.git",
        workspace_root=root_str,
        project_generation=project_generation,
        origin_name="code_te2.git",
    )
    snapshot = _coerce_snapshot(data)
    with _SNAPSHOT_CACHE_LOCK:
        _SNAPSHOT_CACHE[root_str] = GitSnapshotCacheEntry(snapshot=snapshot, dirty=False)
    status_count = len(snapshot["statuses"])
    _git_log(f"snapshot.pipe ok root={root_str} repo={snapshot['isRepository']} statuses={status_count}")
    return snapshot


def stage_paths(project_root: Path, paths: Iterable[str]) -> GitStatus:
    """Stage specific paths through service.git and return a fresh status."""
    normalized_paths = _normalized_paths(paths)
    if normalized_paths:
        _ = _coerce_mutation(
            _call_git_provider(
                "git.stage",
                project_root,
                {"paths": normalized_paths},
            ),
            expected_operation="stage",
        )
    return get_status(project_root)


def unstage_paths(project_root: Path, paths: Iterable[str]) -> GitStatus:
    """Unstage specific paths through service.git and return a fresh status."""
    normalized_paths = _normalized_paths(paths)
    if normalized_paths:
        _ = _coerce_mutation(
            _call_git_provider(
                "git.unstage",
                project_root,
                {"paths": normalized_paths},
            ),
            expected_operation="unstage",
        )
    return get_status(project_root)


def stage_all(project_root: Path) -> GitStatus:
    """Stage all current worktree changes through service.git."""
    status = get_status(project_root)
    paths = _dedupe_paths([*status.unstaged, *status.untracked])
    if not paths:
        return status
    return stage_paths(project_root, paths)


def unstage_all(project_root: Path) -> GitStatus:
    """Unstage every staged path through service.git."""
    status = get_status(project_root)
    if not status.staged:
        return status
    return unstage_paths(project_root, status.staged)


def commit_changes(project_root: Path, message: str, amend: bool = False) -> GitStatus:
    """Commit staged changes through service.git and return a fresh status."""
    if amend:
        raise RuntimeError("service.git git.commit does not support amend yet")
    status = get_status(project_root)
    if not status.staged:
        raise RuntimeError("No staged changes to commit")
    _ = _coerce_mutation(
        _call_git_provider(
            "git.commit",
            project_root,
            {"message": message},
        ),
        expected_operation="commit",
    )
    return get_status(project_root)


def restore_path(project_root: Path, path: str, commit: str = "HEAD") -> None:
    """Restore one path through service.git."""
    normalized_path = path.strip().replace("\\", "/")
    if not normalized_path:
        raise RuntimeError("service.git git.restore requires path")
    normalized_commit = commit.strip() if commit else "HEAD"
    if normalized_commit != "HEAD":
        raise RuntimeError("service.git git.restore does not support source refs yet")
    _ = _coerce_mutation(
        _call_git_provider(
            "git.restore",
            project_root,
            {"paths": [normalized_path]},
        ),
        expected_operation="restore",
    )


def reset_hard(project_root: Path, commit: str = "HEAD") -> GitStatus:
    """Hard reset through service.git and return a fresh status."""
    _ = _coerce_mutation(
        _call_git_provider(
            "git.resetHard",
            project_root,
            {"target": commit.strip() or "HEAD"},
        ),
        expected_operation="resetHard",
    )
    return get_status(project_root)


def init_repository(project_root: Path) -> GitStatus:
    """Initialize a repository through service.git and return its status."""
    _ = _coerce_mutation(
        _call_git_provider("git.init", project_root, {}),
        expected_operation="init",
    )
    return get_status(project_root)


def get_commit_info(project_root: Path, ref: str = "HEAD") -> GitCommit | None:
    """Return commit metadata from service.git."""
    result = _coerce_commit_info(
        _call_git_provider(
            "git.commitInfo.get",
            project_root,
            {"rev": ref.strip() or "HEAD"},
        )
    )
    commit = result["commit"]
    if commit is None:
        return None
    return GitCommit(
        hash=commit["hash"],
        short_hash=commit["shortHash"],
        summary=commit["summary"] or "",
        author=commit["author"] or "",
        date=commit["date"],
    )


def list_branches(project_root: Path) -> GitBranches:
    """Return branch names from service.git."""
    branch_list = _coerce_branch_list(_call_git_provider("git.branchList", project_root, {}))
    names = [branch["name"] for branch in branch_list["branches"]]
    return GitBranches(current=branch_list["current"] or "HEAD", branches=names)


def checkout_branch(project_root: Path, name: str) -> GitBranches:
    """Checkout a branch/ref through service.git and return the fresh branch list."""
    normalized_name = name.strip()
    if not normalized_name:
        raise RuntimeError("Branch name required")
    _ = _coerce_mutation(
        _call_git_provider(
            "git.branchCheckout",
            project_root,
            {"name": normalized_name},
        ),
        expected_operation="branchCheckout",
    )
    return list_branches(project_root)


def create_branch(project_root: Path, name: str) -> GitBranches:
    """Create and checkout a branch through service.git, preserving legacy UI behavior."""
    normalized_name = name.strip()
    if not normalized_name:
        raise RuntimeError("Branch name required")
    _ = _coerce_mutation(
        _call_git_provider(
            "git.branchCreate",
            project_root,
            {"name": normalized_name},
        ),
        expected_operation="branchCreate",
    )
    _ = _coerce_mutation(
        _call_git_provider(
            "git.branchCheckout",
            project_root,
            {"name": normalized_name},
        ),
        expected_operation="branchCheckout",
    )
    return list_branches(project_root)


def get_remote_list(project_root: Path) -> GitRemoteList:
    """Return remotes from service.git."""
    return _coerce_remote_list(_call_git_provider("git.remoteList", project_root, {}))


def get_origin_url(project_root: Path) -> str | None:
    """Return the origin fetch URL from service.git, if configured."""
    for remote in get_remote_list(project_root)["remotes"]:
        if remote["name"] == "origin":
            return remote["fetchUrl"] or remote["pushUrl"]
    return None


def add_remote(project_root: Path, name: str, url: str) -> None:
    """Add a remote through service.git."""
    normalized_name = name.strip()
    normalized_url = url.strip()
    if not normalized_name or not normalized_url:
        raise RuntimeError("Name and URL required")
    _ = _coerce_mutation(
        _call_git_provider(
            "git.remoteAdd",
            project_root,
            {"name": normalized_name, "url": normalized_url},
        ),
        expected_operation="remoteAdd",
    )


def get_commits(project_root: Path, limit: int = 50) -> list[GitCommit]:
    """Return recent commit history from service.git."""
    history = _coerce_history(
        _call_git_provider(
            "git.history",
            project_root,
            {"limit": max(1, limit)},
        )
    )
    commits: list[GitCommit] = []
    for commit in history["commits"]:
        full_hash = commit["id"]
        commits.append(
            GitCommit(
                hash=full_hash,
                short_hash=commit["short"] or full_hash[:7],
                summary=commit["summary"] or "",
                author=commit["authorName"] or "",
                date=str(commit["time"]),
            )
        )
    return commits


def get_commits_for_path(project_root: Path, path: str, limit: int = 20) -> list[GitCommit]:
    """Return recent commit history for one path from service.git."""
    normalized_path = path.strip().replace("\\", "/")
    if not normalized_path:
        return []
    history = _coerce_history(
        _call_git_provider(
            "git.history",
            project_root,
            {
                "limit": max(1, limit),
                "path": normalized_path,
            },
        )
    )
    commits: list[GitCommit] = []
    for commit in history["commits"]:
        full_hash = commit["id"]
        commits.append(
            GitCommit(
                hash=full_hash,
                short_hash=commit["short"] or full_hash[:7],
                summary=commit["summary"] or "",
                author=commit["authorName"] or "",
                date=str(commit["time"]),
            )
        )
    return commits


def get_worktree_changes(
    project_root: Path,
    base_ref: str | None = None,
    *,
    limit: int = 20_000,
) -> list[GitChangeEntry]:
    """Return worktree/index changes from service.git."""
    result = _coerce_worktree_changes(
        _call_git_provider(
            "git.worktreeChanges.get",
            project_root,
            {
                "base": (base_ref or "HEAD").strip() or "HEAD",
                "limit": limit,
            },
        )
    )
    return [
        GitChangeEntry(
            path=change["path"],
            code=change["code"],
            original_path=change["originalPath"],
        )
        for change in result["changes"]
    ]


def get_path_index(project_root: Path, *, limit: int = 50_000) -> GitPathIndex:
    """Return tracked and untracked non-ignored paths from service.git."""
    return _coerce_path_index(
        _call_git_provider(
            "git.pathIndex.list",
            project_root,
            {"limit": limit},
        )
    )


def get_diff_hunks(
    project_root: Path,
    rel_path: str,
    base_ref: str | None = None,
) -> GitDiffHunks:
    """Return current diff hunks for one path from service.git."""
    normalized_rel = rel_path.strip().replace("\\", "/")
    if not normalized_rel:
        raise RuntimeError("service.git git.diff.hunks requires relativePath")
    return _coerce_diff_hunks(
        _call_git_provider(
            "git.diff.hunks",
            project_root,
            {
                "relativePath": normalized_rel,
                "base": (base_ref or "HEAD").strip() or "HEAD",
            },
        )
    )


def new_git_job_op_id(job_type: str) -> str:
    """Create the Explorer-visible operation id used to track pipe Git jobs."""
    normalized_type = job_type.strip().replace(".", "_") or "git_job"
    return f"{normalized_type}-{uuid.uuid4().hex[:12]}"


def start_push_job(
    project_root: Path,
    *,
    remote: str,
    branch: str | None,
    force: bool,
    op_id: str,
) -> GitJobStarted:
    """Start a pipe-backed push job and return the framework job ack."""
    if force:
        raise RuntimeError("service.git git.push.start does not support force yet")
    params: JsonObject = {"remote": remote}
    if branch:
        params["branch"] = branch
    return _coerce_job_started(
        _call_git_provider("git.push.start", project_root, params, op_id=op_id),
        expected_operation="push",
    )


def push_changes(
    project_root: Path,
    remote: str | None = None,
    branch: str | None = None,
    force: bool = False,
) -> GitStatus:
    """Push through synchronous service.git and return a fresh status."""
    if force:
        raise RuntimeError("service.git git.push does not support force yet")
    params: JsonObject = {}
    if remote:
        params["remote"] = remote
    if branch:
        params["branch"] = branch
    _ = _coerce_mutation(
        _call_git_provider("git.push", project_root, params),
        expected_operation="push",
    )
    return get_status(project_root)


def start_pull_job(
    project_root: Path,
    *,
    remote: str,
    branch: str | None,
    rebase: bool,
    op_id: str,
) -> GitJobStarted:
    """Start a pipe-backed pull job and return the framework job ack."""
    if rebase:
        raise RuntimeError("service.git git.pull.start does not support rebase yet")
    params: JsonObject = {"remote": remote}
    if branch:
        params["branch"] = branch
    return _coerce_job_started(
        _call_git_provider("git.pull.start", project_root, params, op_id=op_id),
        expected_operation="pull",
    )


def pull_changes(
    project_root: Path,
    remote: str | None = None,
    branch: str | None = None,
    rebase: bool = False,
) -> GitStatus:
    """Pull through synchronous service.git and return a fresh status."""
    if rebase:
        raise RuntimeError("service.git git.pull does not support rebase yet")
    params: JsonObject = {}
    if remote:
        params["remote"] = remote
    if branch:
        params["branch"] = branch
    _ = _coerce_mutation(
        _call_git_provider("git.pull", project_root, params),
        expected_operation="pull",
    )
    return get_status(project_root)


def start_clone_job(
    project_root: Path,
    *,
    url: str,
    destination: str,
    branch: str | None,
    depth: int | None,
    op_id: str,
) -> GitJobStarted:
    """Start a pipe-backed clone job and return the framework job ack."""
    params: JsonObject = {
        "url": url,
        "destination": destination,
    }
    if branch:
        params["branch"] = branch
    if depth is not None and depth > 0:
        params["depth"] = depth
    return _coerce_job_started(
        _call_git_provider("git.clone.start", project_root, params, op_id=op_id),
        expected_operation="clone",
    )


def cancel_git_job(
    project_root: Path,
    *,
    job_id: str,
    reason: str | None = None,
) -> GitJobCancelResult:
    """Cancel a pipe-backed Git job by Explorer-visible op id."""
    normalized_job_id = job_id.strip()
    if not normalized_job_id:
        raise RuntimeError("service.git git.job.cancel requires job id")
    params: JsonObject = {"opId": normalized_job_id}
    if reason:
        params["reason"] = reason
    return _coerce_job_cancel_result(
        _call_git_provider("git.job.cancel", project_root, params),
    )


def get_status(project_root: Path) -> GitStatus:
    """Return branch/ahead/behind and staged/unstaged/untracked status."""
    snapshot = get_snapshot(project_root)
    return GitStatus(
        branch=str(snapshot.get("branch") or "HEAD"),
        detached=bool(snapshot.get("detached")),
        ahead=_int_value(snapshot.get("ahead")),
        behind=_int_value(snapshot.get("behind")),
        staged=_string_list(snapshot.get("staged")),
        unstaged=_string_list(snapshot.get("unstaged")),
        untracked=_string_list(snapshot.get("untracked")),
    )


def is_git_repository(project_root: Path) -> bool:
    """Return whether project_root is inside a git worktree."""
    return bool(get_snapshot(project_root)["isRepository"])


def read_head_blob_text(project_root: Path, rel_path: str, *, rev: str = "HEAD") -> str | None:
    """Read a Git blob through the existing pipe; HEAD remains the default."""
    normalized_rel = rel_path.strip().replace("\\", "/")
    if not normalized_rel:
        return None
    root = project_root.expanduser().resolve(strict=False)
    root_str = str(root)
    _git_log(f"head.pipe start root={root_str} rel={normalized_rel}")
    data = pipe_runtime.call(
        "git.headBlob",
        {
            "root": root_str,
            "relativePath": normalized_rel,
            "rev": rev,
        },
        target_nid=2200,
        target_name="service.git",
        workspace_root=root_str,
        origin_name="code_te2.git",
    )
    result = _as_object(data)
    if result.get("dto") != "GitHeadBlobResult":
        raise RuntimeError("service.git returned unexpected git.headBlob DTO")
    if not bool(result.get("found")):
        _git_log(f"head.pipe miss root={root_str} rel={normalized_rel}")
        return None
    content = _as_object(result.get("content"))
    if content.get("payloadKind") != "string":
        raise RuntimeError("service.git returned unsupported git.headBlob payload")
    value = content.get("value")
    if not isinstance(value, str):
        raise RuntimeError("service.git returned invalid git.headBlob content")
    _git_log(f"head.pipe ok root={root_str} rel={normalized_rel} chars={len(value)}")
    return value


def _call_git_provider(
    method: str,
    project_root: Path,
    params: JsonObject,
    *,
    op_id: str | None = None,
) -> object:
    root = project_root.expanduser().resolve(strict=False)
    root_str = str(root)
    payload: JsonObject = {"root": root_str, **params}
    _git_log(f"{method}.pipe start root={root_str}")
    data = pipe_runtime.call(
        method,
        payload,
        target_nid=2200,
        target_name="service.git",
        workspace_root=root_str,
        origin_name="code_te2.git",
        op_id=op_id,
    )
    _git_log(f"{method}.pipe ok root={root_str}")
    return data


def _coerce_mutation(value: object, *, expected_operation: str) -> GitMutationResult:
    data = _as_object(value)
    if data.get("dto") != "GitMutationResult":
        raise RuntimeError("service.git returned unexpected GitMutationResult DTO")
    operation = data.get("operation")
    if operation != expected_operation:
        raise RuntimeError(
            f"service.git returned GitMutationResult for {operation!r}, expected {expected_operation!r}"
        )
    ok = bool(data.get("ok"))
    if not ok:
        raise RuntimeError(f"service.git {expected_operation} did not complete")
    return {
        "dto": "GitMutationResult",
        "version": _int_value(data.get("version"), default=1),
        "root": _required_string(data.get("root"), "service.git returned invalid mutation root"),
        "operation": expected_operation,
        "ok": ok,
        "changedPaths": _string_list(data.get("changedPaths")),
        "statusInvalidated": bool(data.get("statusInvalidated")),
    }


def _coerce_branch_list(value: object) -> GitBranchList:
    data = _as_object(value)
    if data.get("dto") != "GitBranchList":
        raise RuntimeError("service.git returned unexpected GitBranchList DTO")
    branches: list[GitBranchItem] = []
    raw_branches = data.get("branches")
    if isinstance(raw_branches, list):
        for item in cast(list[object], raw_branches):
            branch = _as_object(item)
            name = branch.get("name")
            if isinstance(name, str) and name:
                branches.append(
                    {
                        "name": name,
                        "current": bool(branch.get("current")),
                        "remote": bool(branch.get("remote")),
                    }
                )
    return {
        "dto": "GitBranchList",
        "version": _int_value(data.get("version"), default=1),
        "root": _required_string(data.get("root"), "service.git returned invalid branch root"),
        "current": _optional_str(data.get("current")),
        "branches": branches,
    }


def _coerce_remote_list(value: object) -> GitRemoteList:
    data = _as_object(value)
    if data.get("dto") != "GitRemoteList":
        raise RuntimeError("service.git returned unexpected GitRemoteList DTO")
    remotes: list[GitRemoteItem] = []
    raw_remotes = data.get("remotes")
    if isinstance(raw_remotes, list):
        for item in cast(list[object], raw_remotes):
            remote = _as_object(item)
            name = remote.get("name")
            if isinstance(name, str) and name:
                remotes.append(
                    {
                        "name": name,
                        "fetchUrl": _optional_str(remote.get("fetchUrl")),
                        "pushUrl": _optional_str(remote.get("pushUrl")),
                    }
                )
    return {
        "dto": "GitRemoteList",
        "version": _int_value(data.get("version"), default=1),
        "root": _required_string(data.get("root"), "service.git returned invalid remote root"),
        "remotes": remotes,
    }


def _coerce_history(value: object) -> GitHistoryResult:
    data = _as_object(value)
    if data.get("dto") != "GitHistoryResult":
        raise RuntimeError("service.git returned unexpected GitHistoryResult DTO")
    commits: list[GitHistoryCommit] = []
    raw_commits = data.get("commits")
    if isinstance(raw_commits, list):
        for item in cast(list[object], raw_commits):
            commit = _as_object(item)
            full_hash = commit.get("id")
            if not isinstance(full_hash, str) or not full_hash:
                continue
            commits.append(
                {
                    "id": full_hash,
                    "short": _optional_str(commit.get("short")) or full_hash[:7],
                    "summary": _optional_str(commit.get("summary")),
                    "authorName": _optional_str(commit.get("authorName")),
                    "authorEmail": _optional_str(commit.get("authorEmail")),
                    "time": _int_value(commit.get("time")),
                }
            )
    return {
        "dto": "GitHistoryResult",
        "version": _int_value(data.get("version"), default=1),
        "root": _required_string(data.get("root"), "service.git returned invalid history root"),
        "projectGeneration": _optional_int(data.get("projectGeneration")),
        "commits": commits,
    }


def _coerce_worktree_changes(value: object) -> GitWorktreeChanges:
    data = _as_object(value)
    if data.get("dto") != "GitWorktreeChanges":
        raise RuntimeError("service.git returned unexpected GitWorktreeChanges DTO")
    changes: list[GitWorktreeChange] = []
    raw_changes = data.get("changes")
    if isinstance(raw_changes, list):
        for item in cast(list[object], raw_changes):
            change = _as_object(item)
            path = change.get("path")
            code = change.get("code")
            if not isinstance(path, str) or not path or not isinstance(code, str) or not code:
                continue
            changes.append(
                {
                    "path": path,
                    "code": code,
                    "originalPath": _optional_str(change.get("originalPath")),
                }
            )
    return {
        "dto": "GitWorktreeChanges",
        "version": _int_value(data.get("version"), default=1),
        "root": _required_string(
            data.get("root"),
            "service.git returned invalid worktree changes root",
        ),
        "projectGeneration": _optional_int(data.get("projectGeneration")),
        "base": _optional_str(data.get("base")) or "HEAD",
        "isRepository": bool(data.get("isRepository")),
        "changes": changes,
        "truncated": bool(data.get("truncated")),
    }


def _coerce_commit_info(value: object) -> GitCommitInfoResult:
    data = _as_object(value)
    if data.get("dto") != "GitCommitInfoResult":
        raise RuntimeError("service.git returned unexpected GitCommitInfoResult DTO")
    raw_commit = _as_object(data.get("commit"))
    commit: GitCommitInfo | None = None
    commit_hash = raw_commit.get("hash")
    if bool(data.get("found")) and isinstance(commit_hash, str) and commit_hash:
        commit = {
            "hash": commit_hash,
            "shortHash": _optional_str(raw_commit.get("shortHash")) or commit_hash[:7],
            "summary": _optional_str(raw_commit.get("summary")),
            "author": _optional_str(raw_commit.get("author")),
            "date": _optional_str(raw_commit.get("date")) or "",
        }
    return {
        "dto": "GitCommitInfoResult",
        "version": _int_value(data.get("version"), default=1),
        "root": _required_string(
            data.get("root"),
            "service.git returned invalid commit info root",
        ),
        "projectGeneration": _optional_int(data.get("projectGeneration")),
        "found": bool(data.get("found")),
        "commit": commit,
    }


def _coerce_path_index(value: object) -> GitPathIndex:
    data = _as_object(value)
    if data.get("dto") != "GitPathIndex":
        raise RuntimeError("service.git returned unexpected GitPathIndex DTO")
    source = _optional_str(data.get("source")) or "git-index"
    return {
        "dto": "GitPathIndex",
        "version": _int_value(data.get("version"), default=1),
        "root": _required_string(data.get("root"), "service.git returned invalid path index root"),
        "projectGeneration": _optional_int(data.get("projectGeneration")),
        "isRepository": bool(data.get("isRepository")),
        "paths": _string_list(data.get("paths")),
        "source": source,
        "truncated": bool(data.get("truncated")),
    }


def _coerce_diff_hunks(value: object) -> GitDiffHunks:
    data = _as_object(value)
    if data.get("dto") != "GitDiffHunks":
        raise RuntimeError("service.git returned unexpected GitDiffHunks DTO")
    hunks: list[GitDiffHunk] = []
    raw_hunks = data.get("hunks")
    if isinstance(raw_hunks, list):
        for item in cast(list[object], raw_hunks):
            hunk = _as_object(item)
            lines: list[GitDiffHunkLine] = []
            raw_lines = hunk.get("lines")
            if isinstance(raw_lines, list):
                for raw_line in cast(list[object], raw_lines):
                    line = _as_object(raw_line)
                    line_type = line.get("type")
                    text = line.get("text")
                    if isinstance(line_type, str) and isinstance(text, str):
                        lines.append({"type": line_type, "text": text})
            hunks.append(
                {
                    "oldStart": _int_value(hunk.get("oldStart")),
                    "oldLines": _int_value(hunk.get("oldLines")),
                    "newStart": _int_value(hunk.get("newStart")),
                    "newLines": _int_value(hunk.get("newLines")),
                    "lines": lines,
                }
            )
    summary = _as_object(data.get("summary"))
    result: GitDiffHunks = {
        "dto": "GitDiffHunks",
        "version": _int_value(data.get("version"), default=1),
        "root": _required_string(data.get("root"), "service.git returned invalid diff root"),
        "projectGeneration": _optional_int(data.get("projectGeneration")),
        "relativePath": _required_string(
            data.get("relativePath"),
            "service.git returned invalid diff relativePath",
        ),
        "base": _optional_str(data.get("base")) or "HEAD",
        "hunks": hunks,
        "summary": {
            "added": _int_value(summary.get("added")),
            "deleted": _int_value(summary.get("deleted")),
            "tracked": bool(summary.get("tracked")),
        },
    }
    error = _optional_str(data.get("error"))
    if error:
        result["error"] = error
    return result


def _coerce_job_started(value: object, *, expected_operation: str) -> GitJobStarted:
    data = _as_object(value)
    if data.get("dto") != "GitJobStarted":
        raise RuntimeError("service.git returned unexpected GitJobStarted DTO")
    operation = data.get("operation")
    if operation != expected_operation:
        raise RuntimeError(
            f"service.git returned GitJobStarted for {operation!r}, expected {expected_operation!r}"
        )
    return {
        "dto": "GitJobStarted",
        "version": _int_value(data.get("version"), default=1),
        "jobId": _required_string(data.get("jobId"), "service.git returned invalid jobId"),
        "opId": _required_string(data.get("opId"), "service.git returned invalid opId"),
        "type": _required_string(data.get("type"), "service.git returned invalid job type"),
        "operation": expected_operation,
        "root": _required_string(data.get("root"), "service.git returned invalid job root"),
        "projectGeneration": _optional_int(data.get("projectGeneration")),
        "status": _required_string(data.get("status"), "service.git returned invalid job status"),
        "message": _required_string(data.get("message"), "service.git returned invalid job message"),
    }


def _coerce_job_cancel_result(value: object) -> GitJobCancelResult:
    data = _as_object(value)
    if data.get("dto") != "GitJobCancelResult":
        raise RuntimeError("service.git returned unexpected GitJobCancelResult DTO")
    return {
        "dto": "GitJobCancelResult",
        "version": _int_value(data.get("version"), default=1),
        "jobId": _optional_str(data.get("jobId")) or "",
        "opId": _optional_str(data.get("opId")) or "",
        "ok": bool(data.get("ok")),
        "status": _required_string(
            data.get("status"),
            "service.git returned invalid cancel status",
        ),
    }


def _required_string(value: object, message: str) -> str:
    if isinstance(value, str) and value:
        return value
    raise RuntimeError(message)


def _snapshot_cache_key(project_root: Path) -> str:
    return str(project_root.expanduser().resolve(strict=False))


def _normalized_paths(paths: Iterable[str]) -> list[str]:
    return _dedupe_paths(path.strip().replace("\\", "/") for path in paths if path.strip())


def _dedupe_paths(paths: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for path in paths:
        if path and path not in seen:
            seen.add(path)
            result.append(path)
    return result


def _coerce_snapshot(value: object) -> GitSnapshot:
    data = _as_object(value)
    if data.get("dto") != "GitSnapshot":
        raise RuntimeError("service.git returned unexpected git.snapshot.get DTO")
    root = data.get("root")
    if not isinstance(root, str) or not root:
        raise RuntimeError("service.git returned invalid GitSnapshot root")
    project_path = data.get("projectPath")
    statuses = _typed_status_map(_as_object(data.get("statuses")))
    return {
        "dto": "GitSnapshot",
        "version": _int_value(data.get("version"), default=1),
        "root": root,
        "projectPath": project_path if isinstance(project_path, str) and project_path else root,
        "projectGeneration": _optional_int(data.get("projectGeneration")),
        "isRepository": bool(data.get("isRepository")),
        "hasHead": bool(data.get("hasHead")),
        "branch": _optional_str(data.get("branch")),
        "detached": bool(data.get("detached")),
        "head": _head_ref(data.get("head")),
        "ahead": _int_value(data.get("ahead")),
        "behind": _int_value(data.get("behind")),
        "staged": _string_list(data.get("staged")),
        "unstaged": _string_list(data.get("unstaged")),
        "untracked": _string_list(data.get("untracked")),
        "statuses": statuses,
    }


def _head_ref(value: object) -> GitHeadRef | None:
    data = _as_object(value)
    full = data.get("full")
    if not isinstance(full, str) or not full:
        return None
    short = data.get("short")
    return {"full": full, "short": short if isinstance(short, str) and short else full[:7]}


def _typed_status_map(statuses: JsonObject) -> dict[str, GitPathStatus]:
    result: dict[str, GitPathStatus] = {}
    for path, status in statuses.items():
        if isinstance(status, str) and status in VALID_GIT_PATH_STATUSES:
            result[path] = cast(GitPathStatus, status)
    return result


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in cast(list[object], value) if isinstance(item, str)]


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def _int_value(value: object, *, default: int = 0) -> int:
    parsed = _optional_int(value)
    return parsed if parsed is not None else default
