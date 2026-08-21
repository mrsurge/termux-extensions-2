from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

from app.te2_paths import te2_cache_home


TE2_CONSOLE_LOG_DIR = te2_cache_home() / "console"
TE2_CONSOLE_LOG_PATH = TE2_CONSOLE_LOG_DIR / "te2_console_log.jsonl"

_REVERSE_READ_CHUNK_BYTES = 64 * 1024
# Socket.IO rejects a console payload above 8 MiB. Keep reverse traversal under
# the same per-record ceiling so a corrupt/manual transcript line cannot force
# an unbounded allocation merely because somebody requested a tail.
_MAX_LOG_LINE_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class ConsoleLogTail:
    lines: tuple[bytes, ...]
    bytes_selected: int
    truncated: bool


def iter_console_log_lines_reverse(
    path: Path,
    *,
    max_line_bytes: int = _MAX_LOG_LINE_BYTES,
) -> Iterator[bytes]:
    """Yield complete non-empty JSONL records newest-first with bounded memory."""

    if max_line_bytes <= 0:
        raise ValueError("max_line_bytes must be positive")
    try:
        file_handle = path.open("rb")
    except FileNotFoundError:
        return

    with file_handle:
        file_handle.seek(0, 2)
        position = file_handle.tell()
        suffix = b""
        suffix_too_large = False

        while position > 0:
            read_size = min(_REVERSE_READ_CHUNK_BYTES, position)
            position -= read_size
            file_handle.seek(position)
            chunk = file_handle.read(read_size)
            parts = chunk.split(b"\n")

            if len(parts) == 1:
                if not suffix_too_large:
                    combined_size = len(parts[0]) + len(suffix)
                    if combined_size <= max_line_bytes:
                        suffix = parts[0] + suffix
                    else:
                        suffix = b""
                        suffix_too_large = True
                continue

            newest = parts[-1]
            if not suffix_too_large and len(newest) + len(suffix) <= max_line_bytes:
                record = newest + suffix
                if record.strip():
                    yield record

            for record in reversed(parts[1:-1]):
                if record.strip() and len(record) <= max_line_bytes:
                    yield record

            suffix = parts[0]
            suffix_too_large = len(suffix) > max_line_bytes
            if suffix_too_large:
                suffix = b""

        if not suffix_too_large and suffix.strip():
            yield suffix


def read_console_log_tail(
    path: Path,
    *,
    max_lines: int,
    max_bytes: int,
    predicate: Callable[[bytes], bool] | None = None,
) -> ConsoleLogTail:
    """Read the newest matching records without materializing the transcript."""

    if max_lines < 0:
        raise ValueError("max_lines cannot be negative")
    if max_bytes <= 0:
        raise ValueError("max_bytes must be positive")
    if max_lines == 0:
        return ConsoleLogTail((), 0, False)

    selected_newest_first: list[bytes] = []
    selected_bytes = 0
    truncated = False
    for record in iter_console_log_lines_reverse(path):
        if predicate is not None and not predicate(record):
            continue
        record_bytes = len(record)
        if record_bytes > max_bytes:
            continue
        if len(selected_newest_first) >= max_lines:
            truncated = True
            break
        if selected_newest_first and selected_bytes + record_bytes > max_bytes:
            truncated = True
            break
        selected_newest_first.append(record)
        selected_bytes += record_bytes

    selected_newest_first.reverse()
    return ConsoleLogTail(tuple(selected_newest_first), selected_bytes, truncated)
