"""Minimal Git helpers for Code CM6 branch menu."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List

GIT_TIMEOUT = 15


class GitError(RuntimeError):
    """Raised when a git command fails."""

    def __init__(self, message: str):
        super().__init__(message)


@dataclass
class GitBranches:
    current: str
    branches: List[str]


def _run_git(project_root: Path, *args: str) -> str:
    try:
        completed = subprocess.run(
            ["git", "-C", str(project_root), *args],
            check=True,
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT,
        )
    except subprocess.CalledProcessError as exc:
        raise GitError(exc.stderr.strip() or f"git {' '.join(args)} failed") from exc
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"git {' '.join(args)} timed out") from exc
    return completed.stdout.strip()


def _ensure_repo(project_root: Path) -> None:
    out = _run_git(project_root, "rev-parse", "--is-inside-work-tree")
    if out.strip() != "true":
        raise GitError("Not a git repository")


def list_branches(project_root: Path) -> GitBranches:
    _ensure_repo(project_root)
    current = _run_git(project_root, "rev-parse", "--abbrev-ref", "HEAD")
    raw = _run_git(project_root, "branch", "--list", "--format=%(refname:short)")
    branches = [line.strip() for line in raw.splitlines() if line.strip()]
    return GitBranches(current=current, branches=branches)


def checkout_branch(project_root: Path, name: str) -> GitBranches:
    if not name:
        raise GitError("Branch name required")
    _ensure_repo(project_root)
    _run_git(project_root, "checkout", name)
    return list_branches(project_root)


def create_branch(project_root: Path, name: str) -> GitBranches:
    if not name:
        raise GitError("Branch name required")
    _ensure_repo(project_root)
    _run_git(project_root, "branch", name)
    _run_git(project_root, "checkout", name)
    return list_branches(project_root)
