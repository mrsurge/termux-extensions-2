import stat
from pathlib import Path
from typing import Any, Dict, List, Optional
from typing import cast
import msgspec
from starlette.exceptions import HTTPException

from app.libs.jobs import JobContext, register_job_handler
from app.libs.archiver import extract_streaming_with_progress, list_archive_entries
from app.utils.paths import _resolve_user_path

def browse_archive(archive_path: Path, internal_path: str, show_hidden: bool) -> List[Dict[str, Any]]:
    """Browse entries within an archive at a specific internal path."""
    records = list_archive_entries(archive_path)
    internal_path = internal_path.strip('/')
    internal_parts = [p for p in internal_path.split('/') if p]
    children: Dict[str, Dict[str, Any]] = {}

    for record in records:
        raw_path = record.get('pathname')
        entry_path = raw_path.strip() if isinstance(raw_path, str) else ''
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

        mode = record.get('mode')
        is_directory = (isinstance(mode, int) and stat.S_ISDIR(mode)) or len(relative_parts) > 1
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


class ExtractRequest(msgspec.Struct, forbid_unknown_fields=True):
    archive_path: str
    destination: str | None = None
    items: list[str] = msgspec.field(default_factory=list)
    options: dict[str, object] = msgspec.field(default_factory=dict)


def extraction_params(payload: dict[str, object]) -> dict[str, object]:
    try:
        request = msgspec.convert(payload, type=ExtractRequest, strict=True)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    from app.libs.archive_operations import archive_path
    archive = archive_path(request.archive_path, must_exist=True)
    destination = archive_path(request.destination or str(archive.parent), must_exist=False)
    if not archive.is_file():
        raise HTTPException(422, 'Select an archive file')
    if any(not name or name.startswith(('/', '\\')) or '..' in name.replace('\\', '/').split('/') for name in request.items):
        raise HTTPException(422, 'Unsafe archive selection')
    options = request.options
    if any(key not in {'overwrite', 'password'} for key in options) or options.get('password') not in (None, ''):
        raise HTTPException(422, 'Unsupported extraction option or encrypted archive')
    policy = options.get('overwrite', 'rename')
    if policy is True:
        policy = 'replace'
    elif policy is False:
        policy = 'error'
    if policy not in ('rename', 'skip', 'replace', 'error'):
        raise HTTPException(422, 'Invalid overwrite policy')
    return {'archive_path': str(archive), 'destination': str(destination), 'items': request.items,
        'options': {'overwrite': policy}}


@register_job_handler("extract_archive")
def job_extract_archive(ctx: JobContext, params: dict[str, object]) -> None:
    """Background job handler for archive extraction (libarchive)."""
    params = extraction_params(params)
    raw_archive_path = cast(str, params['archive_path'])
    items = cast(list[str], params['items'])
    destination_raw = cast(str, params['destination'])
    options = cast(dict[str, object], params['options'])

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
        overwrite=cast(str, options['overwrite']),
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
