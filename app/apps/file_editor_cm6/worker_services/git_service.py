# pyright: strict
from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path
from typing import cast

import pygit2

from ..git_helper import GitError, GitStatus

GIT_CACHE_TTL_SECONDS = 6.0

_STATE_LOCK = threading.RLock()
_STATUS_CACHE: dict[str, dict[str, object]] = {}


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
    status = _collect_statuses(project_root)
    key = _cache_key(project_root)
    with _STATE_LOCK:
        _STATUS_CACHE[key] = {
            "status": status,
            "timestamp": time.time(),
            "dirty": False,
        }
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


def get_status(project_root: Path) -> GitStatus:
    """Return branch/ahead/behind and staged/unstaged/untracked status."""
    repo = _open_repo(project_root)

    branch = "HEAD"
    detached = False
    ahead = 0
    behind = 0

    if repo.head_is_unborn:
        detached = False
    elif repo.head_is_detached:
        detached = True
    else:
        branch = str(repo.head.shorthand or "HEAD")
        local_branch = repo.branches.get(branch)
        try:
            upstream = local_branch.upstream
            ahead, behind = repo.ahead_behind(repo.head.target, upstream.target)
        except Exception:
            ahead = 0
            behind = 0

    staged: list[str] = []
    unstaged: list[str] = []
    untracked: list[str] = []
    for path, flags in _repo_status(repo, ignored=False).items():
        normalized = _normalize_status_path(path)
        if not normalized:
            continue
        if flags & pygit2.GIT_STATUS_WT_NEW:
            untracked.append(normalized)
            continue
        if _has_index_status(flags):
            staged.append(normalized)
        if _has_worktree_status(flags):
            unstaged.append(normalized)

    return GitStatus(
        branch=branch,
        detached=detached,
        ahead=ahead,
        behind=behind,
        staged=staged,
        unstaged=unstaged,
        untracked=untracked,
    )


def read_head_blob_text(project_root: Path, rel_path: str) -> str | None:
    """Return UTF-8 text for a file at HEAD, or None when absent/untracked."""
    normalized_rel = rel_path.strip().replace("\\", "/")
    if not normalized_rel:
        return None
    try:
        repo = _open_repo(project_root)
        if repo.head_is_unborn:
            return None
        obj = repo.revparse_single(f"HEAD:{normalized_rel}")
        data = getattr(obj, "data", None)
        if not isinstance(data, bytes):
            return None
        return data.decode("utf-8", errors="replace")
    except Exception:
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
    except GitError:
        return {}

    status_map: dict[str, str] = {}
    for raw_path, flags in _repo_status(repo, ignored=True).items():
        path = _normalize_status_path(raw_path)
        if not path:
            continue
        status_map[path] = _map_git_status_flags(flags)
    status_map.update(_collect_ignored_statuses_with_git(root))
    return status_map


def _open_repo(root: Path) -> pygit2.Repository:
    try:
        git_dir = pygit2.discover_repository(str(root))
    except Exception as exc:
        raise GitError("Not a git repository") from exc
    if not git_dir:
        raise GitError("Not a git repository")
    try:
        return pygit2.Repository(git_dir)
    except Exception as exc:
        raise GitError("Not a git repository") from exc


def _repo_status(repo: pygit2.Repository, *, ignored: bool) -> dict[str, int]:
    status = {
        str(path): int(flags)
        for path, flags in repo.status(untracked_files="normal", ignored=False).items()
    }
    if not ignored:
        return status

    expanded_ignored = {
        str(path): int(flags)
        for path, flags in repo.status(untracked_files="all", ignored=True).items()
        if int(flags) & pygit2.GIT_STATUS_IGNORED
    }
    status.update(expanded_ignored)
    return status


def _normalize_status_path(raw_path: str) -> str:
    path = raw_path.strip().replace("\\", "/")
    if " -> " in path:
        _, path = path.split(" -> ", 1)
    return path


def _collect_ignored_statuses_with_git(root: Path) -> dict[str, str]:
    """Use Git's ignored matching as a narrow parity fallback for decorations."""
    try:
        result = subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "status",
                "--porcelain=v1",
                "--ignored=matching",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return {}
    if result.returncode != 0:
        return {}

    ignored: dict[str, str] = {}
    for raw_line in result.stdout.splitlines():
        if not raw_line.startswith("!! "):
            continue
        path = _normalize_status_path(raw_line[3:])
        if path:
            ignored[path] = "ignored"
    return ignored


def _map_git_status_flags(flags: int) -> str:
    if flags & pygit2.GIT_STATUS_IGNORED:
        return "ignored"
    if flags & pygit2.GIT_STATUS_CONFLICTED:
        return "conflict"
    if flags & (pygit2.GIT_STATUS_INDEX_DELETED | pygit2.GIT_STATUS_WT_DELETED):
        return "deleted"
    if flags & (pygit2.GIT_STATUS_INDEX_RENAMED | pygit2.GIT_STATUS_WT_RENAMED):
        return "renamed"
    if flags & pygit2.GIT_STATUS_INDEX_NEW:
        return "added"
    if _has_index_status(flags) and _has_worktree_status(flags):
        return "staged_modified"
    if _has_index_status(flags):
        return "staged"
    if flags & pygit2.GIT_STATUS_WT_NEW:
        return "untracked"
    if _has_worktree_status(flags):
        return "modified"
    return "clean"


def _has_index_status(flags: int) -> bool:
    return bool(
        flags
        & (
            pygit2.GIT_STATUS_INDEX_NEW
            | pygit2.GIT_STATUS_INDEX_MODIFIED
            | pygit2.GIT_STATUS_INDEX_DELETED
            | pygit2.GIT_STATUS_INDEX_RENAMED
            | pygit2.GIT_STATUS_INDEX_TYPECHANGE
        )
    )


def _has_worktree_status(flags: int) -> bool:
    return bool(
        flags
        & (
            pygit2.GIT_STATUS_WT_MODIFIED
            | pygit2.GIT_STATUS_WT_DELETED
            | pygit2.GIT_STATUS_WT_RENAMED
            | pygit2.GIT_STATUS_WT_TYPECHANGE
            | pygit2.GIT_STATUS_WT_UNREADABLE
        )
    )
