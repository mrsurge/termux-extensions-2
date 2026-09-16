from __future__ import annotations

import asyncio
import queue
import threading
import unittest
from collections.abc import Callable
from unittest import mock
from typing import final, override

from app.libs import pipe_runtime
from app.libs.pipe_protocol import PipeEnvelope, PipeIdentity
from app.libs.runtime_debug_pipe import RuntimeDebugPipe


def request(method: str = "runtime.debug.status") -> PipeEnvelope:
    return PipeEnvelope(kind="request", id="test-1", method=method,
                        origin_nid=1, origin_name="framework.rust",
                        target_nid=2100, target_name="service.app")


@final
class DebugPipeTests(unittest.IsolatedAsyncioTestCase):
    def __init__(self, methodName: str = "runTest") -> None:
        super().__init__(methodName)
        self.loop: asyncio.AbstractEventLoop | None = None
        self.replies: asyncio.Queue[PipeEnvelope] = asyncio.Queue()
        self.pipe = RuntimeDebugPipe(enabled=True, identity=PipeIdentity(2100, "service.app"), reply=self.reply)

    @override
    async def asyncSetUp(self) -> None:
        self.loop = asyncio.get_running_loop()

    @override
    async def asyncTearDown(self) -> None:
        self.pipe.close()
        await asyncio.sleep(0)

    def reply(self, envelope: PipeEnvelope, before_write: Callable[[], None] | None = None) -> None:
        assert self.loop is not None
        if before_write is not None:
            before_write()
        _ = self.loop.call_soon_threadsafe(self.replies.put_nowait, envelope)

    async def receive(self) -> PipeEnvelope:
        return await asyncio.wait_for(self.replies.get(), 2)

    async def test_status_runs_on_live_loop(self) -> None:
        self.pipe.bind(asyncio.get_running_loop())
        self.assertTrue(await asyncio.to_thread(self.pipe.submit, request()))
        response = await self.receive()
        self.assertEqual(response.id, "test-1")
        self.assertEqual(response.result, {"enabled": True, "loopRunning": True, "threadId": threading.get_ident()})

    async def test_reply_releases_admission_before_next_request(self) -> None:
        self.pipe.bind(asyncio.get_running_loop())
        for _ in range(20):
            self.assertTrue(self.pipe.submit(request()))
            response = await self.receive()
            self.assertIsNone(response.error)

    async def test_disabled_unbound_and_closed(self) -> None:
        self.assertTrue(self.pipe.submit(request()))
        response = await self.receive()
        assert response.error is not None
        self.assertEqual(response.error.code, "runtimeDebug.unavailable")
        disabled = RuntimeDebugPipe(enabled=False, identity=PipeIdentity(2100, "service.app"), reply=self.reply)
        self.assertTrue(disabled.submit(request()))
        response = await self.receive()
        assert response.error is not None
        self.assertEqual(response.error.code, "runtimeDebug.disabled")
        self.pipe.bind(asyncio.get_running_loop())
        self.pipe.close()
        self.assertTrue(self.pipe.submit(request()))
        response = await self.receive()
        assert response.error is not None
        self.assertEqual(response.error.code, "runtimeDebug.unavailable")
        self.pipe.bind(asyncio.get_running_loop())
        self.assertTrue(self.pipe.submit(request()))
        response = await self.receive()
        assert response.error is not None
        self.assertEqual(response.error.code, "runtimeDebug.unavailable")

    async def test_wrong_target_and_unknown_method(self) -> None:
        self.pipe.bind(asyncio.get_running_loop())
        wrong = request()
        wrong.target_name = "other"
        self.assertTrue(self.pipe.submit(wrong))
        response = await self.receive()
        assert response.error is not None
        self.assertEqual(response.error.code, "protocol.wrongTarget")
        self.assertTrue(self.pipe.submit(request("runtime.debug.unknown")))
        response = await self.receive()
        assert response.error is not None
        self.assertEqual(response.error.code, "protocol.methodNotFound")
        self.assertFalse(self.pipe.submit(request("fs.listDirectory")))

    async def test_bounded_admission_and_shutdown_cancellation(self) -> None:
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def handler(_request: PipeEnvelope) -> object:
            started.set()
            try:
                _ = await asyncio.Event().wait()
            finally:
                cancelled.set()
            return None

        self.pipe = RuntimeDebugPipe(enabled=True, identity=PipeIdentity(2100, "service.app"), reply=self.reply, handler=handler)
        self.pipe.bind(asyncio.get_running_loop())
        self.assertTrue(await asyncio.to_thread(self.pipe.submit, request()))
        _ = await asyncio.wait_for(started.wait(), 2)
        self.assertTrue(self.pipe.submit(request()))
        response = await self.receive()
        assert response.error is not None
        self.assertEqual(response.error.code, "runtimeDebug.busy")
        self.pipe.close()
        _ = await asyncio.wait_for(cancelled.wait(), 2)

    async def test_nested_framework_call_does_not_block_reader(self) -> None:
        # The reply arrives on the simulated reader while the live loop awaits it.
        frame_ready = threading.Event()

        class Writer:
            def write(self, data: bytes) -> int:
                frame_ready.set()
                return len(data)

            def flush(self) -> None:
                pass

        async def handler(_request: PipeEnvelope) -> object:
            return await pipe_runtime.call_async("test.echo", timeout_seconds=2)

        with mock.patch.object(pipe_runtime, "_transport_writer", Writer()), mock.patch.object(
            pipe_runtime, "_identity", PipeIdentity(2100, "service.app")
        ), mock.patch.object(pipe_runtime, "_next_request_id", return_value="nested"):
            self.pipe = RuntimeDebugPipe(enabled=True, identity=PipeIdentity(2100, "service.app"), reply=self.reply, handler=handler)
            self.pipe.bind(asyncio.get_running_loop())
            self.assertTrue(await asyncio.to_thread(self.pipe.submit, request()))
            self.assertTrue(await asyncio.to_thread(frame_ready.wait, 2))
            self.assertTrue(pipe_runtime.accept_response(PipeEnvelope(kind="response", id="nested", result="arrived")))
            self.assertEqual((await self.receive()).result, "arrived")


