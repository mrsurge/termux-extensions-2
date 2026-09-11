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
    if action.endswith("files"):
        return {"dto": "GitHistoryFilesResult", "version": 1, "sessionId": session,
                "page": {"dto": "GitHistoryFilesPage", "version": 1, "commitId": values["commitId"], "parentId": None,
                         "offset": 0, "totalFiles": 1, "nextOffset": None,
                         "files": [{"index": 0, "status": "added", "oldPath": None, "newPath": "test.py",
                                    "oldBlob": None, "newBlob": "d" * 40,
                                    "counts": {"state": "ready", "additions": 1, "deletions": 0}}]}}
    if action.endswith("blob"):
        return {"dto": "GitHistoryBlobResult", "version": 1, "sessionId": session,
                "pair": {"dto": "GitHistoryBlobPair", "version": 1, "commitId": values["commitId"], "parentId": None,
                         "index": values["index"], "original": {"state": "absent"},
                         "modified": {"state": "text", "path": "test.py", "id": "d" * 40, "text": "hello\n"}}}
    return {"dto": "GitHistoryClosed", "version": 1, "sessionId": session}


@final
class HistoryServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_notifications_are_exact_session_and_generation(self) -> None:
        from app.libs.pipe_protocol import PipeEnvelope
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            return response(method, params)
        with patch.object(pipe_runtime, "call_async", fake):
            async with history.history_session(Path("/project"), 9) as session:
                for identity, generation in [("wrong", 9), (session.session_id, 10)]:
                    _ = pipe_runtime.accept_notification(PipeEnvelope(kind="notification",
                        method="git.historyGraph.changed", origin_nid=2200, origin_name="service.git",
                        workspace_root="/project", project_generation=generation,
                        params={"version": 1, "sessionId": identity, "error": "wrong event"}))
                _ = pipe_runtime.accept_notification(PipeEnvelope(kind="notification",
                    method="git.historyGraph.changed", origin_nid=2200, origin_name="service.git",
                    workspace_root="/project", project_generation=9,
                    params={"version": 1, "sessionId": session.session_id, "error": None}))
                self.assertIsNone(await asyncio.wait_for(session.wait_changed(), 2))
            self.assertTrue(session.closed)

    async def test_lazy_files_and_blob_pair_decode_without_advancing_graph(self) -> None:
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            return response(method, params)
        with patch.object(pipe_runtime, "call_async", fake):
            async with history.history_session(Path("/project"), 9) as session:
                files = await session.files("b" * 40)
                self.assertEqual(files.files[0].counts.additions, 1)
                self.assertIsNone(files.parent_id)
                pair = await session.blob_pair("b" * 40, files.files[0])
                self.assertEqual(pair.original.state, "absent")
                self.assertEqual(pair.modified.text, "hello\n")
                self.assertEqual(session.offset, 0)

    async def test_unknown_counts_are_not_zero_and_invalid_continuation_rejected(self) -> None:
        bad = False
        async def fake(method: str, params: object = None, **_kwargs: object) -> object:
            data = response(method, params)
            if method.endswith("files"):
                page = mapping(data["page"])
                page["files"] = [{"index": 0, "status": "added", "oldPath": None, "newPath": "test.py",
                                  "oldBlob": None, "newBlob": "d" * 40, "counts": {"state": "binary"}}]
                if bad:
                    page["nextOffset"] = 0
            return data
        with patch.object(pipe_runtime, "call_async", fake):
            async with history.history_session(Path("/project"), 9) as session:
                files = await session.files("b" * 40)
                self.assertIsNone(files.files[0].counts.additions)
                bad = True
                with self.assertRaisesRegex(ValueError, "continuation"):
                    _ = await session.files("b" * 40)

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
