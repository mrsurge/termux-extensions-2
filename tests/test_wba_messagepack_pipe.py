"""The adapter process pipe carries records, not log-prefixed JSON lines."""
# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from framework_shells.record import ShellRecord
from app.apps.code_te2 import workbench_adapter_shell_manager as manager
from app.libs.messagepack_stream import MessagePackStream, encode_message


class AdapterPipeTests(unittest.IsolatedAsyncioTestCase):
    async def test_fragmented_replies_and_pushes_preserve_order(self) -> None:
        queue: asyncio.Queue[bytes] = asyncio.Queue()
        pending: asyncio.Future[dict[str, object]] = asyncio.get_running_loop().create_future()
        pushes: list[dict[str, object]] = []

        def receive(obj: dict[str, object], *, payload_bytes: int) -> None:
            self.assertGreater(payload_bytes, 0)
            pushes.append(obj)

        records = [
            {"kind": "startup", "payload": {"type": "adapter/start"}},
            {"kind": "push", "payload": {"event": "first"}},
            {"kind": "reply", "payload": {"id": 7, "result": "a\nb"}},
            {"kind": "push", "payload": {"event": "second"}},
        ]
        with patch.dict(manager._rpc_pending, {7: pending}, clear=True), patch.object(manager, "_queue_push", receive):
            task = asyncio.create_task(manager._stdout_reader_loop("test", queue))
            try:
                for byte in b"".join(encode_message(record) for record in records):
                    queue.put_nowait(bytes([byte]))
                self.assertEqual(await asyncio.wait_for(pending, 1), {"id": 7, "result": "a\nb"})
                self.assertEqual(pushes, [{"event": "first"}, {"event": "second"}])
            finally:
                _ = task.cancel()
                await task

    async def test_malformed_record_fails_pending_requests(self) -> None:
        queue: asyncio.Queue[bytes] = asyncio.Queue()
        pending: asyncio.Future[dict[str, object]] = asyncio.get_running_loop().create_future()
        with patch.dict(manager._rpc_pending, {7: pending}, clear=True):
            queue.put_nowait(b"\xc1")
            await manager._stdout_reader_loop("test", queue)
            with self.assertRaisesRegex(RuntimeError, "reader crashed"):
                await pending
            self.assertFalse(manager._rpc_pending)

    def test_old_json_adapter_is_not_adopted(self) -> None:
        record = ShellRecord(
            id="test", command=[], label=None, cwd="/", env_overrides={
                "TE2_ADAPTER_PORT": str(manager.WORKBENCH_ADAPTER_FIXED_PORT),
                "TE2_CODE_SERVER_SOCKET": "/test.sock",
            }, pid=1, status="running", created_at=0, updated_at=0,
            autostart=False, stdout_log="", stderr_log="",
        )
        self.assertFalse(manager._matches_expected_target(record, "/test.sock"))
        record.env_overrides["TE2_ADAPTER_PIPE_CODEC"] = "messagepack-v1"
        self.assertTrue(manager._matches_expected_target(record, "/test.sock"))

    async def test_writer_uses_binary_stdin_and_cleans_up_on_cancellation(self) -> None:
        written: list[bytes] = []
        drained = asyncio.Event()

        class Stdin:
            def is_closing(self) -> bool:
                return False

            def write(self, data: bytes) -> None:
                written.append(data)

            async def drain(self) -> None:
                drained.set()

        class Process:
            stdin: Stdin = Stdin()

        class State:
            process: Process = Process()
            stdin_supported: bool = True

        class Manager:
            def get_pipe_state(self, _shell_id: str) -> State:
                return State()

        async def get_manager() -> Manager:
            return Manager()

        async def ensure_io(_shell_id: str) -> bool:
            return True

        with (
            patch.object(manager, "get_manager", get_manager),
            patch.object(manager, "_ensure_live_adapter_io", ensure_io),
            patch.object(manager, "_active_shell_id", "test"),
            patch.object(manager, "_rpc_write_lock", asyncio.Lock()),
            patch.dict(manager._rpc_pending, {}, clear=True),
        ):
            task = asyncio.create_task(manager.adapter_rpc("adapter.status"))
            _ = await asyncio.wait_for(drained.wait(), 1)
            decoder = MessagePackStream()
            request = list(decoder.feed(written[0]))
            decoder.finish()
            self.assertEqual(len(request), 1)
            self.assertEqual(len(manager._rpc_pending), 1)
            _ = task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertFalse(manager._rpc_pending)
