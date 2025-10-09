import stat
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.libs.jobs import register_job_handler
from app.libs.archiver import extract_streaming_with_progress, list_archive_entries
from app.utils.paths import _resolve_user_path

def browse_archive(archive_path: Path, internal_path: str, show_hidden: bool) -> List[Dict[str, Any]]:
    """Browse entries within an archive at a specific internal path."""
    records = list_archive_entries(archive_path)
    internal_path = internal_path.strip('/')
    internal_parts = [p for p in internal_path.split('/') if p]
    children: Dict[str, Dict[str, Any]] = {}

    for record in records:
        entry_path = record.get("pathname", "").strip()
        if not entry_path:
            continue

        normalized = entry_path.replace('\\', '/').strip('/')
        parts = [p for p in normalized.split('/') if p]

        if internal_parts:
            if len(parts) <= len(internal_parts) or parts[:len(internal_parts)] != internal_parts:
                continue
            relative_parts = parts[len(internal_parts):]
        else:
            relative_parts = parts

        if not relative_parts:
            continue

        top_segment = relative_parts[0]
        if not show_hidden and top_segment.startswith('.'):
            continue

        is_directory = stat.S_ISDIR(record.get('mode', 0)) or len(relative_parts) > 1
        relative_internal = '/'.join((*internal_parts, top_segment))

        child = children.get(top_segment)
        if child is None:
            child = {
                "id": f"{archive_path}::{relative_internal}",
                "name": top_segment,
                "type": "directory" if is_directory else "file",
                "path": str(archive_path),
                "internal": relative_internal,
                "size": None,
                "modified": None,
            }
            children[top_segment] = child

        if is_directory and child["type"] != "directory":
            child["type"] = "directory"
            child["size"] = None

        if child["type"] == "file":
            child["size"] = record.get("size")
            child["modified"] = record.get("mtime")

    results = list(children.values())
    results.sort(key=lambda item: (item["type"] != "directory", item["name"].lower()))
    return results


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
