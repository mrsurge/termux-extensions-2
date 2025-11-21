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
    original_path: Optional[str] = None


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


def _normalize_status_path(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    return cleaned.replace("\\", "/")


def get_worktree_changes(project_root: Path, base_ref: Optional[str] = None) -> List[GitChangeEntry]:
    """Return diff-style entries describing changes vs the requested base."""
    _ensure_repo(project_root)
    ref = (base_ref or 'HEAD').strip() or 'HEAD'

    if ref == 'HEAD':
        output = _run_git_optional(
            project_root,
            "status",
            "--short",
            "--untracked-files=all",
            "--renames",
        ) or ""

        entries: List[GitChangeEntry] = []
        for line in output.splitlines():
            if not line or len(line) < 3:
                continue
            code = line[:2]
            idx = 3 if len(line) > 3 and line[2] == ' ' else 2
            remainder = line[idx:]
            original_path = None
            path_part = remainder
            if " -> " in remainder:
                original_path, path_part = remainder.split(" -> ", 1)

            path = _normalize_status_path(path_part)
            original = _normalize_status_path(original_path)

            if not path:
                continue

            entries.append(GitChangeEntry(path=path, code=code, original_path=original))

        return entries

    diff_output = _run_git_optional(
        project_root,
        "diff",
        "--name-status",
        ref,
        "--",
    ) or ""

    entries: List[GitChangeEntry] = []
    seen_paths: set[str] = set()
    for raw in diff_output.splitlines():
        if not raw:
            continue
        parts = raw.split('\t')
        if not parts:
            continue
        code = parts[0].strip()
        path = None
        original = None
        if code.startswith('R') and len(parts) >= 3:
            original = _normalize_status_path(parts[1])
            path = _normalize_status_path(parts[2])
            code = 'R'
        elif len(parts) >= 2:
            path = _normalize_status_path(parts[1])
        else:
            path = _normalize_status_path(parts[0])

        if not path:
            continue

        entries.append(GitChangeEntry(path=path, code=code or 'M', original_path=original))
        seen_paths.add(path)

    untracked_output = _run_git_optional(
        project_root,
        "ls-files",
        "--others",
        "--exclude-standard",
    ) or ""

    for raw in untracked_output.splitlines():
        path = _normalize_status_path(raw)
        if not path:
            continue
        if path in seen_paths:
            continue
        entries.append(GitChangeEntry(path=path, code='??'))

    return entries


def get_commit_info(project_root: Path, ref: str = 'HEAD') -> Optional[GitCommit]:
    _ensure_repo(project_root)
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

def stage_paths(project_root: Path, paths: List[str]) -> GitStatus:
    """Stage specific files or directories."""
    _ensure_repo(project_root)
    if not paths:
        return get_status(project_root)
    
    # Stage each path
    for path in paths:
        _run_git(project_root, "add", "--", path)
    
    return get_status(project_root)

def unstage_paths(project_root: Path, paths: List[str]) -> GitStatus:
    """Unstage specific files or directories."""
    _ensure_repo(project_root)
    if not paths:
        return get_status(project_root)
    
    has_commits = _has_commits(project_root)
    
    for path in paths:
        if has_commits:
            _run_git(project_root, "reset", "HEAD", "--", path)
        else:
            # No commits yet: remove from index
            _run_git(project_root, "rm", "--cached", "--", path)
    
    return get_status(project_root)

def get_commits_for_path(project_root: Path, path: str, limit: int = 20) -> List[GitCommit]:
    """Get commit history for a specific path."""
    _ensure_repo(project_root)
    
    output = _run_git(
        project_root,
        "log",
        f"--max-count={limit}",
        "--format=%H|%h|%s|%an|%ai",
        "--",
        path
    )
    
    commits = []
    for line in output.splitlines():
        if not line:
            continue
        parts = line.split('|', 4)
        if len(parts) == 5:
            commits.append(GitCommit(
                hash=parts[0],
                short_hash=parts[1],
                summary=parts[2],
                author=parts[3],
                date=parts[4]
            ))
    return commits

def restore_path(project_root: Path, path: str, commit: str = "HEAD") -> None:
    """Restore a path to a specific commit."""
    _ensure_repo(project_root)
    _run_git(project_root, "restore", f"--source={commit}", "--", path)

def get_commits(project_root: Path, limit: int = 50) -> List[GitCommit]:
    """Get recent commits for the repository."""
    _ensure_repo(project_root)
    
    output = _run_git(
        project_root,
        "log",
        f"--max-count={limit}",
        "--format=%H|%h|%s|%an|%ai"
    )
    
    commits = []
    for line in output.splitlines():
        if not line:
            continue
        parts = line.split('|', 4)
        if len(parts) == 5:
            commits.append(GitCommit(
                hash=parts[0],
                short_hash=parts[1],
                summary=parts[2],
                author=parts[3],
                date=parts[4]
            ))
    return commits

def reset_hard(project_root: Path, commit: str = "HEAD") -> GitStatus:
    """Perform a hard reset to the specified commit."""
    _ensure_repo(project_root)
    _run_git(project_root, "reset", "--hard", commit)
    return get_status(project_root)

def init_repository(project_root: Path) -> GitStatus:
    """Initialize a new git repository."""
    try:
        _run_git(project_root, "init")
        # Set initial config
        _run_git(project_root, "config", "user.name", "User")
        _run_git(project_root, "config", "user.email", "user@example.com")
        return get_status(project_root)
    except Exception as exc:
        raise GitError(f"Failed to initialize repository: {str(exc)}")

def is_git_repository(project_root: Path) -> bool:
    """Check if directory is a git repository."""
    out = _run_git_optional(project_root, "rev-parse", "--is-inside-work-tree")
    return out is not None and out.strip() == "true"
