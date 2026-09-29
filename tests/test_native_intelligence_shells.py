"""The async adapter must never strand competing native pipe reads."""
from __future__ import annotations

import asyncio
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock

from app.apps.code_te2.native_shells import Orchestrator, OutputReader, ShellManager


class NativeIntelligenceShellTests(unittest.IsolatedAsyncioTestCase):
    async def test_timeout_reuses_the_same_read(self):
        gate = threading.Event()
        bridge = Mock()
        bridge.shell_read.side_effect = lambda token: (gate.wait(2), b"payload")[1]
        reader = OutputReader(bridge, 7)
        try:
            with self.assertRaises(TimeoutError):
                await asyncio.wait_for(reader.get(), 0.02)
            with self.assertRaises(TimeoutError):
                await asyncio.wait_for(reader.get(), 0.02)
            gate.set()
            self.assertEqual(await reader.get(), b"payload")
            bridge.shell_read.assert_called_once_with(7)
        finally:
            gate.set()
            await reader.close()
        bridge.shell_unsubscribe.assert_called_once_with(7)
        bridge.shell_release.assert_called_once_with(7)

    async def test_cancelled_close_still_releases_after_read(self):
        gate = threading.Event()
        started = threading.Event()
        bridge = Mock()

        def read(token):
            started.set()
            gate.wait(2)
            raise RuntimeError("closed")

        bridge.shell_read.side_effect = read
        reader = OutputReader(bridge, 4)
        request = asyncio.create_task(reader.get())
        await asyncio.to_thread(started.wait, 2)
        close = asyncio.create_task(reader.close())
        await asyncio.sleep(0.01)
        close.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await close
        bridge.shell_release.assert_not_called()
        gate.set()
        await reader.close()
        await asyncio.gather(request, return_exceptions=True)
        bridge.shell_release.assert_called_once_with(4)

    async def test_cancelled_allocation_releases_token(self):
        gate = threading.Event()
        started = threading.Event()
        bridge = Mock()

        def subscribe(shell):
            started.set()
            gate.wait(2)
            return 9

        bridge.shell_subscribe.side_effect = subscribe
        request = asyncio.create_task(ShellManager(bridge).subscribe_output_bytes("wba"))
        await asyncio.to_thread(started.wait, 2)
        request.cancel()
        gate.set()
        with self.assertRaises(asyncio.CancelledError):
            await request
        bridge.shell_unsubscribe.assert_called_once_with(9)
        bridge.shell_release.assert_called_once_with(9)

    async def test_binary_write_is_forwarded_unchanged(self):
        bridge = Mock()
        await ShellManager(bridge).write_bytes("wba", b"\x81\xff\x00")
        bridge.shell_write.assert_called_once_with("wba", b"\x81\xff\x00")

    async def test_cancelled_spawn_reaps_exact_created_child(self):
        gate, started = threading.Event(), threading.Event()
        bridge = Mock()

        def spawn(*args):
            started.set()
            gate.wait(2)
            return {"id": "owned", "label": "wba", "pid": 123, "status": "running"}

        bridge.shell_spawn.side_effect = spawn
        task = asyncio.create_task(Orchestrator(ShellManager(bridge)).start_from_ref(
            "worker.yaml#wba", base_dir=Path.cwd(), ctx={}, label="wba",
            record_spec_id="wba", wait_ready=False))
        await asyncio.to_thread(started.wait, 2)
        task.cancel()
        gate.set()
        with self.assertRaises(asyncio.CancelledError):
            await task
        bridge.shell_terminate.assert_called_once_with("owned")
