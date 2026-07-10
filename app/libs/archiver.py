from __future__ import annotations

import errno
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional

from libarchive import file_reader


def list_archive_entries(archive_path: Path) -> List[Dict]:
    """List entries in an archive using libarchive."""
    entries = []
    with file_reader(str(archive_path)) as archive:
        for entry in archive:
            entries.append({
                "pathname": entry.pathname,
                "size": entry.size,
                "mtime": entry.mtime,
                "mode": entry.perm,
            })
    return entries


def _ensure_parent(path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:  # pragma: no cover - defensive
        if exc.errno != errno.EEXIST:
            raise


def _safe_join(dest_dir: Path, name: str) -> Path:
    """Resolve archive entry under dest_dir and refuse path escapes."""
    safe = name.lstrip("/").replace("\\", "/")
    out = (dest_dir / safe).resolve()
    if not str(out).startswith(str(dest_dir.resolve())):
        raise ValueError(f"Refusing to write outside destination: {name}")
    return out


def extract_streaming_with_progress(
    archive_path: Path,
    dest_dir: Path,
    *,
    include: Optional[Iterable[str]] = None,
    on_progress: Optional[Callable[[int, int, int, int], None]] = None,
) -> None:
    """Stream-extract with byte-level progress (libarchive)."""
    archive_path = Path(archive_path)
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    allow = {item.strip().lstrip('/') for item in include} if include else None

    def should_include(name: str) -> bool:
        if allow is None:
            return True
        normalized = name.strip()
        if normalized in allow:
            return True
        return any(normalized.startswith(prefix.rstrip('/') + '/') for prefix in allow)

    total_bytes = 0
    files_total = 0

    with file_reader(str(archive_path)) as archive:
        for entry in archive:
            name = entry.pathname
            if not should_include(name):
                continue
            size = getattr(entry, 'size', 0) or 0
            if size > 0:
                total_bytes += size
            if not name.endswith('/'):
                files_total += 1

    bytes_done = 0
    files_done = 0

    if on_progress:
        on_progress(bytes_done, total_bytes, files_done, files_total)

    with file_reader(str(archive_path)) as archive:
        for entry in archive:
            name = entry.pathname
            include_entry = should_include(name)

            if not include_entry:
                for _ in entry.get_blocks():
                    pass
                continue

            output_path = _safe_join(dest_dir, name)
            if name.endswith('/'):
                output_path.mkdir(parents=True, exist_ok=True)
                if on_progress:
                    on_progress(bytes_done, total_bytes, files_done, files_total)
                continue

            _ensure_parent(output_path)
            with open(output_path, 'wb') as handle:
                for block in entry.get_blocks():
                    handle.write(block)
                    bytes_done += len(block)
                    if on_progress:
                        on_progress(bytes_done, total_bytes, files_done, files_total)

            files_done += 1
            if on_progress:
                on_progress(bytes_done, total_bytes, files_done, files_total)
