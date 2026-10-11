"""File Explorer's ordinary Python raw-log reader, not a native fallback."""
from __future__ import annotations

import os
from contextlib import contextmanager
from collections.abc import Generator
from pathlib import Path
from typing import BinaryIO
from app.libs.terminal_runtime.log_reader import LogReader


class FileLogReader:
    def __init__(self, path: Path) -> None:
        self.stream: BinaryIO = path.open('rb')
        stat = os.fstat(self.stream.fileno())
        self.identity: tuple[int, int] = (stat.st_dev, stat.st_ino)
        self.size: int = stat.st_size

    def seek(self, offset: int) -> None:
        _ = self.stream.seek(offset)

    def read(self, limit: int) -> bytes:
        if not 0 < limit <= 65536:
            raise ValueError('Invalid terminal log read bound')
        return self.stream.read(min(limit, max(0, self.size - self.stream.tell())))

    def close(self) -> None:
        self.stream.close()


@contextmanager
def open_log(path: Path) -> Generator[LogReader | None, None, None]:
    try:
        reader = FileLogReader(path)
    except FileNotFoundError:
        yield None
        return
    try:
        yield reader
    finally:
        reader.close()
