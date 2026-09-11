# pyright: strict
"""Exact-connection History ownership; event handlers schedule, never read Git."""
from __future__ import annotations

import asyncio
import logging
from collections import deque
from collections.abc import Callable
from contextlib import AsyncExitStack
from dataclasses import asdict
from pathlib import Path
from typing import cast

from ...worker_services import event_bus
from ...worker_services.history_service import HistorySession, history_session, HistoryCommit
from ..context import EmitPersonal
from .history_statistics import HistoryStatistics, HistoryStatisticsUpdate

logger = logging.getLogger(__name__)


class ExplorerHistory:
    def __init__(self, root: Callable[[], Path], emit: EmitPersonal) -> None:
        self._root: Callable[[], Path] = root
        self._emit: EmitPersonal = emit
        self._revision: int = 0
        self._task: asyncio.Task[None] | None = None
        self._ready: asyncio.Future[HistorySession] | None = None
        self._session: HistorySession | None = None
        self._statistics: HistoryStatistics | None = None
        self._retained: deque[HistoryCommit] = deque(maxlen=500)
        self._project: Path | None = None
        self._project_generation: int | None = None
        self._closed: bool = False
        self._commands: asyncio.Lock = asyncio.Lock()
        self._ref_refresh: asyncio.Handle | None = None
        event_bus.subscribe("ProjectSwitchStarted", self.on_fact)

    @property
    def revision(self) -> int:
        return self._revision

    def _observe(self, task: asyncio.Task[None]) -> None:
        if not task.cancelled():
            error = task.exception()
            if error is not None:
                logger.error("History projection task failed: %s", error)

    def open(self) -> dict[str, object]:
        if self._closed:
            raise ValueError("History connection is closed")
        self._cancel_ref_refresh()
        previous = self._task
        self._revision += 1
        revision = self._revision
        if previous is not None:
            _ = previous.cancel()
        self._project = self._root()
        self._project_generation = event_bus.current_project_generation(self._project)
        self._retained.clear()
        self._ready = asyncio.get_running_loop().create_future()
        self._task = asyncio.create_task(self._run(revision, self._project, previous, self._ready))
        self._task.add_done_callback(self._observe)
        return {"generation": revision, "status": "opening"}

    def invalidate_project(self) -> None:
        self._cancel_ref_refresh()
        self._revision += 1
        self._project = None
        if self._task is not None:
            _ = self._task.cancel()

    async def close(self) -> None:
        self.invalidate_project()
        revision = self._revision
        task = self._task
        if task is not None:
            try:
                await task
            except asyncio.CancelledError:
                pass
        if revision == self._revision:
            self._task = None
            self._ready = None
            self._session = None
            self._statistics = None
            self._retained.clear()

    async def dispose(self) -> None:
        self._closed = True
        event_bus.unsubscribe("ProjectSwitchStarted", self.on_fact)
        await self.close()

    async def on_fact(self, event: event_bus.WorkerEvent) -> None:
        if self._closed or self._project is None:
            return
        if event["type"] == "ProjectSwitchStarted":
            self.invalidate_project()
            return

    def _cancel_ref_refresh(self) -> None:
        if self._ref_refresh is not None:
            self._ref_refresh.cancel()
            self._ref_refresh = None

    def _refresh_refs(self, revision: int) -> None:
        self._ref_refresh = None
        # Coalesce one event-loop delivery batch without timers or Git reads in
        # the fact handler. A project switch/close cancels this scheduled intent.
        if revision == self._revision and self._project == self._root() and not self._closed:
            _ = self.open()

    async def _notify(self, revision: int, kind: str, payload: dict[str, object]) -> None:
        if revision == self._revision and self._project == self._root() and not self._closed:
            await self._emit("explorer.history.updated", {"generation": revision, "kind": kind, **payload})

    async def _run(self, revision: int, project: Path, previous: asyncio.Task[None] | None,
                   ready: asyncio.Future[HistorySession]) -> None:
        stats: HistoryStatistics | None = None
        try:
            if previous is not None:
                try:
                    await previous
                except asyncio.CancelledError:
                    pass
            if revision != self._revision:
                return
            async with AsyncExitStack() as stack:
                session = await stack.enter_async_context(history_session(project, self._project_generation or 0))
                if revision != self._revision:
                    return
                self._session = session
                snapshot = session.snapshot
                assert snapshot is not None
                async def publish(update: HistoryStatisticsUpdate) -> None:
                    # These are typed dataclasses, not unchecked transport objects.
                    await self._notify(revision, "statistics", {"statistics": cast(dict[str, object], asdict(update))})
                stats = HistoryStatistics(revision, session.files, publish)
                # LIFO: stop the producer before closing its native session.
                _ = stack.push_async_callback(stats.dispose)
                self._statistics = stats
                await self._notify(revision, "snapshot", {"snapshot": cast(dict[str, object], asdict(snapshot))})
                _ = await self._page(revision, session)
                if not ready.done():
                    ready.set_result(session)
                error = await session.wait_changed()
                if error is not None:
                    await self._notify(revision, "watcherError", {"error": error})
                    _ = await asyncio.Event().wait()
            # Close the old producer/watcher before scheduling replacement.
            if revision == self._revision:
                self._ref_refresh = asyncio.get_running_loop().call_soon(self._refresh_refs, revision)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            await self._notify(revision, "error", {"error": str(error)[:512]})
        finally:
            if not ready.done():
                _ = ready.cancel()
            if revision == self._revision:
                self._session = None
                self._statistics = None

    async def _get(self, revision: int) -> HistorySession:
        ready = self._ready
        if ready is None or revision != self._revision:
            raise ValueError("Stale History generation")
        try:
            session = await asyncio.shield(ready)
        except asyncio.CancelledError:
            if ready.cancelled():
                raise ValueError("History session initialization was superseded") from None
            raise
        if revision != self._revision or session.closed:
            raise ValueError("History session is no longer active")
        return session

    async def _page(self, revision: int, session: HistorySession) -> dict[str, object]:
        if revision != self._revision:
            raise ValueError("Stale History page request")
        page = await session.next_page()
        if revision != self._revision:
            raise ValueError("Stale History page")
        payload = cast(dict[str, object], asdict(page))
        await self._notify(revision, "page", {"page": payload})
        if revision != self._revision:
            raise ValueError("History page superseded during publication")
        self._retained.extend(page.commits)
        if self._statistics is not None:
            self._statistics.retain(tuple(self._retained))
        return {"generation": revision, "offset": page.offset, "complete": page.complete}

    async def more(self, revision: int) -> dict[str, object]:
        async with self._commands:
            return await self._page(revision, await self._get(revision))

    async def files(self, revision: int, commit: str, offset: int) -> dict[str, object]:
        async with self._commands:
            session = await self._get(revision)
            page = await session.files(commit, offset)
            if revision != self._revision:
                raise ValueError("Stale History files")
            return {"generation": revision, "page": cast(dict[str, object], asdict(page))}

    async def prepare_open(self, revision: int, commit: str, index: int, owner: str) -> str:
        from ...host.history_handoff import handoffs
        from ...host.secondary_content_state import HistoricalContent

        async with self._commands:
            session = await self._get(revision)
            if not any(row.identity == commit for row in self._retained):
                raise ValueError("History commit is no longer retained")
            # Resolve the native row, not client-supplied blob IDs or disk paths.
            page = await session.files(commit, index, 1)
            if not page.files:
                raise ValueError("History file is no longer available")
            pair = await session.blob_pair(commit, page.files[0])
            snapshot = session.snapshot
            if revision != self._revision or session.closed or snapshot is None:
                raise ValueError("History selection was superseded")
            project = self._project
            generation = self._project_generation
            if project is None or generation is None:
                raise ValueError("History project is unavailable")
            return handoffs.issue(owner, str(project), generation,
                HistoricalContent(snapshot.identity, pair),
                lambda: revision == self._revision and not self._closed and not session.closed)
