from __future__ import annotations

import asyncio
import os
from contextlib import ExitStack
from pathlib import Path
import tempfile
from typing import final, cast
import unittest
from unittest.mock import patch

from app.libs import pipe_runtime
from app.libs.pipe_protocol import PipeEnvelope
from app.apps.code_te2.worker_services import git_push_completion as completion
from app.apps.code_te2.worker_services import git_service
from app.apps.code_te2.worker_services.git_service import GitSnapshot
from app.apps.code_te2.worker_services.event_bus import WorkerEvent
from app.apps.code_te2.worker_services.latest_projection import LatestProjection
from app.apps.code_te2.explorer.services import runtime_notifications, git_comparison
from app.apps.code_te2.history_store import HistoryStore
from app.apps.code_te2.explorer.transport.connection_manager import manager

PROJECT = '/workspace/project'


def envelope(status: str = 'succeeded', *, root: str = PROJECT, generation: int = 7) -> PipeEnvelope:
    return PipeEnvelope(kind='notification', method='git.job.progress',
        workspace_root=root, project_generation=generation, params={
            'dto': 'GitJobProgress', 'version': 1, 'type': 'git_push', 'operation': 'push',
            'status': status, 'root': root, 'projectGeneration': generation,
        })


@final
class PushCompletionTests(unittest.IsolatedAsyncioTestCase):
    def __init__(self, methodName: str = 'runTest') -> None:
        super().__init__(methodName)
        self.stack = ExitStack()
        self.dirty: list[Path] = []
        self.scheduled: list[tuple[str, int | None, bool]] = []
        self.facts: list[WorkerEvent] = []
        self.history: HistoryStore | None = None

    def setUp(self) -> None:
        self.addCleanup(self.stack.close)
        self.addCleanup(completion.stop_git_push_completion_bridge)
        self.stack.enter_context(patch.object(completion, 'current_project_generation', new=self.generation))
        self.stack.enter_context(patch.object(completion, 'mark_status_cache_dirty', new=self.mark_dirty))
        self.stack.enter_context(patch.object(completion, 'schedule_git_status_update', new=self.schedule))

    def generation(self, root: str | Path | None = None) -> int | None:
        return 7 if str(root) == PROJECT else None

    def mark_dirty(self, project: Path | None = None) -> None:
        assert project is not None
        self.dirty.append(project)

    def schedule(self, project: str | Path, *, project_generation: int | None = None,
                 source: str = '', delay: float = 0.1, require_connection: bool = True,
                 selection_revision: str | None = None) -> None:
        self.assertEqual(source, 'git_push:completed')
        self.assertEqual(delay, 0.0)
        self.scheduled.append((str(project), project_generation, require_connection))

    async def test_real_pipe_ingress_refreshes_without_any_explorer_connection(self) -> None:
        loop = asyncio.get_running_loop()
        completion.start_git_push_completion_bridge(loop)
        completion.start_git_push_completion_bridge(loop)
        pipe_runtime.accept_notification(envelope())
        await asyncio.sleep(0)
        assert self.scheduled == [(PROJECT, 7, False)]
        assert self.dirty == [Path(PROJECT)]

    async def test_running_failed_and_cancelled_jobs_never_refresh(self) -> None:
        completion.start_git_push_completion_bridge(asyncio.get_running_loop())
        for status in ('running', 'failed', 'cancelled'):
            pipe_runtime.accept_notification(envelope(status))
        await asyncio.sleep(0)
        self.assertFalse(self.scheduled)
        self.assertFalse(self.dirty)

    async def test_project_switch_invalidates_original_cache_without_retargeting_refresh(self) -> None:
        completion.start_git_push_completion_bridge(asyncio.get_running_loop())
        pipe_runtime.accept_notification(envelope(generation=6))
        pipe_runtime.accept_notification(envelope(root='/workspace/previous'))
        await asyncio.sleep(0)
        self.assertFalse(self.scheduled)
        assert self.dirty == [Path(PROJECT), Path('/workspace/previous')]

    async def test_shutdown_removes_listener_and_fences_queued_callbacks(self) -> None:
        completion.start_git_push_completion_bridge(asyncio.get_running_loop())
        pipe_runtime.accept_notification(envelope())
        completion.stop_git_push_completion_bridge()
        await asyncio.sleep(0)
        self.assertFalse(self.scheduled)
        self.assertFalse(self.dirty)

    async def test_nested_workspace_uses_original_project_not_repository_root(self) -> None:
        item = envelope(root='/workspace')
        item.workspace_root = PROJECT
        completion.start_git_push_completion_bridge(asyncio.get_running_loop())
        pipe_runtime.accept_notification(item)
        await asyncio.sleep(0)
        assert self.dirty == [Path('/workspace'), Path(PROJECT)]
        assert self.scheduled == [(PROJECT, 7, False)]

    def test_malformed_or_mismatched_envelopes_are_rejected(self) -> None:
        wrong_generation = envelope()
        wrong_generation.project_generation = 8
        wrong_root = envelope()
        wrong_root.workspace_root = '/different/project'
        for item in (wrong_generation, wrong_root, PipeEnvelope(), envelope(root='relative')):
            self.assertIsNone(completion.parse_push_completion(item))

    def read_snapshot(self, project: Path, *, project_generation: int | None = None) -> GitSnapshot:
        self.assertIn(project, self.dirty)
        return {'dto': 'GitSnapshot', 'version': 1, 'root': PROJECT, 'projectPath': PROJECT,
            'projectGeneration': project_generation, 'isRepository': True, 'hasHead': True,
            'branch': 'main', 'detached': False, 'head': {'full': 'a' * 40, 'short': 'a' * 7},
            'ahead': 0, 'behind': 0, 'staged': [], 'unstaged': ['vendor/submodule'],
            'untracked': [], 'statuses': {'vendor/submodule': 'modified'}}

    def diff_base(self, project: Path, ref: str, snapshot: GitSnapshot) -> dict[str, object]:
        return {}

    def install_comparison(self, project: Path, comparison: git_comparison.Comparison) -> None:
        pass

    def get_history(self) -> HistoryStore:
        assert self.history is not None
        return self.history

    async def publish(self, event: WorkerEvent) -> None:
        self.facts.append(event)

    async def test_completion_publishes_fresh_ahead_state_even_with_dirty_submodule(self) -> None:
        scratch = Path(os.environ.get('TMPDIR') or Path(__file__).resolve().parents[1] / '.codex-scratch')
        scratch.mkdir(parents=True, exist_ok=True)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory(dir=scratch))
        self.history = HistoryStore(Path(directory) / 'history.json')
        projection = LatestProjection('push-completion-test')
        self.stack.enter_context(patch.object(completion, 'schedule_git_status_update', new=runtime_notifications.schedule_git_status_update))
        self.stack.enter_context(patch.object(runtime_notifications, '_git_projection', new=projection))
        self.stack.enter_context(patch.object(runtime_notifications, 'current_project_generation', new=self.generation))
        self.stack.enter_context(patch.object(runtime_notifications, 'mark_git_cache_dirty', new=self.mark_dirty))
        self.stack.enter_context(patch.object(git_service, 'get_snapshot', new=self.read_snapshot))
        self.stack.enter_context(patch.object(runtime_notifications, 'project_diff_base', new=self.diff_base))
        self.stack.enter_context(patch.object(runtime_notifications, 'get_history_store', new=self.get_history))
        self.stack.enter_context(patch.object(git_comparison, 'install', new=self.install_comparison))
        self.stack.enter_context(patch.object(runtime_notifications, 'publish_worker_event', new=self.publish))
        self.stack.enter_context(patch.object(manager, 'has_connections', return_value=False))
        runtime_notifications.set_explorer_event_loop(asyncio.get_running_loop())
        try:
            completion.start_git_push_completion_bridge(asyncio.get_running_loop())
            pipe_runtime.accept_notification(envelope())
            await asyncio.sleep(0)
            await projection.wait_idle()
        finally:
            runtime_notifications.set_explorer_event_loop(None)
        self.assertEqual(len(self.facts), 1)
        fact = self.facts[0]
        self.assertEqual(fact['type'], 'GitSnapshotChanged')
        status = fact['payload']['status']
        assert isinstance(status, dict)
        status_record = cast(dict[object, object], status)
        self.assertEqual(status_record.get('ahead'), 0)
        assert status_record.get('unstaged') == ['vendor/submodule']
