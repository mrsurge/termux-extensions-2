# pyright: strict
from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path
from typing import cast

from ..git_helper import GitStatus, get_status as _get_git_status

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
    return _get_git_status(project_root)


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
    """Collect git decoration status for files under root.

    This is the temporary CLI-backed implementation behind the app-wide service
    seam. Phase 2 replaces it with pygit2.
    """
    if not _is_git_repo(root):
        return {}

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

    status_map: dict[str, str] = {}
    for raw_line in result.stdout.splitlines():
        if not raw_line or len(raw_line) < 3:
            continue
        code = raw_line[:2]
        remainder = raw_line[3:]
        if " -> " in remainder:
            _, remainder = remainder.split(" -> ", 1)
        path = remainder.strip().replace("\\", "/")
        if not path:
            continue
        status_map[path] = _map_git_code(code)
    return status_map


def _is_git_repo(root: Path) -> bool:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--is-inside-work-tree"],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return False
    return result.returncode == 0 and result.stdout.strip() == "true"


def _map_git_code(code: str) -> str:
    if code == "??":
        return "untracked"
    if code == "!!":
        return "ignored"

    index_status = code[0]
    worktree_status = code[1]

    if "U" in code or (index_status == "A" and worktree_status == "A"):
        return "conflict"
    if index_status == "D" or worktree_status == "D":
        return "deleted"
    if index_status == "R":
        return "renamed"
    if index_status == "A":
        return "added"
    if index_status != " " and worktree_status != " ":
        return "staged_modified"
    if index_status != " ":
        return "staged"
    if worktree_status != " ":
        return "modified"
    return "clean"
