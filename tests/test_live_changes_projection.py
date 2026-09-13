# pyright: strict
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import final
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from app.apps.code_te2.explorer.services.search_sessions import ExplorerSearchSessions, SearchSession
from app.apps.code_te2.worker_services.event_bus import build_event


@final
class Harness(ExplorerSearchSessions):
    def activate(self, identity: str) -> SearchSession:
        session = SearchSession(identity, identity, 'changes', Path('/project'), None, identity, 'HEAD', complete=True)
        self._sessions[identity] = session
        self._active_search_id = identity
        return session

    async def changed(self, path: str) -> None:
        await self._files_changed(build_event('WorkspaceFilesChanged', project_root='/project',
            project_generation=None, source='test', payload={'changed_abs': [path]}))

    async def drain(self) -> None:
        if self._changes_task is not None:
            await self._changes_task


class LiveChangesTest(IsolatedAsyncioTestCase):
    async def test_updates_unrendered_objects_and_keeps_later_events(self) -> None:
        events: list[dict[str, object]] = []

        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del method, reply_to
            events.append(payload)

        manager = Harness(get_project_root=lambda: Path('/project'), emit_personal=emit)
        session = manager.activate('one')
        started, release = asyncio.Event(), asyncio.Event()
        calls: list[list[str]] = []

        async def refresh(_root: Path, _base: str, paths: list[str]) -> dict[str, object]:
            calls.append(paths)
            if len(calls) == 1:
                started.set()
                _ = await release.wait()
            return {'updates': [{'rel': path, 'hunks': []} for path in paths], 'removed': []}

        with patch('app.apps.code_te2.explorer.services.search_sessions.refresh_changes_paths', new=refresh):
            await manager.changed('/project/unseen.py')
            _ = await started.wait()
            await manager.changed('/project/later.py')
            release.set()
            await manager.drain()
            cached = session.changes_items['unseen.py']
            await manager.changed('/project/unseen.py')
            await manager.changed('/project/unseen.py')
            await manager.drain()
            self.assertIs(session.changes_items['unseen.py'], cached)
        self.assertEqual(calls, [['unseen.py'], ['later.py'], ['unseen.py']])
        self.assertEqual(set(session.changes_items), {'unseen.py', 'later.py'})
        self.assertEqual(len(events), 2)

    async def test_late_result_cannot_cross_session_and_outside_paths_are_ignored(self) -> None:
        events: list[dict[str, object]] = []

        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del method, reply_to
            events.append(payload)

        manager = Harness(get_project_root=lambda: Path('/project'), emit_personal=emit)
        old = manager.activate('old')
        started, release = asyncio.Event(), asyncio.Event()

        async def refresh(_root: Path, _base: str, _paths: list[str]) -> dict[str, object]:
            started.set()
            _ = await release.wait()
            return {'updates': [{'rel': 'old.py'}], 'removed': []}

        with patch('app.apps.code_te2.explorer.services.search_sessions.refresh_changes_paths', new=refresh):
            await manager.changed('/elsewhere/ignored.py')
            await manager.drain()
            self.assertFalse(started.is_set())
            await manager.changed('/project/old.py')
            _ = await started.wait()
            current = manager.activate('new')
            release.set()
            await manager.drain()
        self.assertEqual(events, [])
        self.assertEqual(old.changes_items, {})
        self.assertEqual(current.changes_items, {})

    async def test_clean_paths_remove_cached_entries(self) -> None:
        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del method, payload, reply_to

        manager = Harness(get_project_root=lambda: Path('/project'), emit_personal=emit)
        session = manager.activate('one')
        session.changes_items['clean.py'] = {'rel': 'clean.py'}

        async def refresh(_root: Path, _base: str, _paths: list[str]) -> dict[str, object]:
            return {'updates': [], 'removed': ['clean.py']}

        with patch('app.apps.code_te2.explorer.services.search_sessions.refresh_changes_paths', new=refresh):
            await manager.changed('/project/clean.py')
            await manager.drain()
        self.assertEqual(session.changes_items, {})
