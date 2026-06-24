# pyright: strict
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from typing import Literal, Protocol, TypedDict, cast

from git import Repo
from git.exc import GitCommandError, InvalidGitRepositoryError, NoSuchPathError

from ..git_helper import GitError, GitStatus

GIT_CACHE_TTL_SECONDS = 6.0

_STATE_LOCK = threading.RLock()
_STATUS_CACHE: dict[str, dict[str, object]] = {}
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


class _RepoGit(Protocol):
    def show(self, *args: object, **kwargs: object) -> object: ...
    def rev_parse(self, *args: object, **kwargs: object) -> object: ...
    def branch(self, *args: object, **kwargs: object) -> object: ...
    def rev_list(self, *args: object, **kwargs: object) -> object: ...
    def status(self, *args: object, **kwargs: object) -> object: ...


def _git_log(message: str) -> None:
    print(f"[worker_git_service] {message}", file=sys.stderr, flush=True)


def mark_status_cache_dirty(project_root: Path | None = None) -> None:
    """Mark service-owned git status snapshots dirty."""
    if project_root is None:
        with _STATE_LOCK:
            _STATUS_CACHE.clear()
        return

    key = _cache_key(project_root)
    with _STATE_LOCK:
        entry = _STATUS_CACHE.get(key)
        if entry is not None:
            entry["dirty"] = True


def get_status_snapshot(project_root: Path) -> dict[str, str]:
    """Return cached git decorations snapshot, refreshing through the service if needed."""
    key = _cache_key(project_root)
    now = time.time()
    with _STATE_LOCK:
        entry = _STATUS_CACHE.get(key)
        if (
            entry is not None
            and not bool(entry.get("dirty"))
            and now - _entry_timestamp(entry) < GIT_CACHE_TTL_SECONDS
        ):
            status = entry.get("status")
            if isinstance(status, dict):
                typed_status = cast(dict[object, object], status)
                return {str(path): str(value) for path, value in typed_status.items()}
    try:
        return refresh_status_snapshot(project_root)
    except Exception:
        return {}


def refresh_status_snapshot(project_root: Path) -> dict[str, str]:
    """Refresh and store git decoration status for a project root."""
    start = time.monotonic()
    _git_log(f"status.refresh start root={project_root}")
    status = _collect_statuses(project_root)
    key = _cache_key(project_root)
    with _STATE_LOCK:
        _STATUS_CACHE[key] = {
            "status": status,
            "timestamp": time.time(),
            "dirty": False,
        }
    _git_log(
        f"status.refresh ok root={project_root} entries={len(status)} "
        f"elapsed_ms={(time.monotonic() - start) * 1000:.1f}"
    )
    return status


def get_statuses_for_root(project_root: Path) -> dict[str, str]:
    """Return non-clean file statuses for Explorer decorations."""
    status_map = get_status_snapshot(project_root)
    if not status_map:
        return {}
    return {
        rel_path: status
        for rel_path, status in status_map.items()
        if status and status != "clean"
    }


def get_snapshot(project_root: Path, *, project_generation: int | None = None) -> GitSnapshot:
    """Return the Explorer git DTO using the current in-process producer."""
    root = project_root.expanduser().resolve(strict=False)
    root_str = str(root)
    try:
        repo = _open_repo(root)
    except GitError as exc:
        _git_log(f"snapshot nonrepo root={root} exc={exc!r}")
        return _empty_snapshot(root_str, project_generation=project_generation)

    has_head = _has_head(repo)
    branch, detached = _current_branch(repo)
    ahead, behind = _ahead_behind(repo)
    status = get_status(root)
    statuses = _typed_status_map(get_statuses_for_root(root))
    return {
        "dto": "GitSnapshot",
        "version": 1,
        "root": root_str,
        "projectPath": root_str,
        "projectGeneration": project_generation,
        "isRepository": True,
        "hasHead": has_head,
        "branch": branch,
        "detached": detached,
        "head": _head_ref(repo) if has_head else None,
        "ahead": ahead,
        "behind": behind,
        "staged": status.staged,
        "unstaged": status.unstaged,
        "untracked": status.untracked,
        "statuses": statuses,
    }


