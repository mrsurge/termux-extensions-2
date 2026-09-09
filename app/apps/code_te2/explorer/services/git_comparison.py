"""Cache-only historical appearance; actual Git status remains independent."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from collections.abc import Callable
from typing import TypeVar

from ...stores import get_history_store
from ...worker_services import git_service


@dataclass(frozen=True)
class Comparison:
    ref: str
    statuses: dict[str, str]


_lock = RLock()
_cache: dict[str, Comparison] = {}
T = TypeVar("T")


def selected_ref(project: Path) -> str:
    return get_history_store().get_diff_base(str(project.resolve())) or "HEAD"


def require_head(project: Path) -> None:
    if selected_ref(project) != "HEAD":
        raise ValueError("Return to HEAD view before staging, committing, or restoring files")


def head_action(project: Path, action: Callable[[], T]) -> T:
    require_head(project)
    return action()


def is_historical_change(project: Path, rel: str) -> bool:
    ref = selected_ref(project)
    with _lock:
        cached = _cache.get(str(project.resolve()))
        return bool(ref != "HEAD" and cached and cached.ref == ref and rel in cached.statuses)


def compute(project: Path, ref: str, revision: str) -> Comparison:
    changes = git_service.get_worktree_changes(project, revision, limit=100_000)
    if len(changes) >= 100_000:
        raise ValueError("Historical decorations exceed the 100,000-path limit")
    codes = {"M": "modified", "T": "modified", "A": "added", "D": "deleted",
             "R": "renamed", "C": "added", "U": "conflict", "?": "untracked"}
    return Comparison(ref, {
        entry.path: codes.get(entry.code.strip()[:1], "modified") for entry in changes
    })


def install(project: Path, comparison: Comparison) -> None:
    with _lock:
        _cache.clear()
        _cache[str(project.resolve())] = comparison


def cached_statuses(project: Path) -> dict[str, str]:
    ref = selected_ref(project)
    if ref == "HEAD":
        return git_service.get_cached_statuses(project)
    with _lock:
        cached = _cache.get(str(project.resolve()))
        return dict(cached.statuses) if cached and cached.ref == ref else {}


def actual_flags(snapshot: git_service.GitSnapshot | None) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    if snapshot:
        for paths, flag in ((snapshot["staged"], "staged"), (snapshot["unstaged"], "modified"), (snapshot["untracked"], "modified")):
            for path in paths:
                flags = result.setdefault(path, [])
                if flag not in flags:
                    flags.append(flag)
    return result


def actual_statuses(snapshot: git_service.GitSnapshot | None) -> dict[str, str]:
    statuses: dict[str, str] = dict(snapshot["statuses"]) if snapshot else {}
    for path, flags in actual_flags(snapshot).items():
        if "staged" in flags:
            statuses[path] = "staged_modified" if "modified" in flags else "staged"
    return statuses
