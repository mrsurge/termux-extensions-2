"""Git diff helper utilities for the CM6 file editor."""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

from .worker_services import git_service as worker_git_service


JsonObject = dict[str, object]


class DiffLine(TypedDict):
    type: str
    text: str


class DiffHunk(TypedDict):
    oldStart: int
    oldLines: int
    newStart: int
    newLines: int
    lines: list[DiffLine]


CACHE_TTL_SECONDS = 5.0
MAX_DIFF_BYTES = 512 * 1024  # 512 KiB safety cap


@dataclass
class DiffCacheEntry:
    timestamp: float
    value: JsonObject
    size: int


_DIFF_CACHE: dict[tuple[str, str, str], DiffCacheEntry] = {}


def _diff_payload(
    *,
    hunks: list[DiffHunk] | None = None,
    added: int = 0,
    deleted: int = 0,
    tracked: bool,
    error: str | None = None,
) -> JsonObject:
    payload: JsonObject = {
        "hunks": hunks or [],
        "summary": {"added": added, "deleted": deleted, "tracked": tracked},
    }
    if error is not None:
        payload["error"] = error
    return payload


def invalidate_diff_cache(project_root: Path | None = None, rel_path: str | None = None) -> None:
    """Invalidate cached diff results."""
    if project_root is None:
        _DIFF_CACHE.clear()
        return

    try:
        root_key = str(project_root.resolve())
    except Exception:
        root_key = str(project_root)

    if rel_path is None:
        for key in list(_DIFF_CACHE.keys()):
            if key[0] == root_key:
                _ = _DIFF_CACHE.pop(key, None)
        return

    for key in list(_DIFF_CACHE.keys()):
        if key[0] == root_key and key[1] == rel_path:
            _ = _DIFF_CACHE.pop(key, None)


def collect_diff(project_root: Path, rel_path: str, base_ref: str | None = None) -> JsonObject:
    """
    Collect a unified diff (0 context) for the given file relative to the project root.

    Returns a payload shaped for the frontend:
      {
        "hunks": [
          {
            "oldStart": int,
            "oldLines": int,
            "newStart": int,
            "newLines": int,
            "lines": [{"type": "context|add|del", "text": str}]
          },
        ],
        "summary": {"added": int, "deleted": int, "tracked": bool},
      }
    """
    try:
        root_key = str(project_root.resolve())
    except Exception:
        root_key = str(project_root)

    base = (base_ref or 'HEAD').strip() or 'HEAD'
    cache_key = (root_key, rel_path, base)
    now = time.time()
    entry = _DIFF_CACHE.get(cache_key)
    if entry and now - entry.timestamp < CACHE_TTL_SECONDS:
        return entry.value

    rel_path_posix = rel_path.replace("\\", "/")
    pipe_payload = worker_git_service.get_diff_hunks(project_root, rel_path_posix, base)
    summary = pipe_payload.get("summary")
    hunks = pipe_payload.get("hunks") or []
    added = summary["added"] if summary is not None else 0
    deleted = summary["deleted"] if summary is not None else 0
    tracked = summary["tracked"] if summary is not None else False
    error = pipe_payload.get("error")
    payload = _diff_payload(
        hunks=hunks,
        added=added,
        deleted=deleted,
        tracked=tracked,
        error=error,
    )

    _DIFF_CACHE[cache_key] = DiffCacheEntry(timestamp=now, value=payload, size=len(str(payload)))
    return payload
