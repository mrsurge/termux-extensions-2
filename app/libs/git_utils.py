"""Shared Git utilities and API endpoints."""

from __future__ import annotations

import subprocess
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query

git_utils_bp = APIRouter(prefix="/api")

GIT_TIMEOUT = 20


class GitError(RuntimeError):
    """Exception raised when a git command fails or repository is invalid."""

    def __init__(self, message: str):
        super().__init__(message)


@dataclass
class GitCommit:
    hash: str
    short_hash: str
    summary: str
    author: str
    date: str


def _run_git_optional(project_root: Path, *args: str) -> Optional[str]:
    git_exec = shutil.which('git')
    if not git_exec:
        return None
        
    try:
        completed = subprocess.run(
            [git_exec, "-C", str(project_root), *args],
            check=False,
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT,
        )
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"git {' '.join(args)} timed out") from exc
    if completed.returncode != 0:
        return None
    return completed.stdout.strip()


def _ensure_repo(project_root: Path) -> None:
    out = _run_git_optional(project_root, "rev-parse", "--is-inside-work-tree")
    if out is None or out.strip() != "true":
        raise GitError("Not a git repository")


def get_commit_info(project_root: Path, ref: str = 'HEAD') -> Optional[GitCommit]:
    fmt = "%H|%h|%s|%an|%ai"
    out = _run_git_optional(project_root, "log", "-1", f"--format={fmt}", ref)
    if not out:
        return None
    parts = out.split('|', 4)
    if len(parts) != 5:
        return None
    return GitCommit(
        hash=parts[0],
        short_hash=parts[1],
        summary=parts[2],
        author=parts[3],
        date=parts[4],
    )


def get_current_branch(project_root: Path) -> str:
    symbolic = _run_git_optional(project_root, "symbolic-ref", "--short", "HEAD")
    if symbolic:
        return symbolic.strip()
    return "DETACHED"


def is_git_repository(project_root: Path) -> bool:
    """Check if directory is a git repository."""
    out = _run_git_optional(project_root, "rev-parse", "--is-inside-work-tree")
    return out is not None and out.strip() == "true"


@git_utils_bp.get('/git/summary')
async def get_git_summary(path: str = Query(...)):
    """
    Get lightweight git summary for a path (repo root or subdirectory).
    Returns { is_repo: bool, branch: str, head_hash: str, head_short: str }
    """
    if not path:
        raise HTTPException(status_code=400, detail="Path required")
    
    target_path = Path(path).expanduser().resolve()
    if not target_path.exists():
        return {"ok": True, "data": {"is_repo": False}}

    # If path is a file, use parent
    if target_path.is_file():
        target_path = target_path.parent

    if not is_git_repository(target_path):
        return {"ok": True, "data": {"is_repo": False}}

    try:
        branch = get_current_branch(target_path)
        commit = get_commit_info(target_path, "HEAD")
        
        return {
            "ok": True, 
            "data": {
                "is_repo": True,
                "branch": branch,
                "head_hash": commit.hash if commit else None,
                "head_short": commit.short_hash if commit else None,
                "summary": commit.summary if commit else None
            }
        }
    except Exception as e:
        return {"ok": True, "data": {"is_repo": True, "error": str(e)}}
