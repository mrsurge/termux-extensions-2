# pyright: strict, reportPrivateUsage=false
from __future__ import annotations

import asyncio
import unittest
from collections.abc import Awaitable, Callable
from typing import cast, override
from unittest.mock import AsyncMock, patch
from framework_shells.record import ShellRecord

from app.apps.code_te2 import code_server_install_state
from app.apps.code_te2 import intelligence_startup as startup
from app.apps.code_te2 import workbench_adapter_shell_manager as adapter
from app.apps.code_te2 import code_server_shell_manager as code_server
from app.apps.code_te2 import intelligence_bootstrap_gate as gate


class ParallelStartupTests(unittest.IsolatedAsyncioTestCase):
    @override
    async def asyncSetUp(self) -> None:
        selected = patch.object(code_server_install_state, "selected_installation", return_value=None)
        _ = selected.start()
        self.addCleanup(selected.stop)

    async def test_spawn_callback_runs_once_for_fresh_or_adopted_shell(self) -> None:
        record = cast(code_server.ShellRecord, object())
        for fresh in (False, True):
            seen: list[code_server.ShellRecord] = []

            async def launch(_root: str, *, on_spawned: Callable[[code_server.ShellRecord], None]) -> code_server.ShellRecord:
                if fresh:
                    on_spawned(record)
                return record

            with patch.object(code_server, "_spawn_lock", asyncio.Lock()), patch.object(code_server, "_ensure_code_server_shell", launch):
                _ = await code_server.ensure_code_server_shell("/project", on_spawned=seen.append)
            self.assertEqual(seen, [record])

    async def test_dependency_wait_retains_adapter_launch_lock(self) -> None:
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = 0

        async def gate() -> None:
            _ = await release.wait()

        async def prepare(_root: str, _http: str, _socket: str | None, *, wait_for_dependency: Callable[[], Awaitable[None]] | None = None) -> ShellRecord:
            nonlocal calls
            calls += 1
            entered.set()
            if wait_for_dependency:
                await wait_for_dependency()
            return cast(ShellRecord, object())

        with patch.object(adapter, "_spawn_lock", asyncio.Lock()), patch.object(adapter, "_ensure_workbench_adapter_shell", prepare):
            first = asyncio.create_task(adapter.ensure_workbench_adapter_shell("/project", "http://localhost", wait_for_dependency=gate))
            _ = await entered.wait()
            second = asyncio.create_task(adapter.ensure_workbench_adapter_shell("/project", "http://localhost"))
            await asyncio.sleep(0)
            self.assertEqual(calls, 1)
            release.set()
            _ = await asyncio.gather(first, second)
            self.assertEqual(calls, 2)

    async def test_adapter_prepares_before_code_server_ready_and_connects_after(self) -> None:
        prepared = asyncio.Event()
        release = asyncio.Event()
        connected = asyncio.Event()

        async def code(_root: str, *, on_spawned: Callable[[code_server.ShellRecord], None]) -> code_server.ShellRecord:
            record = cast(code_server.ShellRecord, object())
            on_spawned(record)
            _ = await release.wait()
            return record

        async def wba(_root: str, _http: str, _socket: str | None, *, wait_for_dependency: Callable[[], Awaitable[None]]) -> object:
            prepared.set()
            await wait_for_dependency()
            connected.set()
            return object()

        with patch.object(startup, "ensure_code_server_shell", code), patch.object(startup, "ensure_workbench_adapter_shell", wba), patch.object(startup, "code_server_connection_target", return_value=("http://localhost", "/test.sock")):
            task = asyncio.create_task(startup.prime_intelligence_runtime("/project"))
            _ = await asyncio.wait_for(prepared.wait(), 1)
            self.assertFalse(connected.is_set())
            release.set()
            await asyncio.wait_for(task, 1)
            self.assertTrue(connected.is_set())

    async def test_dependency_failure_cancels_waiter_without_connecting(self) -> None:
        prepared = asyncio.Event()
        finished = asyncio.Event()

        async def code(_root: str, *, on_spawned: Callable[[code_server.ShellRecord], None]) -> code_server.ShellRecord:
            on_spawned(cast(code_server.ShellRecord, object()))
            _ = await prepared.wait()
            raise TimeoutError("not ready")

        async def wba(_root: str, _http: str, _socket: str | None, *, wait_for_dependency: Callable[[], Awaitable[None]]) -> object:
            prepared.set()
            try:
                await wait_for_dependency()
                self.fail("must not connect")
            finally:
                finished.set()

        with patch.object(startup, "ensure_code_server_shell", code), patch.object(startup, "ensure_workbench_adapter_shell", wba), patch.object(startup, "code_server_connection_target", return_value=("http://localhost", "/test.sock")):
            with self.assertRaises(TimeoutError):
                await startup.prime_intelligence_runtime("/project")
        self.assertTrue(finished.is_set())

    async def test_both_readiness_orders_gate_connect(self) -> None:
        for app_first in (True, False):
            prepared, code_ready, connected = asyncio.Event(), asyncio.Event(), asyncio.Event()

            async def code(_root: str, *, on_spawned: Callable[[code_server.ShellRecord], None]) -> code_server.ShellRecord:
                record = cast(code_server.ShellRecord, object())
                on_spawned(record)
                _ = await code_ready.wait()
                return record

            async def wba(_root: str, _http: str, _socket: str | None, *, wait_for_dependency: Callable[[], Awaitable[None]]) -> object:
                prepared.set()
                await wait_for_dependency()
                connected.set()
                return object()

            gate.hold_application()
            try:
                with patch.object(startup, "ensure_code_server_shell", code), patch.object(startup, "ensure_workbench_adapter_shell", wba), patch.object(startup, "code_server_connection_target", return_value=("http://localhost", "/test.sock")):
                    task = asyncio.create_task(startup.prime_intelligence_runtime("/project"))
                    _ = await asyncio.wait_for(prepared.wait(), 1)
                    if app_first:
                        gate.release_application()
                    else:
                        code_ready.set()
                    await asyncio.sleep(0)
                    self.assertFalse(connected.is_set())
                    code_ready.set()
                    gate.release_application()
                    await asyncio.wait_for(task, 1)
                    self.assertTrue(connected.is_set())
            finally:
                gate.reset_application()

    async def test_cancelled_dependency_keeps_prepared_shell_for_retry(self) -> None:
        async def cancelled() -> None:
            raise asyncio.CancelledError()

        with patch.object(adapter, "_prepared_shell_id", "prepared"), patch.object(adapter, "adapter_rpc", AsyncMock()) as rpc:
            with self.assertRaises(asyncio.CancelledError):
                await adapter._connect_prepared_adapter("/project", "http://localhost", "/test.sock", cancelled)
            self.assertEqual(adapter._prepared_shell_id, "prepared")
            rpc.assert_not_awaited()

    async def test_ready_publication_follows_successful_connect(self) -> None:
        with patch.object(adapter, "_prepared_shell_id", "prepared"), patch.object(adapter, "adapter_rpc", AsyncMock(return_value={"result": {"ok": True}})) as rpc, patch.object(adapter, "_publish_ready_if_changed", AsyncMock()) as publish:
            await adapter._connect_prepared_adapter("/project", "http://localhost", "/test.sock", None)
            rpc.assert_awaited_once()
            publish.assert_awaited_once_with("/project")
            self.assertIsNone(adapter._prepared_shell_id)
