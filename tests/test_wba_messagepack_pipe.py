"""The adapter process pipe carries records, not log-prefixed JSON lines."""
# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from app.apps.code_te2.native_shells import ShellRecord
from app.apps.code_te2 import wba_pipe_codec
from app.apps.code_te2 import workbench_adapter_shell_manager as manager
from app.libs.messagepack_stream import MessagePackStream, encode_message


class ReferenceNativeFrames:
    """Test seam only: native guard/framing parity is covered by Rust tests."""
    def __init__(self) -> None:
        self.stream = MessagePackStream()

    def feed_frames(self, data: bytes) -> list[bytes]:
        return [encode_message(record) for record in self.stream.feed(data)]

    def finish(self) -> None:
        self.stream.finish()


class AdapterPipeTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_codec_seam_preserves_domain_reader_and_writer(self) -> None:
        streams: list[ReferenceNativeFrames] = []
        encoded: list[object] = []

        class Bridge:
            def wba_stream(self) -> ReferenceNativeFrames:
                stream = ReferenceNativeFrames()
                streams.append(stream)
                return stream

            def wba_encode(self, value: object) -> bytes:
                encoded.append(value)
                return encode_message(value)

        queue: asyncio.Queue[bytes] = asyncio.Queue()
        pending: asyncio.Future[dict[str, object]] = asyncio.get_running_loop().create_future()
        with (
            patch.object(wba_pipe_codec, "_native", Bridge()),
            patch.dict(manager._rpc_pending, {8: pending}, clear=True),
        ):
            task = asyncio.create_task(manager._stdout_reader_loop("test", queue))
            try:
                queue.put_nowait(encode_message({"kind": "reply", "payload": {"id": 8, "result": {"ok": True}}}))
                self.assertEqual(await asyncio.wait_for(pending, 1), {"id": 8, "result": {"ok": True}})
                self.assertEqual(wba_pipe_codec.encode_message({"id": 8}), encode_message({"id": 8}))
                self.assertEqual(encoded, [{"id": 8}])
                self.assertEqual(len(streams), 1)
            finally:
                task.cancel()
                await task

    async def test_fragmented_replies_and_pushes_preserve_order(self) -> None:
        for metrics_enabled in (False, True):
            with self.subTest(metrics_enabled=metrics_enabled):
                await self._check_fragmented_replies_and_pushes(metrics_enabled)

    async def _check_fragmented_replies_and_pushes(self, metrics_enabled: bool) -> None:
        queue: asyncio.Queue[bytes] = asyncio.Queue()
        pending: asyncio.Future[dict[str, object]] = asyncio.get_running_loop().create_future()
        pushes: list[dict[str, object]] = []
        encoded: list[object] = []

        class Bridge:
            def wba_stream(self) -> ReferenceNativeFrames:
                return ReferenceNativeFrames()

            def wba_encode(self, value: object) -> bytes:
                encoded.append(value)
                return encode_message(value)

        def receive(obj: dict[str, object], *, payload_bytes: int) -> None:
            self.assertEqual(payload_bytes, len(encode_message(obj)) if metrics_enabled else 0)
            pushes.append(obj)

        records = [
            {"kind": "startup", "payload": {"type": "adapter/start"}},
            {"kind": "push", "payload": {"event": "first", "text": "λ\n🙂", "binary": b"\x00\xff"}},
            {"kind": "push", "payload": {"event": "second"}},
            {"kind": "reply", "payload": {"id": 7, "result": "a\nb"}},
        ]
        with (
            patch.dict(manager._rpc_pending, {7: pending}, clear=True),
            patch.object(manager, "_queue_push", receive),
            patch.object(manager, "diagnostics_latency_metrics_enabled", return_value=metrics_enabled),
            patch.object(wba_pipe_codec, "_native", Bridge()),
        ):
            task = asyncio.create_task(manager._stdout_reader_loop("test", queue))
            try:
                for byte in b"".join(encode_message(record) for record in records):
                    queue.put_nowait(bytes([byte]))
                self.assertEqual(await asyncio.wait_for(pending, 1), {"id": 7, "result": "a\nb"})
                self.assertEqual(pushes, [record["payload"] for record in records if record["kind"] == "push"])
                self.assertEqual(encoded, pushes if metrics_enabled else [])
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
        environment: dict[str, object] = {
            "TE2_ADAPTER_PORT": str(manager.WORKBENCH_ADAPTER_FIXED_PORT),
            "TE2_CODE_SERVER_SOCKET": "/test.sock",
        }
        record = ShellRecord(
            id="test", command=[], label="test", env_overrides=environment,
            pid=1, status="running", stdout_log="",
        )
        self.assertFalse(manager._matches_expected_target(record, "/test.sock"))
        environment["TE2_ADAPTER_PIPE_CODEC"] = "messagepack-v1"
        self.assertTrue(manager._matches_expected_target(record, "/test.sock"))

    async def test_writer_uses_binary_stdin_and_cleans_up_on_cancellation(self) -> None:
        written: list[bytes] = []
        drained = asyncio.Event()

        class Manager:
            async def write_bytes(self, _shell_id: str, data: bytes) -> None:
                written.append(data)
                drained.set()

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
