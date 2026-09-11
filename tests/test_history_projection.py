# pyright: strict
from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
from typing import final
from unittest.mock import patch

from app.libs import pipe_runtime
from app.apps.code_te2.explorer.services.history_projection import ExplorerHistory
from app.apps.code_te2.worker_services import event_bus
from tests.test_history_service import response


@final
class HistoryProjectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_graph_precedes_stats_and_dispose_closes_native_session(self) -> None:
        calls: list[str] = []
        notices: list[dict[str, object]] = []
        stats = asyncio.Event()
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            calls.append(method)
            return response(method, params)
        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del reply_to
            self.assertEqual(method, "explorer.history.updated")
            notices.append(payload)
            if payload["kind"] == "statistics":
                stats.set()
        with patch.object(pipe_runtime, "call_async", fake):
            controller = ExplorerHistory(lambda: Path("/project"), emit)
            ack = controller.open()
            self.assertEqual(ack["status"], "opening")
            _ = await asyncio.wait_for(stats.wait(), 2)
            self.assertEqual([n["kind"] for n in notices[:3]], ["snapshot", "page", "statistics"])
            await controller.dispose()
        self.assertEqual(calls[-1], "git.historyGraph.close")
        with self.assertRaises(ValueError):
            _ = controller.open()

    async def test_superseded_open_cannot_publish_old_generation(self) -> None:
        started = asyncio.Event()
        release = asyncio.Event()
        delivered = asyncio.Event()
        notices: list[dict[str, object]] = []
        opens = 0
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            nonlocal opens
            if method.endswith("open"):
                opens += 1
                if opens == 1:
                    started.set()
                    _ = await release.wait()
            return response(method, params)
        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del method, reply_to
            notices.append(payload)
            if payload["kind"] == "page":
                delivered.set()
        with patch.object(pipe_runtime, "call_async", fake):
            controller = ExplorerHistory(lambda: Path("/project"), emit)
            _ = controller.open()
            _ = await asyncio.wait_for(started.wait(), 2)
            second = controller.open()
            release.set()
            _ = await asyncio.wait_for(delivered.wait(), 2)
            self.assertTrue(all(n["generation"] == second["generation"] for n in notices))
            with self.assertRaises(ValueError):
                _ = await controller.more(1)
            await controller.dispose()

    async def test_head_fact_coalesces_and_disk_status_does_not_refresh(self) -> None:
        page = asyncio.Event()
        opens = 0
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            nonlocal opens
            if method.endswith("open"):
                opens += 1
            return response(method, params)
        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del method, reply_to
            if payload["kind"] == "page":
                page.set()
        with patch.object(pipe_runtime, "call_async", fake):
            controller = ExplorerHistory(lambda: Path("/project"), emit)
            _ = controller.open()
            _ = await asyncio.wait_for(page.wait(), 2)
            def fact(head: str) -> event_bus.WorkerEvent:
                return event_bus.build_event("GitSnapshotChanged", project_root="/project",
                    payload={"status": {"head": {"full": head}}}, source="test")
            await controller.on_fact(fact("b" * 40))
            self.assertEqual(opens, 1)
            page.clear()
            await controller.on_fact(fact("c" * 40))
            revision = controller.revision
            await controller.on_fact(fact("c" * 40))
            self.assertEqual(controller.revision, revision)
            _ = await asyncio.wait_for(page.wait(), 2)
            self.assertEqual(opens, 2)
            await controller.dispose()

    async def test_project_change_fences_existing_projection(self) -> None:
        page = asyncio.Event()
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            return response(method, params)
        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del method, reply_to
            if payload["kind"] == "page":
                page.set()
        with patch.object(pipe_runtime, "call_async", fake):
            controller = ExplorerHistory(lambda: Path("/project"), emit)
            _ = controller.open()
            _ = await asyncio.wait_for(page.wait(), 2)
            old = controller.revision
            controller.invalidate_project()
            with self.assertRaises(ValueError):
                _ = await controller.more(old)
            await controller.dispose()
