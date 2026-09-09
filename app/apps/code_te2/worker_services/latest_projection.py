"""Bounded, loop-owned scheduling for replaceable read-only projections."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

Current = Callable[[], bool]
Projection = Callable[[Current], Awaitable[None]]
logger = logging.getLogger(__name__)


class LatestProjection:
    """One running operation plus the newest pending operation; never cancel threads."""

    def __init__(self, name: str) -> None:
        self.name: str = name
        self._revision: int = 0
        self._pending: tuple[int, Projection] | None = None
        self._task: asyncio.Task[None] | None = None

    def submit(self, operation: Projection) -> None:
        self._revision += 1
        self._pending = (self._revision, operation)
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._drain(), name=self.name)

    async def wait_idle(self) -> None:
        while self._task is not None:
            await asyncio.shield(self._task)

    async def _drain(self) -> None:
        try:
            while self._pending is not None:
                revision, operation = self._pending
                self._pending = None
                try:
                    await operation(lambda: revision == self._revision)
                except Exception:
                    logger.exception('Projection failed: %s', self.name)
        finally:
            self._task = None
