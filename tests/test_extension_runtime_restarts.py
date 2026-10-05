"""Extension restart completion must not depend on a page reload."""
from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.apps.code_te2.explorer.services import extension_restarts as restart


class ExtensionRestartTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.events: list[str] = []
        self.mode = SimpleNamespace(web_workers_enabled=False)
        self.project = Path("/project")
        self.emit = AsyncMock(side_effect=lambda *args: self.events.append("notify"))
        self.prime = AsyncMock(side_effect=lambda *args: self.events.append("prime"))
        self.adapter = AsyncMock(side_effect=lambda: self.events.append("adapter_stop"))
        self.server = AsyncMock(side_effect=lambda: self.events.append("server_stop"))
        self.reset = Mock(side_effect=lambda: self.events.append("reset"))
        patches = [
            patch.object(restart, "_restart_lock", asyncio.Lock()),
            patch.object(restart, "IntelligenceStateStore", return_value=SimpleNamespace(read=lambda: self.mode)),
            patch.object(restart, "get_project_root", side_effect=lambda: self.project),
            patch.object(restart, "current_project_generation", return_value=7),
            patch.object(restart, "prime_code_server_runtime", self.prime),
            patch.object(restart, "publish_extension_contributions_changed", AsyncMock()),
            patch("app.apps.code_te2.workbench_adapter_shell_manager.terminate_adapter_shell", self.adapter),
            patch("app.apps.code_te2.code_server_shell_manager.terminate_code_server_shell", self.server),
            patch("app.apps.code_te2.wba_event_bridge.reset_wba_project_event_state", self.reset),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    async def test_full_restart_orders_stop_reset_notify_and_prepare(self) -> None:
        await restart.restart_code_server_and_adapter(self.emit, "ext_install")
        self.assertEqual(self.events, ["adapter_stop", "reset", "server_stop", "notify", "prime"])
        self.prime.assert_awaited_once_with("/project")
        self.emit.assert_awaited_once_with(
            "explorer.extensions.adapter.restarting",
            {"reason": "ext_install", "full_restart": True},
        )

    async def test_adapter_only_preserves_code_server(self) -> None:
        await restart.restart_adapter_only(self.emit, "custom_settings")
        self.assertEqual(self.events, ["adapter_stop", "reset", "notify", "prime"])
        self.server.assert_not_awaited()

    async def test_web_worker_mode_does_not_start_or_stop_managed_runtime(self) -> None:
        self.mode.web_workers_enabled = True
        await restart.restart_code_server_and_adapter(self.emit, "ext_uninstall")
        self.assertEqual(self.events, [])

    async def test_successful_uninstall_reply_does_not_wait_for_recovery(self) -> None:
        from app.apps.code_te2.explorer.handlers.extensions import handle_ext_uninstall
        entered, release = asyncio.Event(), asyncio.Event()

        async def prime(*args: object) -> None:
            entered.set()
            await release.wait()

        self.prime.side_effect = prime
        reply = AsyncMock()
        with patch("app.apps.code_te2.extension_registry.uninstall_extension", return_value={"registry_summary": {}}):
            await asyncio.wait_for(handle_ext_uninstall(
                SimpleNamespace(emit_personal=reply), {"ext_id": "test.extension"}, "request-1",
            ), 1)
        reply.assert_awaited_once_with("ext:uninstalled", {
            "ok": True, "uninstalled_id": "test.extension", "registry_summary": {},
        }, "request-1")
        try:
            await asyncio.wait_for(entered.wait(), 1)
            self.assertTrue(restart._restart_tasks)
            self.assertFalse(any(task.done() for task in restart._restart_tasks))
        finally:
            release.set()
            await asyncio.gather(*restart._restart_tasks)
        await asyncio.sleep(0)
        self.assertFalse(restart._restart_tasks)

    async def test_recovery_failure_is_reported_separately_without_replaying_mutation(self) -> None:
        self.prime.side_effect = RuntimeError("handshake failed")
        restart.schedule_code_server_and_adapter_restart(self.emit, "ext_uninstall")
        await asyncio.gather(*restart._restart_tasks)
        self.emit.assert_any_await("explorer.error", {
            "error": "Extension change succeeded, but intelligence restart failed: handshake failed",
            "reason": "ext_uninstall",
        })
        self.prime.assert_awaited_once()

    async def test_runtime_failure_propagates_without_retry(self) -> None:
        self.prime.side_effect = RuntimeError("startup failed")
        with self.assertRaisesRegex(RuntimeError, "startup failed"):
            await restart.restart_adapter_only(self.emit, "manual")
        self.prime.assert_awaited_once()

    async def test_stop_failure_prevents_replacement(self) -> None:
        self.adapter.side_effect = RuntimeError("stop failed")
        with self.assertRaisesRegex(RuntimeError, "stop failed"):
            await restart.restart_code_server_and_adapter(self.emit, "manual")
        self.prime.assert_not_awaited()
        self.server.assert_not_awaited()

    async def test_project_is_resolved_after_notification_not_from_caller(self) -> None:
        def notify(*args: object) -> None:
            self.project = Path("/new-project")

        self.emit.side_effect = notify
        await restart.restart_adapter_only(self.emit, "manual")
        self.prime.assert_awaited_once_with("/new-project")

    async def test_changed_project_during_prepare_is_not_success(self) -> None:
        def prime(*args: object) -> None:
            self.project = Path("/new-project")

        self.prime.side_effect = prime
        with self.assertRaisesRegex(RuntimeError, "project changed"):
            await restart.restart_adapter_only(self.emit, "manual")
        self.prime.assert_awaited_once()

    async def test_mode_change_before_prepare_does_not_relaunch(self) -> None:
        def notify(*args: object) -> None:
            self.mode.web_workers_enabled = True

        self.emit.side_effect = notify
        await restart.restart_adapter_only(self.emit, "manual")
        self.prime.assert_not_awaited()

    async def test_generation_change_during_prepare_is_not_success(self) -> None:
        with patch.object(restart, "current_project_generation", side_effect=[7, 8]):
            with self.assertRaisesRegex(RuntimeError, "project changed"):
                await restart.restart_adapter_only(self.emit, "manual")
        self.prime.assert_awaited_once()

    async def test_reset_failure_prevents_replacement(self) -> None:
        self.reset.side_effect = RuntimeError("reset failed")
        with self.assertRaisesRegex(RuntimeError, "reset failed"):
            await restart.restart_adapter_only(self.emit, "manual")
        self.prime.assert_not_awaited()

    async def test_cancelled_queued_restart_does_not_stop_active_preparation(self) -> None:
        entered, release = asyncio.Event(), asyncio.Event()

        async def prime(*args: object) -> None:
            entered.set()
            await release.wait()

        self.prime.side_effect = prime
        first = asyncio.create_task(restart.restart_adapter_only(self.emit, "first"))
        await asyncio.wait_for(entered.wait(), 1)
        second = asyncio.create_task(restart.restart_adapter_only(self.emit, "queued"))
        try:
            await asyncio.sleep(0)
            second.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await second
            self.assertFalse(first.done())
            release.set()
            await asyncio.wait_for(first, 1)
            self.adapter.assert_awaited_once()
            self.prime.assert_awaited_once()
        finally:
            release.set()
            await asyncio.gather(first, second, return_exceptions=True)

    async def test_overlapping_restarts_are_serialized_until_prepared(self) -> None:
        entered, release = asyncio.Event(), asyncio.Event()

        async def prime(*args: object) -> None:
            entered.set()
            await release.wait()

        self.prime.side_effect = prime
        first = asyncio.create_task(restart.restart_adapter_only(self.emit, "first"))
        await asyncio.wait_for(entered.wait(), 1)
        second = asyncio.create_task(restart.restart_code_server_and_adapter(self.emit, "second"))
        try:
            await asyncio.sleep(0)
            self.assertEqual(self.adapter.await_count, 1)
            self.assertFalse(first.done())
            release.set()
            await asyncio.wait_for(asyncio.gather(first, second), 1)
            self.assertEqual(self.adapter.await_count, 2)
            self.assertEqual(self.prime.await_count, 2)
        finally:
            release.set()
            await asyncio.gather(first, second, return_exceptions=True)
