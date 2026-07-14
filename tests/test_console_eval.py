from __future__ import annotations

import asyncio
import unittest
from typing import Any
from unittest.mock import AsyncMock, patch

import app.te2_console_runtime as rt


class _MockNS:
    def __init__(self) -> None:
        self.emits: list[tuple[str, Any, str | None]] = []

    async def emit(self, event: str, data: Any, *, room: str | None = None, **kw: Any) -> None:
        self.emits.append((event, data, room))


class _MockSIO:
    def __init__(self) -> None:
        self.emits: list[tuple[str, Any, str, str | None]] = []
        self.emit = AsyncMock(side_effect=self._record_emit)

    async def _record_emit(
        self,
        event: str,
        data: Any,
        *,
        namespace: str = "",
        room: str | None = None,
    ) -> None:
        self.emits.append((event, data, namespace, room))

    def last_emit(self) -> tuple[str, Any, str, str | None] | None:
        return self.emits[-1] if self.emits else None

    def find_emit(self, event: str) -> tuple[str, Any, str, str | None] | None:
        for entry in self.emits:
            if entry[0] == event:
                return entry
        return None


class ConsoleEvalTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._mock_sio = _MockSIO()
        self._mock_ns = _MockNS()
        self._sio_patcher = patch.object(rt, "TE2_CONSOLE_SIO", self._mock_sio)
        self._sio_patcher.start()
        rt._registered_workers.clear()
        rt._pending_eval_results.clear()
        rt._registered_workers.add("test-worker")

    async def asyncTearDown(self) -> None:
        self._sio_patcher.stop()
        rt._registered_workers.clear()
        rt._pending_eval_results.clear()

    async def test_normal_round_trip(self) -> None:
        async def _resolve_after_start() -> None:
            await asyncio.sleep(0.01)
            req_id = self._mock_sio.find_emit("console:eval")[1]["reqId"]
            await rt.on_console_eval_result(
                self._mock_ns,
                "sid",
                {"reqId": req_id, "ok": True, "value": 42, "workerId": "test-worker"},
            )

        task = asyncio.create_task(_resolve_after_start())
        result = await rt.request_console_eval("test-worker", "1 + 1")
        await task

        self.assertTrue(result["ok"])
        self.assertEqual(result["value"], 42)

    async def test_timeout_emits_cancel(self) -> None:
        with self.assertRaises(asyncio.TimeoutError):
            await rt.request_console_eval(
                "test-worker", "new Promise(()=>{})", timeout_seconds=0.1
            )

        cancel = self._mock_sio.find_emit("console:evalCancel")
        self.assertIsNotNone(cancel, "console:evalCancel should have been emitted")
        self.assertEqual(cancel[3], "console:test-worker")
        self.assertEqual(cancel[1]["targetWorkerId"], "test-worker")

    async def test_payload_includes_timeout_seconds(self) -> None:
        async def _check_payload() -> None:
            await asyncio.sleep(0.01)
            eval_emit = self._mock_sio.find_emit("console:eval")
            req_id = eval_emit[1]["reqId"]
            await rt.on_console_eval_result(
                self._mock_ns, "sid", {"reqId": req_id, "ok": True, "value": None}
            )

        task = asyncio.create_task(_check_payload())
        await rt.request_console_eval(
            "test-worker", "null", timeout_seconds=5.0
        )
        await task

        eval_emit = self._mock_sio.find_emit("console:eval")
        self.assertEqual(eval_emit[1]["timeoutSeconds"], 5.0)

    async def test_late_result_does_not_crash(self) -> None:
        with self.assertRaises(asyncio.TimeoutError):
            await rt.request_console_eval(
                "test-worker", "x", timeout_seconds=0.05
            )

        self.assertEqual(len(rt._pending_eval_results), 0)

        await rt.on_console_eval_result(
            self._mock_ns, "sid", {"reqId": "late-req", "ok": True, "value": 99}
        )

    async def test_duplicate_result_no_double_resolve(self) -> None:
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        rt._pending_eval_results["dup-req"] = future

        await rt.on_console_eval_result(
            self._mock_ns, "sid", {"reqId": "dup-req", "ok": True, "value": 1}
        )
        self.assertTrue(future.done())
        self.assertEqual(future.result()["value"], 1)

        await rt.on_console_eval_result(
            self._mock_ns, "sid", {"reqId": "dup-req", "ok": True, "value": 2}
        )

    async def test_worker_not_registered(self) -> None:
        with self.assertRaises(LookupError):
            await rt.request_console_eval("ghost-worker", "code")


if __name__ == "__main__":
    unittest.main()