def get_status(project_root: Path) -> GitStatus:
    """Return branch/ahead/behind and staged/unstaged/untracked status."""
    start = time.monotonic()
    _git_log(f"status.summary start root={project_root}")
    repo = _open_repo(project_root)

    branch, detached = _current_branch(repo)
    ahead, behind = _ahead_behind(repo)

    staged: list[str] = []
    unstaged: list[str] = []
    untracked: list[str] = []
    for code, path in _status_entries(repo):
        normalized = _normalize_status_path(path)
        if not normalized:
            continue
        if code == "??":
            untracked.append(normalized)
            continue
        if len(code) > 0 and code[0] != " ":
            staged.append(normalized)
        if len(code) > 1 and code[1] != " ":
            unstaged.append(normalized)

    result = GitStatus(
        branch=branch,
        detached=detached,
        ahead=ahead,
        behind=behind,
        staged=staged,
        unstaged=unstaged,
        untracked=untracked,
    )
    _git_log(
        f"status.summary ok root={project_root} branch={branch} staged={len(staged)} "
        f"unstaged={len(unstaged)} untracked={len(untracked)} "
        f"elapsed_ms={(time.monotonic() - start) * 1000:.1f}"
    )
    return result


def is_git_repository(project_root: Path) -> bool:
    """Return whether project_root is inside a git worktree."""
    try:
        _open_repo(project_root)
        return True
    except GitError:
        return False


def read_head_blob_text(project_root: Path, rel_path: str) -> str | None:
    """Return UTF-8 text for a file at HEAD, or None when absent/untracked."""
    normalized_rel = rel_path.strip().replace("\\", "/")
    if not normalized_rel:
        return None
    start = time.monotonic()
    _git_log(f"head.read start root={project_root} rel={normalized_rel}")
    try:
        repo = _open_repo(project_root)
        if not _has_head(repo):
            _git_log(f"head.read unborn root={project_root} rel={normalized_rel}")
            return None
        data = _git_show_bytes(repo, f"HEAD:{normalized_rel}")
        if not isinstance(data, bytes):
            _git_log(f"head.read nonblob root={project_root} rel={normalized_rel} type={type(data).__name__}")
            return None
        text = data.decode("utf-8", errors="replace")
        _git_log(
            f"head.read ok root={project_root} rel={normalized_rel} bytes={len(data)} "
            f"elapsed_ms={(time.monotonic() - start) * 1000:.1f}"
        )
        return text
    except Exception as exc:
        _git_log(
            f"head.read miss root={project_root} rel={normalized_rel} exc={exc!r} "
            f"elapsed_ms={(time.monotonic() - start) * 1000:.1f}"
        )
        return None


def _entry_timestamp(entry: dict[str, object]) -> float:
    raw = entry.get("timestamp", 0)
    try:
        if isinstance(raw, (int, float, str)):
            return float(raw)
    except Exception:
        return 0.0
    return 0.0


def _cache_key(root: Path) -> str:
    try:
        return str(root.resolve())
    except Exception:
        return str(root)


def _collect_statuses(root: Path) -> dict[str, str]:
    """Collect git decoration status for files under root."""
    try:
        repo = _open_repo(root)
    except GitError as exc:
        _git_log(f"status.collect skip root={root} exc={exc!r}")
        return {}

    status_map: dict[str, str] = {}
    for code, raw_path in _status_entries(repo):
        path = _normalize_status_path(raw_path)
        if not path:
            continue
        status_map[path] = _map_git_status_code(code)
    return status_map


def _open_repo(root: Path) -> Repo:
    try:
        return Repo(root, search_parent_directories=True)
    except (InvalidGitRepositoryError, NoSuchPathError) as exc:
        raise GitError("Not a git repository") from exc