class PipeWriterTests(unittest.TestCase):
    def test_duplicate_response_is_nonblocking(self) -> None:
        pending: queue.Queue[PipeEnvelope] = queue.Queue(maxsize=1)
        with mock.patch.object(pipe_runtime, "_pending", {"duplicate": pending}):
            frame = PipeEnvelope(kind="response", id="duplicate")
            self.assertTrue(pipe_runtime.accept_response(frame))
            self.assertFalse(pipe_runtime.accept_response(frame))
            self.assertIs(pending.get_nowait(), frame)

    def test_all_writes_share_lock(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        output: list[bytes] = []

        class Writer:
            def write(self, data: bytes) -> int:
                entered.set()
                if not release.wait(2):
                    raise TimeoutError("test writer stalled")
                output.append(data)
                return len(data)

            def flush(self) -> None:
                pass

        with mock.patch.object(pipe_runtime, "_transport_writer", Writer()):
            thread = threading.Thread(target=pipe_runtime.write_envelope, args=(request(),))
            thread.start()
            try:
                self.assertTrue(entered.wait(2))
                acquired = pipe_runtime._write_lock.acquire(blocking=False)  # pyright: ignore[reportPrivateUsage]
                if acquired:
                    pipe_runtime._write_lock.release()  # pyright: ignore[reportPrivateUsage]
                self.assertFalse(acquired)
            finally:
                release.set()
                thread.join(2)
            self.assertFalse(thread.is_alive())
            self.assertEqual(len(output), 1)


if __name__ == "__main__":
    _ = unittest.main()
