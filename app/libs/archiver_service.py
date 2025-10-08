from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.jobs import register_job_handler
from app.utils.archiver import extract_streaming_with_progress

# This helper is duplicated from archive_manager/backend.py.
# TODO: Move to a shared utility module.
HOME_DIR = Path(os.path.expanduser("~")).resolve()
def _resolve_user_path(raw: Optional[str], *, must_exist: bool = True) -> Path:
    if not raw:
        raw = "~"
    expanded = os.path.expanduser(raw)
    candidate = Path(expanded)
    try:
        resolved = candidate.resolve(strict=False)
    except Exception:
        resolved = candidate.absolute()
    if not str(resolved).startswith(str(HOME_DIR)):
        raise PermissionError(f"Access denied: {raw}")
    if must_exist and not resolved.exists():
        raise FileNotFoundError(f"Path not found: {resolved}")
    return resolved

@register_job_handler("extract_archive")
def job_extract_archive(ctx, params):
    """Background job handler for archive extraction (libarchive)."""
    raw_archive_path = params.get("archive_path")
    items = params.get("items") or []
    destination_raw = params.get("destination")
    options = params.get("options") or {}

    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        raise ValueError("archive_path is required")
    if destination_raw and not isinstance(destination_raw, str):
        raise ValueError("destination must be a string")
    if items and not isinstance(items, list):
        raise ValueError("items must be a list")

    archive_path = _resolve_user_path(raw_archive_path, must_exist=True)
    destination = _resolve_user_path(destination_raw or str(archive_path.parent), must_exist=False)
    destination.mkdir(parents=True, exist_ok=True)

    total_bytes = max(archive_path.stat().st_size, 1)
    filtered_items = [s.strip().lstrip('/') for s in items] if items else None
    last_percent = -1

    def handle_progress(bytes_read: int, total: int, files_done: int, files_total: int) -> None:
        nonlocal last_percent
        ctx.check_cancelled()
        pct = int((bytes_read * 100) / max(total, 1))
        if pct != last_percent:
            last_percent = pct
            ctx.set_progress(completed=bytes_read or files_done, total=total or files_total or 1, detail=f"{pct}%")
            ctx.set_message(f"Extracting {archive_path.name}: {pct}%")

    ctx.set_progress(completed=0, total=total_bytes, detail="0%")
    ctx.set_message(f"Extracting {archive_path.name}…")

    extract_streaming_with_progress(
        archive_path=archive_path,
        dest_dir=destination,
        include=filtered_items,
        on_progress=handle_progress,
    )

    ctx.set_progress(completed=total_bytes, total=total_bytes, detail="100%")
    ctx.finish(
        message=f"Extracted to {destination}",
        result={
            "archive_path": str(archive_path),
            "destination": str(destination),
            "stdout": '',
            "stderr": '',
        },
    )
