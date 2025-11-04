"""Git diff helper utilities for the CM6 file editor."""

from __future__ import annotations

import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

CACHE_TTL_SECONDS = 5.0
MAX_DIFF_BYTES = 512 * 1024  # 512 KiB safety cap


@dataclass
class DiffCacheEntry:
    timestamp: float
    value: dict
    size: int


_DIFF_CACHE: Dict[Tuple[str, str], DiffCacheEntry] = {}


def invalidate_diff_cache(project_root: Optional[Path] = None, rel_path: Optional[str] = None) -> None:
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
                _DIFF_CACHE.pop(key, None)
        return

    _DIFF_CACHE.pop((root_key, rel_path), None)


def collect_diff(project_root: Path, rel_path: str) -> dict:
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

    cache_key = (root_key, rel_path)
    now = time.time()
    entry = _DIFF_CACHE.get(cache_key)
    if entry and now - entry.timestamp < CACHE_TTL_SECONDS:
        return entry.value

    if not _is_git_repo(project_root):
        payload = {"hunks": [], "summary": {"added": 0, "deleted": 0, "tracked": False}}
        _DIFF_CACHE[cache_key] = DiffCacheEntry(timestamp=now, value=payload, size=0)
        return payload

    rel_path_posix = rel_path.replace("\\", "/")

    try:
        result = subprocess.run(
            [
                "git",
                "-C",
                str(project_root),
                "status",
                "--short",
                "--",
                rel_path_posix,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        payload = {"hunks": [], "summary": {"added": 0, "deleted": 0, "tracked": False}}
        _DIFF_CACHE[cache_key] = DiffCacheEntry(timestamp=now, value=payload, size=0)
        return payload

    status_output = result.stdout.strip()
    is_tracked = bool(status_output) or result.returncode == 0

    diff_proc = subprocess.Popen(
        [
            "git",
            "-C",
            str(project_root),
            "diff",
            "--unified=0",
            "--no-color",
            "--",
            rel_path_posix,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        stdout, stderr = diff_proc.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        diff_proc.kill()
        stdout, _ = diff_proc.communicate()
        stderr = "diff timeout"

    if diff_proc.returncode not in (0, 1):
        payload = {
            "hunks": [],
            "summary": {"added": 0, "deleted": 0, "tracked": is_tracked},
            "error": stderr.strip() or "Unable to compute diff",
        }
        _DIFF_CACHE[cache_key] = DiffCacheEntry(timestamp=now, value=payload, size=len(stdout))
        return payload

    if len(stdout) > MAX_DIFF_BYTES:
        payload = {
            "hunks": [],
            "summary": {"added": 0, "deleted": 0, "tracked": is_tracked},
            "error": "diff_too_large",
        }
        _DIFF_CACHE[cache_key] = DiffCacheEntry(timestamp=now, value=payload, size=len(stdout))
        return payload

    hunks = []
    added = 0
    deleted = 0
    current_hunk = None

    for raw_line in stdout.splitlines():
        if raw_line.startswith("@@"):
            if current_hunk:
                hunks.append(current_hunk)
            header = raw_line.strip()
            old_range, new_range = _parse_hunk_header(header)
            current_hunk = {
                "oldStart": old_range[0],
                "oldLines": old_range[1],
                "newStart": new_range[0],
                "newLines": new_range[1],
                "lines": [],
            }
        elif current_hunk is not None:
            line_type = "context"
            if raw_line.startswith("+"):
                line_type = "add"
                added += 1
            elif raw_line.startswith("-"):
                line_type = "del"
                deleted += 1
            current_hunk["lines"].append({"type": line_type, "text": raw_line[1:]})

    if current_hunk:
        hunks.append(current_hunk)

    payload = {
        "hunks": hunks,
        "summary": {"added": added, "deleted": deleted, "tracked": is_tracked},
    }

    _DIFF_CACHE[cache_key] = DiffCacheEntry(timestamp=now, value=payload, size=len(stdout))
    return payload


def _parse_hunk_header(header: str) -> Tuple[Tuple[int, int], Tuple[int, int]]:
    # header format: @@ -old_start,old_len +new_start,new_len @@
    parts = header.split("@@")
    # parts[1] like " -12,0 +15,3 "
    middle = parts[1].strip()
    old_part, new_part = middle.split(" ")
    old_range = _parse_range(old_part[1:])  # drop leading '-'
    new_range = _parse_range(new_part[1:])  # drop leading '+'
    return old_range, new_range


def _parse_range(raw: str) -> Tuple[int, int]:
    if "," in raw:
        start, length = raw.split(",", 1)
        return int(start), int(length)
    return int(raw), 1


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
