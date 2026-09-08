from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import asyncio
import threading
import time
import unittest
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.explorer.services import guarded_restore as restore
from app.apps.code_te2.worker_services.git_service import GitRestorePreview
from app.apps.code_te2.worker_services import git_service
from app.apps.code_te2.restore_activity import active_paths
from app.apps.code_te2.open_state_backend import SidecarOpenStatePayload, ClientForegroundPayload
from app.apps.code_te2.explorer.contracts.git import parse_git_restore_params, ExplorerGitContractError


@dataclass
class RestoreHistory:
    project: str = '/project'
    revision: int = 1
    draft: bool = True
    cleared: bool = False

    def get_active_project(self) -> str:
        return self.project

    def get_document_revision(self, project: str, path: str) -> int:
        del project, path
        return self.revision

    def get_cached_document(self, project: str, path: str) -> dict[str, object]:
        del project, path
        return {'unsaved': self.draft}

    def clear_cached_document(self, project: str, path: str) -> bool:
        del project, path
        self.cleared = True
        self.draft = False
        return True

    def advance_document_revision(self, project: str, path: str) -> int:
        del project, path
        self.revision += 1
        return self.revision

    def remove_file(self, project: str, path: str) -> bool:
        del project, path
        return True


class GuardedRestoreTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, *, staged: bool = False, deleted: bool = False, project_result: bool = False) -> tuple[RestoreHistory, dict[str, object], list[bool]]:
        history = RestoreHistory()
        calls: list[bool] = []
        preview: GitRestorePreview = {'path': 'file.py', 'commit': 'a' * 40, 'state': 'b' * 40, 'staged': staged, 'delete': deleted}

        def mutate(project: Path, state: GitRestorePreview, *, unstage: bool = False) -> None:
            del project, state
            calls.append(unstage)
            if unstage:
                preview['staged'] = False
                preview['state'] = 'c' * 40

        _ = self.enterContext(patch.object(restore, 'get_history_store', return_value=history))
        _ = self.enterContext(patch.object(restore, 'current_project_generation', return_value=1))
        _ = self.enterContext(patch.object(restore, 'selected_ref', return_value='old'))
        def read_preview(project: Path, path: str, commit: str) -> GitRestorePreview:
            del project, path, commit
            return {**preview}
        _ = self.enterContext(patch.object(git_service, 'preview_restore', new=read_preview))
        _ = self.enterContext(patch.object(git_service, 'apply_guarded_restore', side_effect=mutate))
        if not project_result:
            _ = self.enterContext(patch.object(restore, '_project_result', new=AsyncMock()))
        _ = self.enterContext(patch.object(restore, 'publish', new=AsyncMock()))
        _ = self.enterContext(patch.object(restore, '_disk_sha', return_value='d' * 64))
        return history, await restore.prepare(Path('/project'), 'client_one', 'file.py'), calls

    def token(self, preview: dict[str, object]) -> str:
        token = preview['token']
        assert isinstance(token, str)
        return token

    async def apply(self, preview: dict[str, object], *, discard: bool = True, unstage: bool = False, client: str = 'client_one') -> dict[str, object]:
        return await restore.execute(Path('/project'), client, 'file.py', self.token(preview), unstage=unstage, discard_draft=discard)

    async def test_prepare_and_cancel_make_no_mutations(self) -> None:
        history, preview, calls = await self.scenario()
        self.assertTrue(preview['hasDraft'])
        self.assertEqual(calls, [])
        self.assertFalse(history.cleared)

    async def test_explicit_discard_and_single_use_confirmation(self) -> None:
        history, preview, calls = await self.scenario()
        result = await self.apply(preview)
        self.assertTrue(result['ok'])
        self.assertTrue(history.cleared)
        self.assertEqual(calls, [False])
        with self.assertRaisesRegex(ValueError, 'expired'):
            _ = await self.apply(preview)

    async def test_requires_explicit_discard(self) -> None:
        history, preview, calls = await self.scenario()
        with self.assertRaisesRegex(ValueError, 'draft-discard'):
            _ = await self.apply(preview, discard=False)
        self.assertFalse(history.cleared)
        self.assertEqual(calls, [])

    async def test_new_draft_invalidates_confirmation(self) -> None:
        history, preview, calls = await self.scenario()
        history.revision += 1
        with self.assertRaisesRegex(ValueError, 'Draft state changed'):
            _ = await self.apply(preview)
        self.assertEqual(calls, [])
        self.assertFalse(history.cleared)

    async def test_other_client_cannot_consume_confirmation(self) -> None:
        _, preview, calls = await self.scenario()
        with self.assertRaisesRegex(ValueError, 'target mismatch'):
            _ = await self.apply(preview, client='client_other')
        self.assertEqual(calls, [])
        _ = await self.apply(preview)

    async def test_selection_change_rejects_restore(self) -> None:
        _, preview, calls = await self.scenario()
        with patch.object(restore, 'selected_ref', return_value='HEAD'):
            with self.assertRaisesRegex(ValueError, 'comparison changed'):
                _ = await self.apply(preview)
        self.assertEqual(calls, [])

    async def test_project_change_rejects_restore(self) -> None:
        history, preview, calls = await self.scenario()
        history.project = '/new'
        with self.assertRaisesRegex(ValueError, 'Project or comparison'):
            _ = await self.apply(preview)
        self.assertEqual(calls, [])

    async def test_project_generation_change_rejects_restore(self) -> None:
        _, preview, calls = await self.scenario()
        with patch.object(restore, 'current_project_generation', return_value=2):
            with self.assertRaisesRegex(ValueError, 'Project or comparison'):
                _ = await self.apply(preview)
        self.assertEqual(calls, [])

    async def test_success_projects_exact_document_and_backend_facts(self) -> None:
        from app.apps.code_te2.monaco_editor import editor_ws
        from app.apps.code_te2.explorer.services import file_ops
        history, preview, _ = await self.scenario(project_result=True)
        emit, reload = AsyncMock(), AsyncMock(return_value=True)
        with patch.object(editor_ws, 'editor_runtime_emit_room_event', new=emit), patch.object(editor_ws, 'editor_runtime_reload_disk_content_if_active', new=reload), patch.object(editor_ws, 'editor_runtime_notify_draft_state_changed') as notify, patch.object(editor_ws, 'editor_runtime_record_save_sha') as record, patch.object(file_ops, 'mark_draft_cache_dirty'), patch.object(file_ops, 'mark_git_cache_dirty'):
            result = await self.apply(preview)
        self.assertTrue(result['ok'])
        self.assertTrue(history.cleared)
        reload.assert_awaited_once_with('/project/file.py', source='historical_restore')
        notify.assert_called_once_with('/project')
        record.assert_called_once_with('/project/file.py', 'd' * 64)
        emit.assert_awaited_once_with('editor:cache_state', {'path': '/project/file.py', 'state': 'clean', 'unsaved': False, 'reason': 'discard_external', 'document_revision': 2})

    async def test_staged_file_requires_separate_unstage(self) -> None:
        _, preview, calls = await self.scenario(staged=True)
        with self.assertRaisesRegex(ValueError, 'Unstage'):
            _ = await self.apply(preview)
        self.assertEqual(calls, [])

    async def test_deleted_or_unsupported_document_closes_shared_membership(self) -> None:
        from app.apps.code_te2.monaco_editor import editor_ws
        from app.apps.code_te2.monaco_editor.editor_backend_services.document_open_policy import DocumentOpenRejectedError
        from app.apps.code_te2.explorer.services import file_ops
        from app.apps.code_te2 import open_state_backend, open_state_events
        state: SidecarOpenStatePayload = {
            'projectPath': '/project', 'sidecarPath': '/sidecar', 'openFile': None,
            'openFileRel': None, 'openFileExists': False, 'invalidOpenFile': None,
            'revision': 2, 'reason': 'recent_file_closed', 'ts': 0, 'recents': [],
        }
        foregrounds: list[ClientForegroundPayload] = []
        for deleted in (False, True):
            with self.subTest(deleted=deleted):
                _, preview, _ = await self.scenario(deleted=deleted, project_result=True)
                reload = AsyncMock(side_effect=DocumentOpenRejectedError('/project/file.py', 'too_large'))
                closed = AsyncMock()
                with patch.object(editor_ws, 'editor_runtime_emit_room_event', new=AsyncMock()), patch.object(editor_ws, 'editor_runtime_reload_disk_content_if_active', new=reload), patch.object(editor_ws, 'editor_runtime_notify_draft_state_changed'), patch.object(editor_ws, 'editor_runtime_record_save_sha'), patch.object(file_ops, 'mark_draft_cache_dirty'), patch.object(file_ops, 'mark_git_cache_dirty'), patch.object(open_state_backend, 'remove_sidecar_recent_file', return_value=(True, state, foregrounds)) as remove, patch.object(open_state_events, 'publish_document_closed', new=closed):
                    result = await self.apply(preview)
                remove.assert_called_once_with('/project', '/project/file.py')
                closed.assert_awaited_once_with(state, closed_path='/project/file.py', affected_foregrounds=foregrounds, source='historical_restore', project_generation=1)
                self.assertEqual(result['editorClosed'], not deleted)
                if deleted:
                    reload.assert_not_awaited()

    async def test_unstage_returns_new_confirmation_without_discard(self) -> None:
        history, preview, calls = await self.scenario(staged=True)
        next_preview = await self.apply(preview, unstage=True, discard=False)
        self.assertFalse(history.cleared)
        self.assertEqual(calls, [True])
        self.assertNotEqual(preview['token'], next_preview['token'])
        self.assertFalse(next_preview['staged'])
        _ = await self.apply(next_preview)
        self.assertEqual(calls, [True, False])

    async def test_native_failure_preserves_draft(self) -> None:
        history, preview, _ = await self.scenario()
        with patch.object(git_service, 'apply_guarded_restore', side_effect=ValueError('stale disk')):
            with self.assertRaisesRegex(ValueError, 'stale disk'):
                _ = await self.apply(preview)
        self.assertFalse(history.cleared)
        self.assertEqual(active_paths, set[str]())

    async def test_concurrent_new_draft_is_never_discarded(self) -> None:
        history, preview, _ = await self.scenario()
        def mutate(project: Path, state: GitRestorePreview, *, unstage: bool = False) -> None:
            del project, state, unstage
            history.revision += 1
        with patch.object(git_service, 'apply_guarded_restore', new=mutate):
            result = await self.apply(preview)
        self.assertTrue(result['draftRetained'])
        self.assertFalse(history.cleared)

    async def test_expired_confirmation_never_mutates(self) -> None:
        _, preview, calls = await self.scenario()
        with patch.object(time, 'monotonic', return_value=time.monotonic() + 3600):
            with self.assertRaisesRegex(ValueError, 'expired'):
                _ = await self.apply(preview)
        self.assertEqual(calls, [])

    async def test_disconnect_does_not_abandon_accepted_mutation(self) -> None:
        history, preview, _ = await self.scenario()
        started, release = threading.Event(), threading.Event()
        projected = asyncio.Event()
        def mutate(project: Path, state: GitRestorePreview, *, unstage: bool = False) -> None:
            del project, state, unstage
            started.set()
            if not release.wait(3):
                raise RuntimeError('test release timeout')
        async def project_result(intent: restore.RestoreIntent, absolute: str, revision: int, newer: bool, sha: str | None) -> None:
            del intent, absolute, revision, newer, sha
            projected.set()
        with patch.object(git_service, 'apply_guarded_restore', new=mutate), patch.object(restore, '_project_result', new=project_result):
            request = asyncio.create_task(self.apply(preview))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 2))
                _ = request.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    _ = await request
                self.assertIn('/project/file.py', active_paths)
            finally:
                release.set()
            _ = await asyncio.wait_for(projected.wait(), 2)
            self.assertTrue(history.cleared)

    def test_legacy_unconfirmed_requests_are_rejected(self) -> None:
        with self.assertRaises(ExplorerGitContractError):
            _ = parse_git_restore_params({'path': 'file.py', 'commit': 'old'})
        self.assertEqual(parse_git_restore_params({'path': 'file.py', 'phase': 'prepare', 'projectPath': '/project'}).get('phase'), 'prepare')
