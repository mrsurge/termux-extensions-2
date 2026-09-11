# pyright: strict
"""Bounded, generation-local orchestration of native History file statistics."""
from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from ...worker_services.history_service import HistoryCommit, HistoryFilesPage

MAX_PENDING_COMMITS = 500
FILE_PAGE_SIZE = 40
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class HistoryStatisticsUpdate:
    generation: int
    commit_id: str
    state: Literal["computing", "ready", "incomplete", "error"]
    processed_files: int
    total_files: int | None
    known_additions: int
    known_deletions: int
    unknown_files: int
    error: str | None = None


ReadFiles = Callable[[str, int, int], Awaitable[HistoryFilesPage]]
Publish = Callable[[HistoryStatisticsUpdate], Awaitable[None]]


class HistoryStatistics:
    """One producer, one page in flight, no timers or cross-generation cache.

    Queue only graph rows already published. The caller owns the native session
    and must close it after disposing this producer on disconnect/project change.
    """

    def __init__(self, generation: int, read_files: ReadFiles, publish: Publish) -> None:
        self.generation: int = generation
        self._read: ReadFiles = read_files
        self._publish: Publish = publish
        self._pending: OrderedDict[str, HistoryCommit] = OrderedDict()
        self._retained: set[str] = set()
        self._completed: set[str] = set()
        self._active: str | None = None
        self._task: asyncio.Task[None] | None = None
        self._closed: bool = False

    def retain(self, commits: Sequence[HistoryCommit]) -> None:
        """Reconcile the bounded rendered working set, not every reachable commit."""
        if self._closed:
            raise RuntimeError("History statistics producer is closed")
        if len(commits) > MAX_PENDING_COMMITS:
            raise ValueError("History statistics supports at most 500 retained commits")
        retained = {commit.identity for commit in commits}
        self._retained = retained
        self._completed.intersection_update(retained)
        self._pending = OrderedDict((key, value) for key, value in self._pending.items() if key in retained)
        for commit in commits:
            if commit.identity not in self._completed and commit.identity != self._active:
                self._pending[commit.identity] = commit
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())
            self._task.add_done_callback(self._observe)

    def _observe(self, task: asyncio.Task[None]) -> None:
        if not task.cancelled():
            error = task.exception()
            if error is not None:
                logger.error("History statistics publication failed: %s", error)

    async def dispose(self) -> None:
        self._closed = True
        self._retained.clear()
        self._pending.clear()
        self._completed.clear()
        task = self._task
        if task is not None:
            _ = task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def settled(self) -> None:
        task = self._task
        if task is not None:
            await asyncio.shield(task)

    async def _emit(self, update: HistoryStatisticsUpdate) -> bool:
        if self._closed or update.commit_id not in self._retained:
            return False
        await self._publish(update)
        return not self._closed and update.commit_id in self._retained

    async def _run(self) -> None:
        # Do not begin a native read within the caller's graph-publication turn.
        await asyncio.sleep(0)
        while self._pending and not self._closed:
            _, commit = self._pending.popitem(last=False)
            self._active = commit.identity
            try:
                await self._compute(commit)
            finally:
                self._active = None

    async def _compute(self, commit: HistoryCommit) -> None:
        offset = additions = deletions = unknown = 0
        total: int | None = None
        expected_parent = commit.parents[0] if commit.parents else None
        while not self._closed and commit.identity in self._retained:
            try:
                page = await self._read(commit.identity, offset, FILE_PAGE_SIZE)
                if self._closed or commit.identity not in self._retained:
                    return
                if (page.commit_id != commit.identity or page.parent_id != expected_parent
                        or page.offset != offset or (total is not None and page.total_files != total)):
                    raise ValueError("History statistics page identity changed")
                total = page.total_files
                for file in page.files:
                    counts = file.counts
                    if counts.state == "ready" and counts.additions is not None and counts.deletions is not None:
                        additions += counts.additions
                        deletions += counts.deletions
                    else:
                        unknown += 1
                offset += len(page.files)
                if page.next_offset is not None and (page.next_offset != offset or not page.files):
                    raise ValueError("History statistics continuation did not advance")
            except asyncio.CancelledError:
                raise
            except Exception as error:
                if self._closed or commit.identity not in self._retained:
                    return
                self._completed.add(commit.identity)
                _ = await self._emit(HistoryStatisticsUpdate(
                    self.generation, commit.identity, "error", offset, total,
                    additions, deletions, unknown, str(error)[:512],
                ))
                return
            complete = page.next_offset is None
            state: Literal["computing", "ready", "incomplete"] = (
                "incomplete" if unknown else "ready"
            ) if complete else "computing"
            if not await self._emit(HistoryStatisticsUpdate(
                self.generation, commit.identity, state, offset, total,
                additions, deletions, unknown,
            )):
                return
            if complete:
                self._completed.add(commit.identity)
                return
            # Native per-file work stays in Rust. Releasing the session lock and
            # yielding here lets queued metadata/file intents run before this
            # producer asks for another bounded page.
            await asyncio.sleep(0)
