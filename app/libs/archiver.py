from __future__ import annotations

import errno
import os
import stat
import tempfile
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional

from libarchive import file_reader  # type: ignore[import-untyped]


def list_archive_entries(archive_path: Path) -> list[dict[str, object]]:
    """List entries in an archive using libarchive."""
    entries = []
    with file_reader(str(archive_path)) as archive:
        for entry in archive:
            entries.append({
                "pathname": entry.pathname,
                "size": entry.size,
                "mtime": entry.mtime,
                "mode": entry.mode,
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
    safe = name.replace("\\", "/")
    if safe.startswith('/') or '..' in safe.split('/') or ':' in safe.split('/')[0]:
        raise ValueError(f"Unsafe archive path: {name}")
    out = (dest_dir / safe).resolve()
    if out == dest_dir.resolve() or not out.is_relative_to(dest_dir.resolve()):
        raise ValueError(f"Refusing to write outside destination: {name}")
    return out


def extract_streaming_with_progress(
    archive_path: Path,
    dest_dir: Path,
    *,
    include: Optional[Iterable[str]] = None,
    on_progress: Optional[Callable[[int, int, int, int], None]] = None,
    overwrite: str = 'rename',
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
            _safe_join(dest_dir, name)
            if not (entry.isdir or entry.isreg) or entry.issym or entry.islnk:
                raise ValueError(f'Archive links/special files are unsupported: {name}')
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
            if entry.isdir:
                output_path.mkdir(parents=True, exist_ok=True)
                if on_progress:
                    on_progress(bytes_done, total_bytes, files_done, files_total)
                continue

            _ensure_parent(output_path)
            if output_path.exists():
                if overwrite == 'skip':
                    continue
                if overwrite == 'error':
                    raise FileExistsError(output_path)
                if overwrite == 'rename':
                    stem, suffix, number = output_path.stem, output_path.suffix, 1
                    while output_path.exists():
                        output_path = output_path.with_name(f'{stem} ({number}){suffix}')
                        number += 1
            fd, temporary = tempfile.mkstemp(prefix='.te2-extract-', dir=output_path.parent)
            try:
                with os.fdopen(fd, 'wb') as handle:
                    for block in entry.get_blocks():
                        handle.write(block)
                        bytes_done += len(block)
                        if on_progress:
                            on_progress(bytes_done, total_bytes, files_done, files_total)
                if overwrite == 'replace':
                    os.replace(temporary, output_path)
                else:
                    os.link(temporary, output_path)
                os.chmod(output_path, entry.perm & 0o777)
            finally:
                Path(temporary).unlink(missing_ok=True)

            files_done += 1
            if on_progress:
                on_progress(bytes_done, total_bytes, files_done, files_total)
