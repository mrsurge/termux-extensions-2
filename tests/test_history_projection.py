# pyright: strict
from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
from typing import final
from unittest.mock import patch

from app.libs import pipe_runtime
from app.libs.pipe_protocol import PipeEnvelope
from app.apps.code_te2.explorer.services.history_projection import ExplorerHistory
from tests.test_history_service import response, mapping
from app.apps.code_te2.worker_services import event_bus
from app.apps.code_te2.host.history_handoff import handoffs


@final
class HistoryProjectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_selected_native_row_handoff_is_fenced_by_session_lifetime(self) -> None:
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            return response(method, params)

        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del method, payload, reply_to

        with patch.object(pipe_runtime, "call_async", fake), patch.object(event_bus, "current_project_generation", return_value=1):
            controller = ExplorerHistory(lambda: Path('/project'), emit)
            _ = controller.open()
            try:
                ticket = await controller.prepare_open(controller.revision, 'b' * 40, 0, 'primary')
                content = handoffs.take(ticket, '/project', 1)
                self.assertEqual(content.pair.modified.text, 'hello\n')
                self.assertEqual(content.pair.modified.path, 'test.py')
                with self.assertRaises(ValueError):
                    _ = await controller.prepare_open(controller.revision, 'c' * 40, 0, 'primary')
                ticket = await controller.prepare_open(controller.revision, 'b' * 40, 0, 'primary')
            finally:
                await controller.dispose()
            with self.assertRaises(ValueError):
                _ = handoffs.take(ticket, '/project', 1)

    async def test_early_native_invalidation_reopens_without_wba_facts(self) -> None:
        pages = asyncio.Event()
        opens = 0
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            nonlocal opens
            if method.endswith("open"):
                opens += 1
                if opens == 1:
                    event = PipeEnvelope(kind="notification", method="git.historyGraph.changed",
                        origin_nid=2200, origin_name="service.git", workspace_root="/project",
                        project_generation=0, params={"version": 1,
                            "sessionId": mapping(params)["sessionId"], "error": None})
                    for _ in range(10):
                        _ = pipe_runtime.accept_notification(event)
            return response(method, params)
        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del method, reply_to
            if payload["kind"] == "page" and payload["generation"] == 2:
                pages.set()
        with patch.object(pipe_runtime, "call_async", fake):
            controller = ExplorerHistory(lambda: Path("/project"), emit)
            _ = controller.open()
            _ = await asyncio.wait_for(pages.wait(), 2)
            self.assertEqual(opens, 2)
            await controller.dispose()

    async def test_watcher_error_is_visible_without_retry_loop(self) -> None:
        error_seen = asyncio.Event()
        opens = 0
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            nonlocal opens
            if method.endswith("open"):
                opens += 1
                _ = pipe_runtime.accept_notification(PipeEnvelope(kind="notification",
                    method="git.historyGraph.changed", origin_nid=2200, origin_name="service.git",
                    workspace_root="/project", project_generation=0,
                    params={"version": 1, "sessionId": mapping(params)["sessionId"], "error": "overflow"}))
            return response(method, params)
        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del method, reply_to
            if payload["kind"] == "watcherError":
                self.assertEqual(payload["error"], "overflow")
                error_seen.set()
        with patch.object(pipe_runtime, "call_async", fake):
            controller = ExplorerHistory(lambda: Path("/project"), emit)
            _ = controller.open()
            _ = await asyncio.wait_for(error_seen.wait(), 2)
            self.assertEqual(opens, 1)
            await controller.dispose()

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
