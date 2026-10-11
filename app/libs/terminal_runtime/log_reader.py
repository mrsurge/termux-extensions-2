"""Injected raw-log boundary; applications retain descriptor and shell ownership."""
from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Protocol, TypeAlias


class LogReader(Protocol):
    @property
    def identity(self) -> tuple[int, int]: ...
    @property
    def size(self) -> int: ...
    def seek(self, offset: int) -> None: ...
    def read(self, limit: int) -> bytes: ...
    def close(self) -> None: ...


LogOpener: TypeAlias = Callable[[Path], AbstractContextManager[LogReader | None]]