def _repo_git(repo: Repo) -> _RepoGit:
    return cast(_RepoGit, repo.git)


def _git_show_bytes(repo: Repo, spec: str) -> bytes | None:
    git = _repo_git(repo)
    result = git.show(spec, as_process=False, with_extended_output=False, stdout_as_string=False)
    return result if isinstance(result, bytes) else None


def _git_rev_parse(repo: Repo, *args: object) -> str:
    return str(_repo_git(repo).rev_parse(*args))


def _git_branch(repo: Repo, *args: object) -> str:
    return str(_repo_git(repo).branch(*args))


def _git_rev_list(repo: Repo, *args: object) -> str:
    return str(_repo_git(repo).rev_list(*args))


def _git_status(repo: Repo, *args: object) -> str:
    return str(_repo_git(repo).status(*args))


def _has_head(repo: Repo) -> bool:
    try:
        _git_rev_parse(repo, "--verify", "HEAD")
        return True
    except GitCommandError:
        return False


def _head_ref(repo: Repo) -> GitHeadRef | None:
    try:
        full = _git_rev_parse(repo, "HEAD").strip()
        short = _git_rev_parse(repo, "--short", "HEAD").strip()
    except GitCommandError:
        return None
    if not full:
        return None
    return {"full": full, "short": short or full[:7]}


def _current_branch(repo: Repo) -> tuple[str, bool]:
    try:
        name = _git_branch(repo, "--show-current").strip()
        if name:
            return name, False
    except GitCommandError:
        pass
    try:
        short_head = _git_rev_parse(repo, "--short", "HEAD").strip()
        return short_head or "HEAD", True
    except GitCommandError:
        return "HEAD", False


def _ahead_behind(repo: Repo) -> tuple[int, int]:
    try:
        output = _git_rev_list(repo, "--left-right", "--count", "HEAD...@{upstream}").strip()
    except GitCommandError:
        return 0, 0
    parts = output.split()
    if len(parts) < 2:
        return 0, 0
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return 0, 0


def _status_entries(repo: Repo) -> list[tuple[str, str]]:
    try:
        output = _git_status(repo, "--porcelain=v1", "--untracked-files=normal")
    except GitCommandError:
        return []
    entries: list[tuple[str, str]] = []
    for line in output.splitlines():
        if len(line) < 3:
            continue
        code = line[:2]
        path = line[3:].strip()
        if not path:
            continue
        entries.append((code, path))
    return entries


def _normalize_status_path(raw_path: str) -> str:
    path = raw_path.strip().replace("\\", "/")
    if " -> " in path:
        _, path = path.split(" -> ", 1)
    return path


def _map_git_status_code(code: str) -> str:
    if code == "!!":
        return "ignored"
    if "U" in code or code in {"AA", "DD"}:
        return "conflict"
    if "D" in code:
        return "deleted"
    if "R" in code:
        return "renamed"
    if code == "??":
        return "untracked"
    index_status = len(code) > 0 and code[0] != " "
    worktree_status = len(code) > 1 and code[1] != " "
    if code[0] == "A":
        return "added"
    if index_status and worktree_status:
        return "staged_modified"
    if index_status:
        return "staged"
    if worktree_status:
        return "modified"
    return "clean"


def _empty_snapshot(root: str, *, project_generation: int | None = None) -> GitSnapshot:
    return {
        "dto": "GitSnapshot",
        "version": 1,
        "root": root,
        "projectPath": root,
        "projectGeneration": project_generation,
        "isRepository": False,
        "hasHead": False,
        "branch": None,
        "detached": False,
        "head": None,
        "ahead": 0,
        "behind": 0,
        "staged": [],
        "unstaged": [],
        "untracked": [],
        "statuses": {},
    }


def _typed_status_map(statuses: dict[str, str]) -> dict[str, GitPathStatus]:
    result: dict[str, GitPathStatus] = {}
    for path, status in statuses.items():
        if status in VALID_GIT_PATH_STATUSES:
            result[path] = cast(GitPathStatus, status)
    return result
