# pyright: strict
from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
from typing import cast, final
from unittest.mock import patch
from app.libs import pipe_runtime

from app.apps.code_te2.worker_services import history_service as history


def mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def response(action: str, params: object) -> dict[str, object]:
    values = mapping(params)
    session = values["sessionId"]
    if action.endswith("open"):
        return {"dto": "GitHistoryOpened", "version": 1, "sessionId": session,
                "snapshot": {"dto": "GitHistorySnapshot", "version": 1,
                             "snapshotId": "a" * 64, "headId": "b" * 40,
                             "headRef": "refs/heads/main", "refs": []}}
    if action.endswith("next"):
        return {"dto": "GitHistoryPageResult", "version": 1, "sessionId": session,
                "page": {"dto": "GitHistoryPage", "version": 1,
                         "snapshotId": "a" * 64, "offset": values["offset"],
                         "commits": [{"id": "b" * 40, "parentIds": [], "subject": "root",
                                      "author": "Test", "timestamp": 123}], "complete": True}}
    return {"dto": "GitHistoryClosed", "version": 1, "sessionId": session}


@final
class HistoryServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_transport_and_context_closes(self) -> None:
        calls: list[str] = []
        async def fake(method: str, params: object = None, **kwargs: object) -> object:
            calls.append(method)
            self.assertEqual(kwargs["target_name"], "service.git")
            self.assertEqual(kwargs["project_generation"], 9)
            self.assertEqual(kwargs["workspace_root"], "/project")
            return response(method, params)
        with patch.object(pipe_runtime, "call_async", fake):
            async with history.history_session(Path("/project"), 9) as session:
                page = await session.next_page()
                self.assertEqual(page.offset, 0)
                self.assertEqual(session.offset, 1)
                self.assertEqual(page.commits[0].parents, ())
        self.assertEqual(calls, ["git.historyGraph.open", "git.historyGraph.next", "git.historyGraph.close"])

    async def test_stale_page_is_rejected_and_closed(self) -> None:
        calls: list[str] = []
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            calls.append(method)
            data = response(method, params)
            if method.endswith("next"):
                mapping(data["page"])["snapshotId"] = "c" * 64
            return data
        with patch.object(pipe_runtime, "call_async", fake):
            with self.assertRaisesRegex(ValueError, "generation/offset"):
                async with history.history_session(Path("/project"), 9) as session:
                    _ = await session.next_page()
        self.assertEqual(calls[-1], "git.historyGraph.close")

    async def test_cancelled_open_settles_admission_before_close(self) -> None:
        started = asyncio.Event()
        release = asyncio.Event()
        calls: list[str] = []
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            calls.append(method)
            if method.endswith("open"):
                started.set()
                _ = await release.wait()
            return response(method, params)
        async def use() -> None:
            async with history.history_session(Path("/project"), 9):
                self.fail("Cancelled admission must not enter the body")
        with patch.object(pipe_runtime, "call_async", fake):
            task = asyncio.create_task(use())
            _ = await started.wait()
            _ = task.cancel()
            await asyncio.sleep(0)
            self.assertEqual(calls, ["git.historyGraph.open"])
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(calls[-1], "git.historyGraph.close")

    async def test_invalid_limit_never_calls_transport(self) -> None:
        session = history.HistorySession(Path("/project"), 9)
        with self.assertRaisesRegex(ValueError, "page size"):
            _ = await session.next_page(501)
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            data = response(method, params)
            data["version"] = True
            return data
        with patch.object(pipe_runtime, "call_async", fake):
            with self.assertRaisesRegex(ValueError, "integer"):
                _ = await session.open()
