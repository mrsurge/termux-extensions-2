"""Git command helpers for the Code CM6 backend."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence

GIT_TIMEOUT = 30
LOG_MAX_RECORDS = 500


class GitError(RuntimeError):
    """Raised when a git command fails."""

    def __init__(self, message: str, *, code: Optional[int] = None, stderr: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.stderr = stderr


@dataclass
class GitCommandResult:
    code: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.code == 0


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _git_env() -> Dict[str, str]:
    env = os.environ.copy()
    env.setdefault("LC_ALL", "C")
    env.setdefault("LANG", "C")
    return env


def _run_git(project_root: Path, args: Sequence[str], *, check: bool = False) -> GitCommandResult:
    cmd = ["git", "-C", str(project_root), *args]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            timeout=GIT_TIMEOUT,
            env=_git_env(),
        )
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"git {' '.join(args)} timed out") from exc
    result = GitCommandResult(code=proc.returncode, stdout=proc.stdout, stderr=proc.stderr)
    if check and result.code != 0:
        raise GitError(
            f"git {' '.join(args)} failed (exit {result.code})",
            code=result.code,
            stderr=result.stderr.strip(),
        )
    return result


def _normalize_paths(paths: Iterable[str]) -> List[str]:
    normed: List[str] = []
    for path in paths:
        if not path:
            continue
        normed.append(Path(path).as_posix())
    return normed


def _repo_check(project_root: Path) -> None:
    result = _run_git(project_root, ["rev-parse", "--is-inside-work-tree"])
    if result.code != 0 or result.stdout.strip() != "true":
        raise GitError(f"Directory {project_root} is not a Git repository")


def _ensure_within_root(project_root: Path, candidate: Path) -> Path:
    root_resolved = project_root.resolve()
    candidate_resolved = candidate.resolve()
    if not str(candidate_resolved).startswith(str(root_resolved)):
        raise GitError("Path escapes project root")
    return candidate_resolved


# ---------------------------------------------------------------------------
# logging
# ---------------------------------------------------------------------------

_default_store = Path.home() / ".local" / "share" / "termux-extensions-2"
_log_path = _default_store / "code_cm6_git_log.jsonl"
_log_lock = threading.Lock()


def append_git_log(entry: Dict[str, object]) -> None:
    entry = dict(entry)
    entry.setdefault("ts", time.time())
    _log_path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(entry, ensure_ascii=False)
    with _log_lock:
        with _log_path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        _trim_log_locked()


def _trim_log_locked() -> None:
    if not _log_path.exists():
        return
    lines = _log_path.read_text(encoding="utf-8").splitlines()
    if len(lines) <= LOG_MAX_RECORDS:
        return
    tail = lines[-LOG_MAX_RECORDS:]
    _log_path.write_text("\n".join(tail) + "\n", encoding="utf-8")


def read_git_log(limit: int = 200) -> List[Dict[str, object]]:
    if not _log_path.exists():
        return []
    lines = _log_path.read_text(encoding="utf-8").splitlines()
    tail = lines[-max(1, min(limit, LOG_MAX_RECORDS)) :]
    entries: List[Dict[str, object]] = []
    for line in tail:
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries


# ---------------------------------------------------------------------------
# repository status
# ---------------------------------------------------------------------------


def get_repo_status(project_root: Path) -> Dict[str, object]:
    try:
        _repo_check(project_root)
    except GitError:
        return {
            "isRepo": False,
            "branch": None,
            "detached": False,
            "head": None,
            "upstream": None,
            "ahead": 0,
            "behind": 0,
            "changes": 0,
        }

    head_branch = _run_git(project_root, ["rev-parse", "--abbrev-ref", "HEAD"], check=False)
    branch = head_branch.stdout.strip() if head_branch.code == 0 else None
    detached = branch == "HEAD"

    head_commit = _run_git(project_root, ["rev-parse", "HEAD"], check=False)
    head_sha = head_commit.stdout.strip() if head_commit.code == 0 else None

    upstream_name = None
    ahead = behind = 0
    if not detached:
        upstream_res = _run_git(project_root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], check=False)
        if upstream_res.code == 0:
            upstream_name = upstream_res.stdout.strip() or None
            counts = _run_git(project_root, ["rev-list", "--left-right", "--count", "@{u}...HEAD"], check=False)
            if counts.code == 0:
                parts = counts.stdout.strip().split()
                if len(parts) == 2:
                    behind = int(parts[0])
                    ahead = int(parts[1])

    status_res = _run_git(project_root, ["status", "--short"], check=False)
    status_lines = status_res.stdout.splitlines() if status_res.stdout else []
    changes = len(status_lines)

    head_details = None
    if head_sha:
        log_res = _run_git(
            project_root,
            [
                "log",
                "-1",
                "--pretty=format:%H%x00%an%x00%ad%x00%s",
            ],
            check=False,
        )
        if log_res.code == 0:
            parts = log_res.stdout.strip().split("\x00")
            if len(parts) == 4:
                head_details = {
                    "sha": parts[0],
                    "author": parts[1],
                    "date": parts[2],
                    "subject": parts[3],
                }

    return {
        "isRepo": True,
        "branch": None if detached else branch,
        "detached": detached,
        "head": head_details,
        "upstream": upstream_name,
        "ahead": ahead,
        "behind": behind,
        "changes": changes,
        "statusLines": status_lines,
    }


# ---------------------------------------------------------------------------
# branches & commits
# ---------------------------------------------------------------------------


def list_branches(project_root: Path, include_remote: bool = True) -> Dict[str, List[Dict[str, object]]]:
    _repo_check(project_root)
    branches: Dict[str, List[Dict[str, object]]] = {"local": [], "remote": []}

    local_res = _run_git(
        project_root,
        [
            "for-each-ref",
            "--format=%(refname:short)\t%(objectname)\t%(upstream:short)\t%(HEAD)",
            "refs/heads",
        ],
        check=False,
    )
    if local_res.code == 0:
        for line in local_res.stdout.splitlines():
            if not line:
                continue
            parts = line.split("\t")
            while len(parts) < 4:
                parts.append("")
            name, sha, upstream, head_flag = parts[:4]
            branches["local"].append(
                {
                    "name": name.strip(),
                    "sha": sha.strip() or None,
                    "upstream": upstream.strip() or None,
                    "isHead": head_flag.strip() == "*",
                }
            )

    if include_remote:
        remote_res = _run_git(
            project_root,
            [
                "for-each-ref",
                "--format=%(refname:short)\t%(objectname)",
                "refs/remotes",
            ],
            check=False,
        )
        if remote_res.code == 0:
            for line in remote_res.stdout.splitlines():
                if not line:
                    continue
                parts = line.split("\t")
                while len(parts) < 2:
                    parts.append("")
                name, sha = parts[:2]
                branches["remote"].append(
                    {
                        "name": name.strip(),
                        "sha": sha.strip() or None,
                    }
                )

    return branches


def checkout_branch(project_root: Path, name: str, *, create: bool = False, start_point: Optional[str] = None) -> Dict[str, object]:
    _repo_check(project_root)
    args = ["checkout"]
    if create:
        args.append("-b")
    args.append(name)
    if create and start_point:
        args.append(start_point)
    result = _run_git(project_root, args, check=True)
    append_git_log({"cmd": "checkout", "args": args[1:], "stdout": result.stdout.strip()})
    return {
        "message": result.stdout.strip(),
        "branch": name,
    }


def create_branch(project_root: Path, name: str, *, start_point: Optional[str] = None) -> Dict[str, object]:
    _repo_check(project_root)
    args = ["branch", name]
    if start_point:
        args.append(start_point)
    result = _run_git(project_root, args, check=True)
    append_git_log({"cmd": "branch", "args": args[1:], "stdout": result.stdout.strip()})
    return {
        "branch": name,
        "startPoint": start_point,
    }


def list_commits(project_root: Path, ref: str = "HEAD", limit: int = 50) -> List[Dict[str, str]]:
    _repo_check(project_root)
    limit = max(1, min(limit, 200))
    result = _run_git(
        project_root,
        [
            "log",
            f"-n{limit}",
            "--pretty=format:%H%x00%an%x00%ad%x00%s",
            ref,
        ],
        check=True,
    )
    commits: List[Dict[str, str]] = []
    for line in result.stdout.splitlines():
        if not line:
            continue
        parts = line.split("\x00")
        if len(parts) != 4:
            continue
        commits.append(
            {
                "sha": parts[0],
                "author": parts[1],
                "date": parts[2],
                "subject": parts[3],
            }
        )
    return commits


def reset_to_commit(project_root: Path, ref: str, mode: str = "mixed") -> Dict[str, object]:
    _repo_check(project_root)
    if mode not in {"soft", "mixed", "hard", "keep"}:
        raise GitError(f"Unsupported reset mode: {mode}")
    args = ["reset", f"--{mode}", ref]
    result = _run_git(project_root, args, check=True)
    append_git_log({"cmd": "reset", "args": [mode, ref], "stdout": result.stdout.strip()})
    return {
        "message": result.stdout.strip(),
        "ref": ref,
        "mode": mode,
    }


# ---------------------------------------------------------------------------
# staging / workspace
# ---------------------------------------------------------------------------


def stage_paths(project_root: Path, paths: Sequence[str]) -> Dict[str, object]:
    _repo_check(project_root)
    normed = _normalize_paths(paths)
    if not normed:
        return {"staged": []}
    _run_git(project_root, ["add", "--"] + list(normed), check=True)
    append_git_log({"cmd": "add", "paths": list(normed)})
    return {"staged": list(normed)}


def unstage_paths(project_root: Path, paths: Sequence[str]) -> Dict[str, object]:
    _repo_check(project_root)
    normed = _normalize_paths(paths)
    if not normed:
        return {"unstaged": []}
    _run_git(project_root, ["reset", "HEAD", "--"] + list(normed), check=True)
    append_git_log({"cmd": "reset", "paths": list(normed)})
    return {"unstaged": list(normed)}


def discard_paths(project_root: Path, paths: Sequence[str]) -> Dict[str, object]:
    _repo_check(project_root)
    normed = _normalize_paths(paths)
    if not normed:
        return {"discarded": []}
    _run_git(project_root, ["checkout", "--"] + list(normed), check=True)
    append_git_log({"cmd": "checkout", "paths": list(normed)})
    return {"discarded": list(normed)}


# ---------------------------------------------------------------------------
# commit / push / pull
# ---------------------------------------------------------------------------


def commit(project_root: Path, *, message: str, body: Optional[str] = None, amend: bool = False) -> Dict[str, object]:
    _repo_check(project_root)
    if not message:
        raise GitError("Commit message required")

    full_message = message.strip()
    if body:
        full_message = f"{full_message}\n\n{body.strip()}"

    args = ["commit", "-F", "-"]
    if amend:
        args.append("--amend")
    result = subprocess.run(
        ["git", "-C", str(project_root), *args],
        input=full_message,
        text=True,
        capture_output=True,
        env=_git_env(),
    )
    if result.returncode != 0:
        raise GitError(
            "git commit failed",
            code=result.returncode,
            stderr=result.stderr.strip(),
        )
    append_git_log({"cmd": "commit", "message": message, "amend": amend})
    return {"stdout": result.stdout.strip(), "stderr": result.stderr.strip()}


def push(project_root: Path, *, remote: Optional[str] = None, branch: Optional[str] = None, force: bool = False) -> Dict[str, object]:
    _repo_check(project_root)
    args = ["push"]
    if remote:
        args.append(remote)
    if branch:
        args.append(branch)
    if force:
        args.append("--force")
    result = _run_git(project_root, args, check=True)
    append_git_log({"cmd": "push", "args": args[1:], "stdout": result.stdout.strip()})
    return {"stdout": result.stdout.strip(), "stderr": result.stderr.strip()}


def pull(project_root: Path, *, remote: Optional[str] = None, branch: Optional[str] = None, rebase: bool = False) -> Dict[str, object]:
    _repo_check(project_root)
    args = ["pull"]
    if rebase:
        args.append("--rebase")
    if remote:
        args.append(remote)
    if branch:
        args.append(branch)
    result = _run_git(project_root, args, check=True)
    append_git_log({"cmd": "pull", "args": args[1:], "stdout": result.stdout.strip()})
    return {"stdout": result.stdout.strip(), "stderr": result.stderr.strip()}


# ---------------------------------------------------------------------------
# explorer mutations
# ---------------------------------------------------------------------------


def create_entry(project_root: Path, *, kind: str, base_dir: str, name: str, stage: bool = False) -> Dict[str, object]:
    _repo_check(project_root)
    if kind not in {"file", "dir"}:
        raise GitError("kind must be 'file' or 'dir'")

    base = _ensure_within_root(project_root, (project_root / base_dir))
    target = _ensure_within_root(project_root, base / name)

    if target.exists():
        raise GitError("Target already exists")

    if kind == "dir":
        target.mkdir(parents=True, exist_ok=False)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.touch(exist_ok=False)

    rel = target.relative_to(project_root).as_posix()
    if stage and kind == "file":
        stage_paths(project_root, [rel])
    append_git_log({"cmd": "create", "kind": kind, "path": rel})
    return {"path": rel, "kind": kind}


def delete_entry(project_root: Path, *, path: str, stage_removal: bool = False) -> Dict[str, object]:
    _repo_check(project_root)
    target = _ensure_within_root(project_root, project_root / path)
    if not target.exists():
        raise GitError("Target does not exist")

    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()

    rel = target.relative_to(project_root).as_posix()
    if stage_removal:
        _run_git(project_root, ["add", "-u", "--", rel], check=False)
    append_git_log({"cmd": "delete", "path": rel, "stage": stage_removal})
    return {"path": rel}


def rename_entry(project_root: Path, *, path: str, new_path: str, stage: bool = False) -> Dict[str, object]:
    _repo_check(project_root)
    source = _ensure_within_root(project_root, project_root / path)
    if not source.exists():
        raise GitError("Source does not exist")
    destination = _ensure_within_root(project_root, project_root / new_path)
    if destination.exists():
        raise GitError("Destination already exists")

    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(destination))

    rel_old = source.relative_to(project_root).as_posix()
    rel_new = destination.relative_to(project_root).as_posix()

    if stage:
        _run_git(project_root, ["add", "--all", "--", rel_old, rel_new], check=False)
    append_git_log({"cmd": "rename", "from": rel_old, "to": rel_new, "stage": stage})
    return {"from": rel_old, "to": rel_new}


__all__ = [
    "GitError",
    "GitCommandResult",
    "append_git_log",
    "read_git_log",
    "get_repo_status",
    "list_branches",
    "checkout_branch",
    "create_branch",
    "list_commits",
    "reset_to_commit",
    "stage_paths",
    "unstage_paths",
    "discard_paths",
    "commit",
    "push",
    "pull",
    "create_entry",
    "delete_entry",
    "rename_entry",
]
