from __future__ import annotations

from pathlib import Path
import unittest
from typing import cast
from app.libs import pipe_runtime
from unittest.mock import patch

from app.apps.code_te2.worker_services import text_edit_service as service
from app.apps.code_te2.explorer.contracts.git import parse_git_restore_params, ExplorerGitContractError


def result() -> dict[str, object]:
    return {'dto': 'DiskEditsResult', 'version': 1, 'path': 'file.py',
            'directorySynced': True,
            'edit': {'dto': 'TextEditsResult', 'version': 1, 'content': 'new',
                     'sourceSha256': 'a' * 64, 'contentSha256': 'b' * 64,
                     'changed': True, 'appliedEdits': 1}}


class TextEditServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_hunk_rpc_requires_snapshot_identity(self) -> None:
        payload: dict[str, object] = {'phase': 'hunkPrepare', 'path': 'file.py',
            'projectPath': '/project', 'commit': 'c' * 40, 'sourceSha256': 'a' * 64, 'hunkIndex': 0}
        self.assertEqual(parse_git_restore_params(payload).get('hunkIndex'), 0)
        for key, value in [('commit', 'HEAD'), ('sourceSha256', ''), ('hunkIndex', True), ('hunkIndex', -1)]:
            with self.subTest(key=key), self.assertRaises(ExplorerGitContractError):
                _ = parse_git_restore_params({**payload, key: value})
    async def test_prepare_hunk_uses_pinned_framework_read(self) -> None:
        async def call(method: str, params: object, **kwargs: object) -> object:
            self.assertEqual(method, 'fs.textEdits.prepareHunk')
            self.assertEqual(kwargs['target_nid'], 2100)
            self.assertEqual(cast(dict[str, object], params)['commit'], 'c' * 40)
            return {'dto': 'ReverseHunkResult', 'version': 1, 'sourceSha256': 'a' * 64,
                    'baselineSha256': 'b' * 64, 'edits': [{'startByte': 0, 'endByte': 3,
                     'expectedText': 'new', 'replacement': 'old'}]}
        with patch.object(pipe_runtime, 'call_async', new=call):
            edits = await service.prepare_hunk(Path('/project'), 'file.py', 'c' * 40, 'a' * 64, 0)
        self.assertEqual(edits, (service.ExactEdit(0, 3, 'new', 'old'),))
    async def test_routes_once_without_draft_or_autosave_fields(self) -> None:
        calls: list[tuple[str, object, dict[str, object]]] = []

        async def call(method: str, params: object, **kwargs: object) -> object:
            calls.append((method, params, kwargs))
            return result()

        with patch.object(pipe_runtime, 'call_async', new=call):
            actual = await service.apply_disk_edits(Path('/project'), 'file.py', 'a' * 64,
                (service.ExactEdit(0, 3, 'old', 'new'),))
        self.assertEqual(actual.content, 'new')
        self.assertEqual(calls, [('fs.textEdits.apply',
            {'dto': 'DiskEditsRequest', 'version': 1, 'root': '/project',
             'path': 'file.py', 'expectedSha256': 'a' * 64,
             'edits': [{'startByte': 0, 'endByte': 3, 'expectedText': 'old', 'replacement': 'new'}]},
            {'target_nid': 2100, 'target_name': 'service.fs', 'workspace_root': '/project',
             'origin_name': 'code_te2.explorer.text_edits'})])

    async def test_timeout_is_not_retried(self) -> None:
        calls = 0

        async def call(method: str, params: object, **kwargs: object) -> object:
            nonlocal calls
            del method, params, kwargs
            calls += 1
            raise TimeoutError('unknown mutation outcome')

        with patch.object(pipe_runtime, 'call_async', new=call):
            with self.assertRaises(TimeoutError):
                _ = await service.apply_disk_edits(Path('/project'), 'file.py', 'a' * 64, ())
        self.assertEqual(calls, 1)

    async def decode(self, raw: object, source: str = 'a' * 64) -> service.DiskEditResult:
        async def call(method: str, params: object, **kwargs: object) -> object:
            del method, params, kwargs
            return raw
        with patch.object(pipe_runtime, 'call_async', new=call):
            return await service.apply_disk_edits(Path('/project'), 'file.py', source, ())

    async def test_invalid_contract_and_identity_rejected(self) -> None:
        for key, value in [('version', True), ('dto', 'Other'), ('path', 'other.py'),
                           ('directorySynced', 1), ('edit', None)]:
            raw = result()
            raw[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                _ = await self.decode(raw)
        with self.assertRaises(ValueError):
            _ = await self.decode(result(), 'c' * 64)

    async def test_invalid_edit_fields_rejected(self) -> None:
        for key, value in [('version', True), ('changed', 1), ('content', None),
                           ('appliedEdits', True), ('appliedEdits', -1),
                           ('contentSha256', 'invalid')]:
            raw = result()
            edit = cast(dict[str, object], raw['edit'])
            edit[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                _ = await self.decode(raw)

    async def test_post_commit_sync_failure_is_not_reported_as_failed_write(self) -> None:
        raw = result()
        raw['directorySynced'] = False
        actual = await self.decode(raw)
        self.assertTrue(actual.changed)
        self.assertFalse(actual.directory_synced)
