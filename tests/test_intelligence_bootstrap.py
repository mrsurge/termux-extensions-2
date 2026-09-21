# pyright: strict, reportPrivateUsage=false
from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.apps.code_te2 import intelligence_bootstrap as boot
from app.apps.code_te2 import intelligence_bootstrap_gate as gate
from app.apps.code_te2 import intelligence_startup as startup
from app.apps.code_te2 import workbench_adapter_shell_manager as adapter
from app.apps.code_te2.intelligence_state import IntelligenceState, IntelligenceStateStore
from app.apps.code_te2.workbench_runtime_discovery import workbench_runtime_discovery as discovery


class BootstrapTests(unittest.IsolatedAsyncioTestCase):
    async def test_preparation_precedes_attachment_and_handoff_reuses_task(self) -> None:
        preparing, connected = asyncio.Event(), asyncio.Event()
        calls: list[str] = []

        async def prime(project: str) -> None:
            calls.append(project)
            preparing.set()
            await gate.wait_for_application()
            connected.set()

        with (
            patch.object(IntelligenceStateStore, "read", return_value=IntelligenceState(False, None)),
            patch.object(boot, "_startup_project", return_value="/project"),
            patch.object(startup, "prime_intelligence_runtime", prime),
            patch.object(discovery, "start"), patch.object(discovery, "stop", AsyncMock()),
            patch.object(adapter, "stop_adapter_io", AsyncMock()) as close,
            patch.object(adapter, "publish_current_adapter_state", AsyncMock()) as publish,
        ):
            async with boot.te2_worker_bootstrap():
                _ = await asyncio.wait_for(preparing.wait(), 2)
                self.assertFalse(connected.is_set())
                await boot.attach_application("/project")
                self.assertTrue(await boot.await_early_intelligence("/project"))
                self.assertTrue(await boot.await_early_intelligence("/project"))
                self.assertTrue(connected.is_set())
                self.assertEqual(calls, ["/project"])
                publish.assert_awaited_once()
            close.assert_awaited_once()
            self.assertTrue(gate.application_is_ready())
            self.assertIsNone(boot._task)

    async def test_worker_mode_never_starts_intelligence(self) -> None:
        with (
            patch.object(IntelligenceStateStore, "read", return_value=IntelligenceState(True, {"installed": False})),
            patch.object(startup, "prime_intelligence_runtime", AsyncMock()) as prime,
            patch.object(discovery, "start") as discover,
            patch.object(adapter, "stop_adapter_io", AsyncMock()) as close,
        ):
            async with boot.te2_worker_bootstrap():
                self.assertFalse(await boot.await_early_intelligence("/project"))
                await boot.attach_application("/project")
            prime.assert_not_awaited()
            discover.assert_not_called()
            close.assert_not_awaited()

    async def test_failed_preparation_is_not_retried_at_handoff(self) -> None:
        with (
            patch.object(IntelligenceStateStore, "read", return_value=IntelligenceState(False, None)),
            patch.object(boot, "_startup_project", return_value="/project"),
            patch.object(startup, "prime_intelligence_runtime", AsyncMock(side_effect=RuntimeError("spawn failed"))) as prime,
            patch.object(discovery, "start"), patch.object(discovery, "stop", AsyncMock()),
            patch.object(adapter, "stop_adapter_io", AsyncMock()),
        ):
            async with boot.te2_worker_bootstrap():
                with self.assertRaisesRegex(RuntimeError, "spawn failed"):
                    _ = await boot.await_early_intelligence("/project")
            prime.assert_awaited_once()

    async def test_import_failure_cancels_preparation_and_unsubscribes(self) -> None:
        entered, stopped = asyncio.Event(), asyncio.Event()

        async def prime(_project: str) -> None:
            entered.set()
            try:
                await gate.wait_for_application()
            finally:
                stopped.set()

        with (
            patch.object(IntelligenceStateStore, "read", return_value=IntelligenceState(False, None)),
            patch.object(boot, "_startup_project", return_value="/project"),
            patch.object(startup, "prime_intelligence_runtime", prime),
            patch.object(discovery, "start"), patch.object(discovery, "stop", AsyncMock()),
            patch.object(adapter, "stop_adapter_io", AsyncMock()) as close,
        ):
            with self.assertRaisesRegex(ValueError, "assembly failed"):
                async with boot.te2_worker_bootstrap():
                    _ = await asyncio.wait_for(entered.wait(), 2)
                    raise ValueError("assembly failed")
            self.assertTrue(stopped.is_set())
            close.assert_awaited_once()
            self.assertTrue(gate.application_is_ready())

    async def test_project_change_cancels_old_preparation_before_regular_prime(self) -> None:
        with (
            patch.object(IntelligenceStateStore, "read", return_value=IntelligenceState(False, None)),
            patch.object(boot, "_startup_project", return_value="/old"),
            patch.object(startup, "prime_intelligence_runtime", AsyncMock()),
            patch.object(discovery, "start"), patch.object(discovery, "stop", AsyncMock()),
            patch.object(adapter, "stop_adapter_io", AsyncMock()) as close,
        ):
            async with boot.te2_worker_bootstrap():
                self.assertFalse(await boot.await_early_intelligence("/new"))
                self.assertIsNone(boot._task)
            close.assert_awaited_once()

    async def test_pushes_wait_for_application_and_state_is_republished_once(self) -> None:
        handled: list[adapter.JsonObject] = []

        async def consume(obj: adapter.JsonObject, **_metrics: object) -> None:
            handled.append(obj)

        gate.hold_application()
        try:
            with patch.object(adapter, "_handle_push_event", consume):
                adapter._queue_push({"event": "te2.event", "params": {"type": "test"}}, payload_bytes=10)
                await asyncio.sleep(0)
                self.assertEqual(handled, [])
                # State publication must not import the event system early.
                await adapter.publish_current_adapter_state()
                gate.release_application()
                task = adapter._push_drain_task
                assert task is not None
                await asyncio.wait_for(task, 2)
                self.assertEqual(len(handled), 1)
        finally:
            await adapter._clear_pending_pushes()
            gate.reset_application()

    async def test_stale_project_is_cancelled_before_attachment_gate_opens(self) -> None:
        entered = asyncio.Event()
        gate_at_cancel: list[bool] = []

        async def prime(_project: str) -> None:
            entered.set()
            try:
                await gate.wait_for_application()
                self.fail("stale project must never attach")
            finally:
                gate_at_cancel.append(gate.application_is_ready())

        with (
            patch.object(IntelligenceStateStore, "read", return_value=IntelligenceState(False, None)),
            patch.object(boot, "_startup_project", return_value="/old"),
            patch.object(startup, "prime_intelligence_runtime", prime),
            patch.object(discovery, "start"), patch.object(discovery, "stop", AsyncMock()),
            patch.object(adapter, "stop_adapter_io", AsyncMock()),
        ):
            async with boot.te2_worker_bootstrap():
                _ = await asyncio.wait_for(entered.wait(), 2)
                await boot.attach_application("/new")
                self.assertEqual(gate_at_cancel, [False])
                self.assertTrue(gate.application_is_ready())
                self.assertFalse(await boot.await_early_intelligence("/new"))
