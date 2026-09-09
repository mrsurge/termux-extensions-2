from __future__ import annotations

import asyncio
from pathlib import Path
import unittest
import time
from typing import override
from unittest.mock import patch

from app.apps.code_te2.explorer.services import guarded_text_edits as guard
from app.apps.code_te2.restore_activity import active_paths
from app.apps.code_te2.worker_services.text_edit_service import DiskEditResult, ExactEdit
from tests.test_guarded_historical_restore import RestoreHistory


class GuardedTextEditTests(unittest.IsolatedAsyncioTestCase):
    def __init__(self, methodName: str = 'runTest') -> None:
        super().__init__(methodName)
        self.history: RestoreHistory = RestoreHistory()
        self.writes: int = 0
        self.projections: list[bool] = []

    @override
    def setUp(self) -> None:
        self.history = RestoreHistory()
        self.writes = 0
        self.projections = []
        _ = self.enterContext(patch.object(guard, 'get_history_store', return_value=self.history))
        _ = self.enterContext(patch.object(guard, 'current_project_generation', return_value=1))
        _ = self.enterContext(patch.object(guard, 'selected_ref', return_value='HEAD'))
        _ = self.enterContext(patch.object(guard, 'apply_disk_edits', new=self.write))
        _ = self.enterContext(patch.object(guard, 'project_disk_result', new=self.project))
        async def publish(event: object) -> None:
            del event
        _ = self.enterContext(patch.object(guard, 'publish', new=publish))

    async def write(self, project: Path, path: str, source: str, edits: tuple[ExactEdit, ...]) -> DiskEditResult:
        del project, edits
        self.writes += 1
        return DiskEditResult(path, 'new', source, 'b' * 64, True, 1, True)

    async def project(self, root: Path, path: str, generation: int, absolute: str,
                      revision: int, newer: bool, sha: str) -> bool:
        del root, path, generation, absolute, revision, sha
        self.projections.append(newer)
        return False

    def prepare(self, *, comparison: str | None = None) -> str:
        response = guard.prepare(Path('/project'), 'client', 'file.py', 'a' * 64,
            (ExactEdit(0, 3, 'old', 'new'),), comparison=comparison)
        token = response['token']
        assert isinstance(token, str)
        return token

    async def apply(self, token: str, *, discard: bool = True, client: str = 'client') -> dict[str, object]:
        return await guard.execute(Path('/project'), client, 'file.py', token, discard_draft=discard)

    async def test_prepare_and_denied_consent_never_mutate(self) -> None:
        token = self.prepare()
        self.assertEqual(self.writes, 0)
        with self.assertRaisesRegex(ValueError, 'Explicit'):
            _ = await self.apply(token, discard=False)
        self.assertFalse(self.history.cleared)
        self.assertEqual(self.writes, 0)

    async def test_success_clears_confirmed_draft_and_token_is_single_use(self) -> None:
        token = self.prepare()
        result = await self.apply(token)
        self.assertTrue(self.history.cleared)
        self.assertFalse(result['draftRetained'])
        self.assertEqual(self.projections, [False])
        with self.assertRaises(ValueError):
            _ = await self.apply(token)
        self.assertEqual(self.writes, 1)

    async def test_wrong_client_cannot_consume_token(self) -> None:
        token = self.prepare()
        with self.assertRaisesRegex(ValueError, 'target'):
            _ = await self.apply(token, client='other')
        _ = await self.apply(token)
        self.assertEqual(self.writes, 1)

    async def test_new_draft_before_dispatch_rejects(self) -> None:
        token = self.prepare()
        self.history.revision += 1
        with self.assertRaisesRegex(ValueError, 'Draft state'):
            _ = await self.apply(token)
        self.assertEqual(self.writes, 0)
        self.assertFalse(self.history.cleared)

    async def test_failure_preserves_draft_and_releases_slot(self) -> None:
        async def fail(*args: object) -> DiskEditResult:
            del args
            raise ValueError('stale disk')
        with patch.object(guard, 'apply_disk_edits', new=fail):
            with self.assertRaisesRegex(ValueError, 'stale disk'):
                _ = await self.apply(self.prepare())
        self.assertFalse(self.history.cleared)
        self.assertNotIn('/project/file.py', active_paths)

    async def test_noop_preserves_draft(self) -> None:
        async def noop(*args: object) -> DiskEditResult:
            del args
            return DiskEditResult('file.py', 'old', 'a' * 64, 'a' * 64, False, 0, True)
        with patch.object(guard, 'apply_disk_edits', new=noop):
            result = await self.apply(self.prepare())
        self.assertFalse(result['changed'])
        self.assertFalse(self.history.cleared)
        self.assertEqual(self.projections, [])

    async def test_new_draft_during_write_survives(self) -> None:
        async def change(project: Path, path: str, source: str, edits: tuple[ExactEdit, ...]) -> DiskEditResult:
            self.history.revision += 1
            return await self.write(project, path, source, edits)
        with patch.object(guard, 'apply_disk_edits', new=change):
            result = await self.apply(self.prepare())
        self.assertTrue(result['draftRetained'])
        self.assertFalse(self.history.cleared)
        self.assertEqual(self.projections, [True])

    async def test_comparison_is_only_a_hunk_constraint(self) -> None:
        with self.assertRaisesRegex(ValueError, 'Comparison'):
            _ = self.prepare(comparison='old')
        # Find/Replace has no Git selector dependency.
        token = self.prepare()
        with patch.object(guard, 'selected_ref', return_value='old'):
            _ = await self.apply(token)

    async def test_project_switch_rejects_before_dispatch(self) -> None:
        token = self.prepare()
        self.history.project = '/other'
        with self.assertRaisesRegex(ValueError, 'Project changed'):
            _ = await self.apply(token)
        self.assertEqual(self.writes, 0)

    async def test_expired_confirmation_rejects(self) -> None:
        token = self.prepare()
        with patch.object(time, 'monotonic', return_value=time.monotonic() + 3600):
            with self.assertRaisesRegex(ValueError, 'expired'):
                _ = await self.apply(token)
        self.assertEqual(self.writes, 0)

    async def test_project_generation_change_rejects(self) -> None:
        token = self.prepare()
        with patch.object(guard, 'current_project_generation', return_value=2):
            with self.assertRaisesRegex(ValueError, 'Project changed'):
                _ = await self.apply(token)
        self.assertEqual(self.writes, 0)

    async def test_disconnect_does_not_cancel_accepted_write(self) -> None:
        started, release, projected = asyncio.Event(), asyncio.Event(), asyncio.Event()
        async def waiting(project: Path, path: str, source: str, edits: tuple[ExactEdit, ...]) -> DiskEditResult:
            started.set()
            _ = await release.wait()
            return await self.write(project, path, source, edits)
        async def project(*args: object) -> bool:
            del args
            projected.set()
            return False
        with patch.object(guard, 'apply_disk_edits', new=waiting), patch.object(guard, 'project_disk_result', new=project):
            task = asyncio.create_task(self.apply(self.prepare()))
            _ = await started.wait()
            _ = task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                _ = await task
            self.assertIn('/project/file.py', active_paths)
            # A second mutation cannot take over the same path during disconnect.
            with self.assertRaisesRegex(ValueError, 'in progress'):
                _ = await self.apply(self.prepare())
            release.set()
            _ = await asyncio.wait_for(projected.wait(), timeout=2)
        self.assertTrue(self.history.cleared)
        self.assertNotIn('/project/file.py', active_paths)

    def test_invalid_paths_are_rejected(self) -> None:
        for path in ('../file.py', '/file.py', '.git/config', './file.py', 'a//b'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                _ = guard.prepare(Path('/project'), 'client', path, 'a' * 64, ())
