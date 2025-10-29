"""Git helpers used by the Code CM6 editor backend."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

GIT_TIMEOUT = 20


class GitError(RuntimeError):
    """Exception raised when a git command fails or repository is invalid."""

    def __init__(self, message: str):
        super().__init__(message)


@dataclass
class GitBranches:
    current: str
    branches: List[str]


@dataclass
class GitStatus:
    branch: str
    detached: bool
    ahead: int
    behind: int
    staged: List[str]
    unstaged: List[str]
    untracked: List[str]


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


def _run_git_optional(project_root: Path, *args: str) -> Optional[str]:
    try:
        completed = subprocess.run(
            ["git", "-C", str(project_root), *args],
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


def _has_commits(project_root: Path) -> bool:
    completed = subprocess.run(
        ["git", "-C", str(project_root), "rev-parse", "--verify", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
        timeout=GIT_TIMEOUT,
    )
    return completed.returncode == 0


def _collect_status(project_root: Path) -> Tuple[List[str], List[str], List[str]]:
    output = _run_git_optional(project_root, "status", "--short") or ""
    staged: List[str] = []
    unstaged: List[str] = []
    untracked: List[str] = []
    for line in output.splitlines():
        if len(line) < 3:
            continue
        code = line[:2]
        path = line[3:].strip()
        if not path:
            continue
        if code == "??":
            untracked.append(path)
        else:
            if code[0] != ' ':
                staged.append(path)
            if code[1] != ' ':
                unstaged.append(path)
    return staged, unstaged, untracked


def list_branches(project_root: Path) -> GitBranches:
    _ensure_repo(project_root)
    symbolic = _run_git_optional(project_root, "symbolic-ref", "--short", "HEAD")
    if symbolic is None:
        current = "HEAD"
    else:
        current = symbolic.strip()
    raw = _run_git_optional(project_root, "branch", "--list", "--format=%(refname:short)") or ""
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


def get_status(project_root: Path) -> GitStatus:
    _ensure_repo(project_root)

    branch = "HEAD"
    detached = False
    symbolic = _run_git_optional(project_root, "symbolic-ref", "--short", "HEAD")
    if symbolic:
        branch = symbolic.strip()
    else:
        detached = True

    ahead = behind = 0
    if not detached and _has_commits(project_root):
        upstream = _run_git_optional(project_root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        if upstream:
            counts = _run_git_optional(project_root, "rev-list", "--left-right", "--count", "@{u}...HEAD")
            if counts:
                parts = counts.split()
                if len(parts) == 2:
                    behind = int(parts[0])
                    ahead = int(parts[1])

    staged, unstaged, untracked = _collect_status(project_root)

    return GitStatus(
        branch=branch,
        detached=detached,
        ahead=ahead,
        behind=behind,
        staged=staged,
        unstaged=unstaged,
        untracked=untracked,
    )


def stage_all(project_root: Path) -> GitStatus:
    _ensure_repo(project_root)
    _run_git(project_root, "add", "-A")
    return get_status(project_root)


def unstage_all(project_root: Path) -> GitStatus:
    _ensure_repo(project_root)
    staged, _, _ = _collect_status(project_root)
    if not staged:
        return get_status(project_root)

    if _has_commits(project_root):
        _run_git(project_root, "reset", "HEAD", "--", ".")
    else:
        # No commits yet: remove entries from the index to make them untracked again.
        for path in staged:
            _run_git(project_root, "rm", "--cached", "--", path)
    return get_status(project_root)


def commit_changes(project_root: Path, message: str, amend: bool = False) -> GitStatus:
    if not message.strip():
        raise GitError("Commit message required")
    status = get_status(project_root)
    if not status.staged and not amend:
        raise GitError("No staged changes to commit")
    args = ["commit", "-m", message]
    if amend:
        args.append("--amend")
    try:
        _run_git(project_root, *args)
    except GitError as exc:
        if "nothing to commit" in str(exc).lower():
            raise GitError("Nothing to commit")
        raise
    return get_status(project_root)


def push_changes(project_root: Path, remote: Optional[str] = None, branch: Optional[str] = None, force: bool = False) -> GitStatus:
    _ensure_repo(project_root)
    args = ["push"]
    if remote:
        args.append(remote)
    if branch:
        args.append(branch)
    if force:
        args.append("--force")
    _run_git(project_root, *args)
    return get_status(project_root)


def pull_changes(project_root: Path, remote: Optional[str] = None, branch: Optional[str] = None, rebase: bool = False) -> GitStatus:
    _ensure_repo(project_root)
    args = ["pull"]
    if rebase:
        args.append("--rebase")
    if remote:
        args.append(remote)
    if branch:
        args.append(branch)
    _run_git(project_root, *args)
    return get_status(project_root)
