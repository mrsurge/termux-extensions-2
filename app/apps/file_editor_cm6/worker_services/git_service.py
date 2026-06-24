# pyright: strict
from __future__ import annotations

import sys
from pathlib import Path
from typing import Literal, TypedDict, cast

from app.libs import pipe_runtime
from ..git_helper import GitStatus

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


JsonObject = dict[str, object]


def _git_log(message: str) -> None:
    print(f"[worker_git_service] {message}", file=sys.stderr, flush=True)


def mark_status_cache_dirty(project_root: Path | None = None) -> None:
    """Compatibility hook: service.git owns fresh snapshot production."""
    del project_root


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
        origin_name="file_editor_cm6.git",
    )
    snapshot = _coerce_snapshot(data)
    status_count = len(snapshot["statuses"])
    _git_log(f"snapshot.pipe ok root={root_str} repo={snapshot['isRepository']} statuses={status_count}")
    return snapshot


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


def read_head_blob_text(project_root: Path, rel_path: str) -> str | None:
    """Return UTF-8 text for a file at HEAD, or None when absent/untracked."""
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
        },
        target_nid=2200,
        target_name="service.git",
        workspace_root=root_str,
        origin_name="file_editor_cm6.git",
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
