"""Pyte checkpoints bounded at the pipe shell's acknowledged byte offset."""
from contextlib import contextmanager
from collections.abc import Generator
from pathlib import Path

from app.libs.terminal_runtime.log_reader import LogReader
from app.libs.terminal_runtime.screen_projection import TerminalScreenProjectionRegistry, TerminalScreenCheckpoint
from .terminal_log_io import FileLogReader


class CheckpointProjection:
    def __init__(self) -> None:
        self.limit: int = 0
        self.registry: TerminalScreenProjectionRegistry = TerminalScreenProjectionRegistry(log_opener=self.open_log)

    @contextmanager
    def open_log(self, path: Path) -> Generator[LogReader | None, None, None]:
        reader = FileLogReader(path, self.limit)
        try:
            yield reader
        finally:
            reader.close()

    async def checkpoint(self, shell_id: str, path: Path, offset: int, cols: int, rows: int) -> TerminalScreenCheckpoint:
        # Caller serializes tab operations, including raw stream attachment.
        self.limit = offset
        result = await self.registry.checkpoint(shell_id, path, columns=cols, lines=rows)
        if result.output_offset != offset:
            raise RuntimeError('Terminal checkpoint log is incomplete')
        return result
