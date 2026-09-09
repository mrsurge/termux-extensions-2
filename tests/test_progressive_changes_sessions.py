from __future__ import annotations

import asyncio
from pathlib import Path
from typing import override
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from app.apps.code_te2.explorer.contracts.search_review import parse_search_run_params
from app.apps.code_te2.explorer.services.search_sessions import ExplorerSearchSessions, SearchSession
from app.apps.code_te2.explorer.context import EmitPersonal
from app.libs.pipe_protocol import PipeEnvelope
from tests.selected_commit_fixtures import History, SearchProvider, object_map


class SearchHarness(ExplorerSearchSessions):
    async def receive(self, event: PipeEnvelope) -> None:
        await self._handle_pipe_event(event)

    def session(self, identity: str) -> SearchSession:
        return self._sessions[identity]

    def empty(self) -> bool:
        return not self._sessions

    def set_emitter(self, emit: EmitPersonal) -> None:
        self._emit_personal: EmitPersonal = emit


class ProgressiveChangesSessionsTest(IsolatedAsyncioTestCase):
    def __init__(self, methodName: str = 'runTest') -> None:
        super().__init__(methodName)
        self.emitted: list[tuple[str, dict[str, object]]] = []
        self.cancelled: list[str] = []
        self.manager: SearchHarness = SearchHarness(get_project_root=lambda: Path('/project'), emit_personal=self.emit)

    async def emit(self, method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
        del reply_to
        self.emitted.append((method, payload))

    @override
    async def asyncSetUp(self) -> None:
        store = patch('app.apps.code_te2.stores.get_history_store', return_value=History())
        _ = store.start()
        self.addCleanup(store.stop)

        async def cancel(*, root: Path, search_id: str, job_id: str, project_generation: int | None, reason: str) -> dict[str, object]:
            del root, search_id, project_generation, reason
            self.cancelled.append(job_id)
            return {}
        cancel_patch = patch('app.apps.code_te2.explorer.services.search_sessions.cancel_search_job', new=cancel)
        _ = cancel_patch.start()
        self.addCleanup(cancel_patch.stop)

    def event(self, method: str, correlation: str = 'c1', result: object = None) -> PipeEnvelope:
        return PipeEnvelope(method=method, params={'searchId': correlation, 'jobId': correlation, 'root': '/project', 'correlationId': correlation, 'result': result})

    async def test_early_events_are_forwarded_without_retaining_diff_bodies(self) -> None:
        async def start(method: str, _params: dict[str, object], **_kwargs: object) -> object:
            self.assertEqual(method, 'search.changes.start')
            await self.manager.receive(self.event('search.job.result', result={'metadata': {'nextOffset': 40, 'baseHash': 'abc', 'snapshotToken': 'token', 'base': {'ref': 'abc'}}}))
            await self.manager.receive(self.event('search.job.result', result={'change': {'rel': 'a.py', 'hunks': ['body']}}))
            await self.manager.receive(self.event('search.job.done'))
            return {'searchId': 'c1', 'jobId': 'c1'}
        with patch('app.apps.code_te2.explorer.search._call_search_provider', new=start):
            await self.manager.run(parse_search_run_params({'mode': 'changes', 'correlationId': 'c1'}), 'reply')
        self.assertEqual([e[0] for e in self.emitted], ['explorer.search.started', 'search.job.result', 'search.job.result', 'search.job.done'])
        session = self.manager.session('c1')
        self.assertTrue(session.complete)
        self.assertEqual(session.content_files, {})
        self.assertEqual(object_map(session.changes_metadata['base'])['ref'], 'HEAD')
        self.assertNotIn('hunks', repr(session))
        provider = SearchProvider(response={'searchId': 'c2', 'jobId': 'c2'})
        with patch('app.apps.code_te2.explorer.search._call_search_provider', new=provider):
            await self.manager.run(parse_search_run_params({'mode': 'changes', 'correlationId': 'c2', 'changesOffset': 40}), 'next')
        sent = provider.calls[0][1]
        self.assertEqual((sent['base'], sent['offset'], sent['snapshotToken']), ('abc', 40, 'token'))
        with self.assertRaisesRegex(RuntimeError, 'stale changes continuation'):
            await self.manager.run(parse_search_run_params({'mode': 'changes', 'changesOffset': 80}), None)

    async def test_discovery_metadata_can_be_completed_after_file_delivery(self) -> None:
        async def start(_method: str, _params: dict[str, object], **_kwargs: object) -> object:
            await self.manager.receive(self.event('search.job.result', result={'metadata': {'baseHash': 'abc', 'nextOffset': None}}))
            await self.manager.receive(self.event('search.job.result', result={'change': {'rel': 'first.txt', 'hunks': []}}))
            await self.manager.receive(self.event('search.job.result', result={'metadata': {'baseHash': 'abc', 'snapshotToken': 'final', 'total': 41, 'nextOffset': 40}}))
            await self.manager.receive(self.event('search.job.done'))
            return {'searchId': 'c1', 'jobId': 'c1'}
        with patch('app.apps.code_te2.explorer.search._call_search_provider', new=start):
            await self.manager.run(parse_search_run_params({'mode': 'changes', 'correlationId': 'c1'}), 'reply')
        session = self.manager.session('c1')
        self.assertEqual(session.changes_metadata['snapshotToken'], 'final')
        self.assertEqual(session.changes_metadata['nextOffset'], 40)
        self.assertEqual([e[0] for e in self.emitted], ['explorer.search.started', 'search.job.result', 'search.job.result', 'search.job.result', 'search.job.done'])

    async def test_cancel_during_start_releases_late_job_without_publication(self) -> None:
        entered, release = asyncio.Event(), asyncio.Event()
        async def start(_method: str, _params: dict[str, object], **_kwargs: object) -> object:
            entered.set()
            _ = await release.wait()
            return {'searchId': 'c1', 'jobId': 'c1'}
        with patch('app.apps.code_te2.explorer.search._call_search_provider', new=start):
            task = asyncio.create_task(self.manager.run(parse_search_run_params({'mode': 'changes', 'correlationId': 'c1'}), None))
            _ = await entered.wait()
            await self.manager.cancel_active(reason='closed')
            release.set()
            with self.assertRaisesRegex(RuntimeError, 'superseded'):
                await task
        self.assertFalse(self.emitted)
        self.assertTrue(self.manager.empty())
        self.assertEqual(self.cancelled[-1], 'c1')

    async def test_slow_ack_cannot_reorder_early_metadata_after_completion(self) -> None:
        entered, release = asyncio.Event(), asyncio.Event()
        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del reply_to
            if method == 'explorer.search.started':
                entered.set()
                _ = await release.wait()
            self.emitted.append((method, payload))
        self.manager.set_emitter(emit)
        async def start(_method: str, _params: dict[str, object], **_kwargs: object) -> object:
            await self.manager.receive(self.event('search.job.result', result={'metadata': {'total': 0}}))
            return {'searchId': 'c1', 'jobId': 'c1'}
        with patch('app.apps.code_te2.explorer.search._call_search_provider', new=start):
            task = asyncio.create_task(self.manager.run(parse_search_run_params({'mode': 'changes', 'correlationId': 'c1'}), None))
            _ = await entered.wait()
            done = asyncio.create_task(self.manager.receive(self.event('search.job.done')))
            await asyncio.sleep(0)
            release.set()
            await task
            await done
        self.assertEqual([e[0] for e in self.emitted], ['explorer.search.started', 'search.job.result', 'search.job.done'])
        self.assertTrue(self.manager.session('c1').complete)
