"""Slow read projections must not serialize the fact dispatcher."""
from __future__ import annotations

import asyncio
from pathlib import Path
from threading import Event
import unittest
from unittest.mock import patch

from app.apps.code_te2.worker_services.latest_projection import Current, LatestProjection
from app.apps.code_te2.worker_services import event_bus
from app.apps.code_te2.worker_services.event_bus import EventType, EventHandler
from app.apps.code_te2 import workspace_events
from app.apps.code_te2.monaco_editor import editor_ws
from app.apps.code_te2.explorer.services import runtime_notifications as runtime, render_state


def capture_handlers() -> tuple[dict[EventType, EventHandler], dict[EventType, EventHandler]]:
    workspace: dict[EventType, EventHandler] = {}
    explorer: dict[EventType, EventHandler] = {}

    def subscribe_workspace(event_type: EventType, handler: EventHandler) -> None:
        workspace[event_type] = handler

    def subscribe_explorer(event_type: EventType, handler: EventHandler) -> None:
        explorer[event_type] = handler

    with patch.object(workspace_events, '_event_bus_handlers_registered', False), patch.object(
        workspace_events, 'subscribe_worker_event', subscribe_workspace
    ), patch.object(render_state, '_event_bus_handlers_registered', False), patch.object(
        render_state, 'subscribe_worker_event', subscribe_explorer
    ):
        workspace_events.register_workspace_event_bus_handlers()
        render_state.register_explorer_render_state_bus_handlers()
    return workspace, explorer


class ProjectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_single_native_read_latest_pending_and_stale_output_rejected(self) -> None:
        queue = LatestProjection('test_projection')
        started = asyncio.Event()
        release = Event()
        emitted: list[str] = []
        calls: list[str] = []

        async def slow(current: Current) -> None:
            calls.append('slow')
            started.set()
            _ = await asyncio.to_thread(release.wait)
            if current():
                emitted.append('slow')

        async def obsolete(current: Current) -> None:
            del current
            calls.append('obsolete')

        async def latest(current: Current) -> None:
            calls.append('latest')
            if current():
                emitted.append('latest')

        try:
            queue.submit(slow)
            _ = await asyncio.wait_for(started.wait(), 1)
            queue.submit(obsolete)
            queue.submit(latest)
            self.assertEqual(calls, ['slow'])
        finally:
            release.set()
            await asyncio.wait_for(queue.wait_idle(), 2)
        self.assertEqual(calls, ['slow', 'latest'])
        self.assertEqual(emitted, ['latest'])

    async def test_dispatch_and_selection_notification_do_not_wait_for_baselines(self) -> None:
        queue = LatestProjection('test_baselines')
        started = asyncio.Event()
        release = asyncio.Event()
        calls: list[str] = []
        event = event_bus.build_event('GitDiffBaseChanged', project_root='/project',
            project_generation=1, source='test', payload={'ref': 'HEAD', 'selectionRevision': 's1'})

        async def baseline(*, is_current: Current) -> bool:
            calls.append('baseline')
            started.set()
            _ = await release.wait()
            return is_current()

        async def emit(project: str | Path, method: str, payload: dict[str, object]) -> None:
            del project
            calls.append(method)
            self.assertEqual(payload['selectionRevision'], 's1')

        def schedule(*args: object, **kwargs: object) -> None:
            del args
            self.assertEqual(kwargs['selection_revision'], 's1')
            calls.append('decorations-scheduled')

        workspace, explorer = capture_handlers()
        async def unrelated(event: event_bus.WorkerEvent) -> None:
            del event
            calls.append('unrelated-delivered')

        handlers = {
            'GitDiffBaseChanged': [workspace['GitDiffBaseChanged'], explorer['GitDiffBaseChanged']],
            'WatcherErrorRaised': [unrelated],
        }
        with (
            patch.object(workspace_events, '_baseline_projection', queue),
            patch.object(workspace_events, 'current_project_generation', return_value=1),
            patch.object(editor_ws, 'broadcast_git_baselines_for_active_file', baseline),
            patch.object(render_state, '_is_stale_project_event', return_value=False),
            patch.object(render_state, 'emit_project_explorer_rpc_notification', emit),
            patch.object(runtime, 'schedule_git_status_update', schedule),
            patch.object(event_bus, '_handlers', handlers),
            patch.object(event_bus, '_queue', None),
        ):
            try:
                await asyncio.wait_for(event_bus.publish(event), 1)
                _ = await asyncio.wait_for(started.wait(), 1)
                self.assertIn('explorer.git.diffBase.updated', calls)
                self.assertFalse(release.is_set())
                await asyncio.wait_for(event_bus.publish(event_bus.build_event(
                    'WatcherErrorRaised', project_root='/project', project_generation=1, source='test',
                )), 1)
                self.assertIn('unrelated-delivered', calls)
                snapshot = event_bus.build_event('GitSnapshotChanged', project_root='/project',
                    project_generation=1, source='test', payload={'status': {'selectionOnly': True}})
                await asyncio.wait_for(workspace['GitSnapshotChanged'](snapshot), 1)
                self.assertEqual(calls.count('baseline'), 1, 'selection completion does not schedule duplicate baseline')
            finally:
                release.set()
                await queue.wait_idle()

    async def test_project_switch_fences_pending_baseline(self) -> None:
        queue = LatestProjection('test_project_switch')
        event = event_bus.build_event('GitDiffBaseChanged', project_root='/project',
            project_generation=1, source='test')
        calls: list[str] = []
        generation = 1

        def current_generation(project: str | Path | None = None) -> int:
            del project
            return generation

        async def baseline(*, is_current: Current) -> bool:
            calls.append('baseline')
            return is_current()

        with patch.object(workspace_events, '_baseline_projection', queue), patch.object(
            workspace_events, 'current_project_generation', current_generation
        ), patch.object(editor_ws, 'broadcast_git_baselines_for_active_file', baseline):
            workspace, _ = capture_handlers()
            await workspace['GitDiffBaseChanged'](event)
            generation = 2
            await queue.wait_idle()
        self.assertEqual(calls, [])

    async def test_git_projection_retains_real_changes_when_selection_supersedes(self) -> None:
        queue = LatestProjection('test_git')
        started = asyncio.Event()
        release = asyncio.Event()
        projections: list[tuple[str | None, bool]] = []

        async def broadcast(
            project: str | Path, *, project_generation: int | None = None,
            source: str = '', is_current: Current = lambda: True,
            selection_revision: str | None = None, selection_only: bool = False,
        ) -> bool:
            del project, project_generation, source
            if selection_revision == 's1':
                started.set()
                _ = await release.wait()
            if not is_current():
                return False
            projections.append((selection_revision, selection_only))
            return True

        with (
            patch.object(runtime, '_explorer_event_loop', asyncio.get_running_loop()),
            patch.object(runtime, '_git_projection', queue),
            patch.object(runtime, '_git_content_revision', 0),
            patch.object(runtime, '_git_published_content_revision', 0),
            patch.object(runtime, 'mark_git_cache_dirty'),
            patch.object(runtime, 'broadcast_git_status_update', broadcast),
        ):
            try:
                runtime.schedule_git_status_update('/project', selection_revision='s1', delay=0, require_connection=False)
                _ = await asyncio.wait_for(started.wait(), 1)
                runtime.schedule_git_status_update('/project', delay=0, require_connection=False)
                runtime.schedule_git_status_update('/project', selection_revision='s2', delay=0, require_connection=False)
                self.assertEqual(projections, [])
            finally:
                release.set()
                await queue.wait_idle()
            self.assertEqual(projections, [('s2', False)], 'worktree invalidation survives pending selection replacement')
            runtime.schedule_git_status_update('/project', selection_revision='s3', delay=0, require_connection=False)
            await queue.wait_idle()
            self.assertEqual(projections[-1], ('s3', True), 'pure selection completion is not a second search')

    async def test_invalidated_baseline_does_not_emit_after_thread_result(self) -> None:
        from app.apps.code_te2 import comparison_backend
        from app.apps.code_te2.ui_ipc import notifications

        class History:
            def get_diff_base(self, project: str) -> str:
                del project
                return 'HEAD'

        started = Event()
        release = Event()
        valid = True

        def state(project: str) -> dict[str, object]:
            started.set()
            _ = release.wait(2)
            return {'projectPath': project, 'mode': 'plain'}

        ui_events: list[str] = []

        async def ui_emit(method: str, payload: object) -> None:
            del payload
            ui_events.append(method)

        async def editor_emit(*args: object, **kwargs: object) -> None:
            del args, kwargs

        with (
            patch.object(editor_ws, '_active_project', return_value='/project'),
            patch.object(editor_ws, '_history_store', History()),
            patch.object(editor_ws, 'editor_runtime_emit_room_event', editor_emit),
            patch.object(comparison_backend, 'comparison_state', state),
            patch.object(notifications, 'emit_ui_ipc_rpc_notification', ui_emit),
        ):
            task = asyncio.create_task(editor_ws.broadcast_git_baselines_for_active_file(is_current=lambda: valid))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 1))
                valid = False
            finally:
                release.set()
                self.assertFalse(await task)
        self.assertEqual(ui_events, [])
