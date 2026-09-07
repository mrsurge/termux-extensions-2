from __future__ import annotations

import asyncio
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

from app.apps.code_te2.explorer.contracts.search_review import parse_search_run_params
from app.apps.code_te2.explorer.services.search_sessions import ExplorerSearchSessions
from app.libs.pipe_protocol import PipeEnvelope


class ProgressiveChangesSessionsTest(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.emitted = []
        async def emit(method, payload, reply_to=None):
            self.emitted.append((method, payload))
        self.manager = ExplorerSearchSessions(get_project_root=lambda: Path('/project'), emit_personal=emit)
        self.store = patch('app.apps.code_te2.stores.get_history_store', return_value=Mock(get_diff_base=Mock(return_value='HEAD')))
        self.store.start()
        self.addCleanup(self.store.stop)
        self.cancel = patch('app.apps.code_te2.explorer.services.search_sessions.cancel_search_job', new_callable=AsyncMock)
        self.cancel_mock = self.cancel.start()
        self.addCleanup(self.cancel.stop)

    def event(self, method, correlation='c1', result=None):
        return PipeEnvelope(method=method, params={'searchId': correlation, 'jobId': correlation, 'root': '/project', 'correlationId': correlation, 'result': result})

    async def test_early_events_are_forwarded_without_retaining_diff_bodies(self):
        async def start(method, params, **kwargs):
            self.assertEqual(method, 'search.changes.start')
            await self.manager._handle_pipe_event(self.event('search.job.result', result={'metadata': {'nextOffset': 40, 'baseHash': 'abc', 'snapshotToken': 'token', 'base': {'ref': 'abc'}}}))
            await self.manager._handle_pipe_event(self.event('search.job.result', result={'change': {'rel': 'a.py', 'hunks': ['body']}}))
            await self.manager._handle_pipe_event(self.event('search.job.done'))
            return {'searchId': 'c1', 'jobId': 'c1'}
        with patch('app.apps.code_te2.explorer.search._call_search_provider', side_effect=start):
            await self.manager.run(parse_search_run_params({'mode': 'changes', 'correlationId': 'c1'}), 'reply')
        self.assertEqual([e[0] for e in self.emitted], ['explorer.search.started', 'search.job.result', 'search.job.result', 'search.job.done'])
        session = self.manager._sessions['c1']
        self.assertTrue(session.complete)
        self.assertEqual(session.content_files, {})
        self.assertEqual(session.changes_metadata['base']['ref'], 'HEAD')
        self.assertNotIn('hunks', repr(session))
        with patch('app.apps.code_te2.explorer.search._call_search_provider', new_callable=AsyncMock, return_value={'searchId': 'c2', 'jobId': 'c2'}) as provider:
            await self.manager.run(parse_search_run_params({'mode': 'changes', 'correlationId': 'c2', 'changesOffset': 40}), 'next')
        sent = provider.call_args.args[1]
        self.assertEqual((sent['base'], sent['offset'], sent['snapshotToken']), ('abc', 40, 'token'))
        with self.assertRaisesRegex(RuntimeError, 'stale changes continuation'):
            await self.manager.run(parse_search_run_params({'mode': 'changes', 'changesOffset': 80}), None)

    async def test_cancel_during_start_releases_late_job_without_publication(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def start(*args, **kwargs):
            entered.set()
            await release.wait()
            return {'searchId': 'c1', 'jobId': 'c1'}
        with patch('app.apps.code_te2.explorer.search._call_search_provider', side_effect=start):
            task = asyncio.create_task(self.manager.run(parse_search_run_params({'mode': 'changes', 'correlationId': 'c1'}), None))
            await entered.wait()
            await self.manager.cancel_active(reason='closed')
            release.set()
            with self.assertRaisesRegex(RuntimeError, 'superseded'):
                await task
        self.assertFalse(self.emitted)
        self.assertFalse(self.manager._sessions)
        self.assertEqual(self.cancel_mock.call_args.kwargs['job_id'], 'c1')

    async def test_slow_ack_cannot_reorder_early_metadata_after_completion(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def emit(method, payload, reply_to=None):
            if method == 'explorer.search.started':
                entered.set()
                await release.wait()
            self.emitted.append((method, payload))
        self.manager._emit_personal = emit
        async def start(*args, **kwargs):
            await self.manager._handle_pipe_event(self.event('search.job.result', result={'metadata': {'total': 0}}))
            return {'searchId': 'c1', 'jobId': 'c1'}
        with patch('app.apps.code_te2.explorer.search._call_search_provider', side_effect=start):
            task = asyncio.create_task(self.manager.run(parse_search_run_params({'mode': 'changes', 'correlationId': 'c1'}), None))
            await entered.wait()
            done = asyncio.create_task(self.manager._handle_pipe_event(self.event('search.job.done')))
            await asyncio.sleep(0)
            release.set()
            await task
            await done
        self.assertEqual([e[0] for e in self.emitted], ['explorer.search.started', 'search.job.result', 'search.job.done'])
        self.assertTrue(self.manager._sessions['c1'].complete)
