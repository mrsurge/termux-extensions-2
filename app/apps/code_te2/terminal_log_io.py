"""Raw-log descriptor seam; Pyte and projection policy remain Python-owned."""
from __future__ import annotations

from contextlib import contextmanager
from collections.abc import Generator
from pathlib import Path
from typing import BinaryIO, Protocol


class LogReader(Protocol):
    @property
    def identity(self) -> tuple[int, int]: ...
    @property
    def size(self) -> int: ...
    def seek(self, offset: int) -> None: ...
    def read(self, limit: int) -> bytes: ...
    def close(self) -> None: ...


class NativeTerminalLog(Protocol):
    def terminal_log_open(self, path: Path) -> LogReader | None: ...


_native: NativeTerminalLog | None = None


def configure_native(bridge: NativeTerminalLog) -> None:
    global _native
    if _native is not None:
        raise RuntimeError("native terminal logs already configured")
    _native = bridge


class _ReferenceReader:
    def __init__(self, path: Path) -> None:
        import os
        self.file: BinaryIO = path.open("rb")
        stat = os.fstat(self.file.fileno())
        self.identity: tuple[int, int] = (stat.st_dev, stat.st_ino)
        self.size: int = stat.st_size

    def seek(self, offset: int) -> None:
        _ = self.file.seek(offset)

    def read(self, limit: int) -> bytes:
        if not 0 < limit <= 65536:
            raise ValueError("invalid terminal log read bound")
        return self.file.read(min(limit, max(0, self.size - self.file.tell())))

    def close(self) -> None:
        self.file.close()


@contextmanager
def open_log(path: Path) -> Generator[LogReader | None, None, None]:
    if _native is not None:
        reader = _native.terminal_log_open(path)
    else:
        # Isolated interpreted tests/tools only; never retry a native failure.
        try:
            reader = _ReferenceReader(path)
        except FileNotFoundError:
            reader = None
    try:
        yield reader
    finally:
        if reader is not None:
            reader.close()
