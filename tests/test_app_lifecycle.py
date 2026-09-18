# pyright: strict
from __future__ import annotations

import asyncio
from types import ModuleType
import unittest

from app.libs.app_lifecycle import application_lifecycle


class AppLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_hooks_surround_transport_and_cleanup_failure(self) -> None:
        for fail_start in (False, True):
            events: list[str] = []
            module = ModuleType('fixture')

            async def start() -> None:
                events.append('start')
                if fail_start:
                    raise ValueError('startup failed')

            async def stop() -> None:
                events.append('stop')

            module.__dict__.update(te2_app_start=start, te2_app_stop=stop)
            with self.assertRaises(ValueError):
                async with application_lifecycle(module):
                    events.append('transport')
                    raise ValueError('transport failed')
            self.assertEqual(events, ['start', 'stop'] if fail_start else ['start', 'transport', 'stop'])

    async def test_cancellation_runs_cleanup(self) -> None:
        entered = asyncio.Event()
        stopped = asyncio.Event()
        module = ModuleType('fixture')

        async def start() -> None:
            entered.set()
            await asyncio.Future[None]()

        async def stop() -> None:
            stopped.set()

        module.__dict__.update(te2_app_start=start, te2_app_stop=stop)

        async def run() -> None:
            async with application_lifecycle(module):
                self.fail('cancelled startup must not serve')

        task = asyncio.create_task(run())
        _ = await entered.wait()
        _ = task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(stopped.is_set())

    async def test_legacy_modules_and_invalid_pairs(self) -> None:
        module = ModuleType('fixture')
        async with application_lifecycle(module):
            pass
        module.__dict__['te2_app_start'] = lambda: None
        with self.assertRaises(TypeError):
            async with application_lifecycle(module):
                self.fail('partial contract must not serve')
