# pyright: strict
from __future__ import annotations

import asyncio
import unittest
from typing import final

from app.apps.code_te2.explorer.services.history_statistics import (
    HistoryStatistics, HistoryStatisticsUpdate,
)
from app.apps.code_te2.worker_services.history_service import (
    HistoryCommit, HistoryCounts, HistoryFile, HistoryFilesPage,
)


def commit(identity: str = "a" * 40) -> HistoryCommit:
    return HistoryCommit(identity, (), "root", "Test", 1)


def page(identity: str, offset: int = 0, next_offset: int | None = None,
         unknown: bool = False, total: int = 1) -> HistoryFilesPage:
    counts = HistoryCounts("binary", None, None) if unknown else HistoryCounts("ready", 3, 2)
    file = HistoryFile(offset, "added", None, "test", None, "b" * 40, counts)
    return HistoryFilesPage(identity, None, offset, (file,), next_offset, total)


@final
class HistoryStatisticsTests(unittest.IsolatedAsyncioTestCase):
    async def test_progress_publishes_before_following_page_finishes(self) -> None:
        updates: list[HistoryStatisticsUpdate] = []
        second = asyncio.Event()
        release = asyncio.Event()
        async def read(identity: str, offset: int, limit: int) -> HistoryFilesPage:
            self.assertEqual(limit, 40)
            if offset == 0:
                return page(identity, 0, 1, total=2)
            second.set()
            _ = await release.wait()
            return page(identity, 1, total=2)
        async def publish(update: HistoryStatisticsUpdate) -> None:
            updates.append(update)
        producer = HistoryStatistics(7, read, publish)
        producer.retain([commit()])
        _ = await second.wait()
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0].state, "computing")
        self.assertEqual(updates[0].known_additions, 3)
        release.set()
        await producer.settled()
        self.assertEqual(updates[-1].state, "ready")
        self.assertEqual(updates[-1].known_additions, 6)
        self.assertEqual(updates[-1].generation, 7)
        producer.retain([commit()])
        await producer.settled()
        self.assertEqual(len(updates), 2)
        await producer.dispose()

    async def test_unretained_late_read_cannot_publish(self) -> None:
        started = asyncio.Event()
        release = asyncio.Event()
        updates: list[HistoryStatisticsUpdate] = []
        async def read(identity: str, _offset: int, _limit: int) -> HistoryFilesPage:
            started.set()
            _ = await release.wait()
            return page(identity)
        async def publish(update: HistoryStatisticsUpdate) -> None:
            updates.append(update)
        producer = HistoryStatistics(7, read, publish)
        producer.retain([commit()])
        _ = await started.wait()
        producer.retain([])
        release.set()
        await producer.settled()
        self.assertEqual(updates, [])
        await producer.dispose()

    async def test_dispose_fences_a_reader_that_finishes_after_cancellation(self) -> None:
        started = asyncio.Event()
        updates: list[HistoryStatisticsUpdate] = []
        async def read(identity: str, _offset: int, _limit: int) -> HistoryFilesPage:
            started.set()
            try:
                _ = await asyncio.Event().wait()
            except asyncio.CancelledError:
                return page(identity)
            raise AssertionError("unreachable")
        async def publish(update: HistoryStatisticsUpdate) -> None:
            updates.append(update)
        producer = HistoryStatistics(7, read, publish)
        producer.retain([commit()])
        _ = await started.wait()
        await producer.dispose()
        self.assertEqual(updates, [])

    async def test_unknown_counts_and_errors_do_not_become_clean_commits(self) -> None:
        updates: list[HistoryStatisticsUpdate] = []
        async def read(identity: str, _offset: int, _limit: int) -> HistoryFilesPage:
            if identity == "a" * 40:
                raise ValueError("native read failed")
            return page(identity, unknown=True)
        async def publish(update: HistoryStatisticsUpdate) -> None:
            updates.append(update)
        producer = HistoryStatistics(7, read, publish)
        producer.retain([commit(), commit("c" * 40)])
        await producer.settled()
        self.assertEqual([u.state for u in updates], ["error", "incomplete"])
        self.assertEqual(updates[1].unknown_files, 1)
        await producer.dispose()

    async def test_queue_bound_and_wrong_parent(self) -> None:
        updates: list[HistoryStatisticsUpdate] = []
        async def read(identity: str, _offset: int, _limit: int) -> HistoryFilesPage:
            return HistoryFilesPage(identity, "d" * 40, 0, (), None, 0)
        async def publish(update: HistoryStatisticsUpdate) -> None:
            updates.append(update)
        producer = HistoryStatistics(7, read, publish)
        with self.assertRaises(ValueError):
            producer.retain([commit()] * 501)
        producer.retain([commit()])
        await producer.settled()
        self.assertEqual(updates[0].state, "error")
        await producer.dispose()
