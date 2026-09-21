# pyright: strict
from __future__ import annotations

import asyncio
from typing import cast
import unittest
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.worker_services import event_bus as bus
from app.apps.code_te2.worker_services import runtime
from app.apps.code_te2.worker_services import run_profile_fws_bridge as bridge
from app.apps.code_te2.workbench_runtime_discovery import workbench_runtime_discovery


class CodeTe2LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_mode_change_cancels_eager_and_early_owners_without_stopping_bus(self) -> None:
        entered = asyncio.Event()
        stopped: list[str] = []

        async def eager() -> None:
            entered.set()
            try:
                await asyncio.Future[None]()
            finally:
                stopped.append("eager")

        async def early() -> None:
            self.assertEqual(stopped, ["eager"])
            stopped.append("early")

        task = asyncio.create_task(eager())
        _ = await entered.wait()
        with (
            patch.object(runtime, "_startup_task", task),
            patch.object(runtime, "stop_early_intelligence", early),
            patch.object(workbench_runtime_discovery, "stop", AsyncMock()),
            patch.object(runtime, "stop_worker_event_loop", AsyncMock()) as bus_stop,
        ):
            await runtime.stop_intelligence_startup()
            self.assertTrue(task.cancelled())
            self.assertEqual(stopped, ["eager", "early"])
            bus_stop.assert_not_awaited()

    async def test_initialization_once_and_startup_task_cancelled_before_cleanup(self) -> None:
        events: list[str] = []
        entered = asyncio.Event()

        def initialize() -> None:
            events.append('initialize')

        def bootstrap() -> None:
            events.append('bootstrap')

        async def intelligence() -> None:
            entered.set()
            try:
                await asyncio.Future[None]()
            finally:
                events.append('intelligence-stopped')

        async def stop_bridge() -> None:
            events.append('bridge-stopped')

        async def stop_bus() -> None:
            events.append('bus-stopped')

        with patch.object(runtime, 'bootstrap_worker_runtime', bootstrap), patch.object(runtime, 'stop_run_profile_fws_bridge', stop_bridge), patch.object(runtime, 'stop_worker_event_loop', stop_bus):
            await runtime.start_worker_runtime(initialize, intelligence)
            await runtime.start_worker_runtime(initialize, intelligence)
            _ = await entered.wait()
            await runtime.stop_worker_runtime()
        self.assertEqual(events, ['initialize', 'bootstrap', 'intelligence-stopped', 'bridge-stopped', 'bus-stopped'])

    async def test_bus_drains_and_restarts_without_duplicate_handlers(self) -> None:
        seen: list[str] = []

        async def handler(event: bus.WorkerEvent) -> None:
            seen.append(event['source'])

        bus.subscribe('FileSaved', handler)
        try:
            for source in ('first', 'second'):
                bus.set_worker_event_loop(asyncio.get_running_loop())
                await bus.publish(bus.build_event('FileSaved', source=source, payload={}))
                await bus.stop_worker_event_loop()
                self.assertFalse(bus.publish_threadsafe(bus.build_event('FileSaved', source='late', payload={})))
            self.assertEqual(seen, ['first', 'second'])
        finally:
            bus.unsubscribe('FileSaved', handler)

    async def test_bridge_stops_tasks_and_client_without_shell_operations(self) -> None:
        stopped = False

        class Client:
            async def shutdown(self) -> None:
                nonlocal stopped
                stopped = True

        async def wait_forever() -> None:
            await asyncio.Future[None]()

        task = asyncio.create_task(wait_forever())
        # The fixture implements only the shutdown surface exercised here.
        with patch.object(bridge, '_client', cast(bridge.AsyncSocketIoClient, cast(object, Client()))), patch.object(bridge, '_connect_task', task):
            await bridge.stop_run_profile_fws_bridge()
            self.assertIsNone(bridge._client)  # pyright: ignore[reportPrivateUsage]
            self.assertTrue(stopped)
            self.assertTrue(task.cancelled())
            await bridge.stop_run_profile_fws_bridge()
