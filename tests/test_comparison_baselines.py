import unittest
from unittest.mock import patch
from pathlib import Path
from typing import override
from app.apps.code_te2 import comparison_backend as comparison
from app.apps.code_te2.worker_services import git_service
from app.apps.code_te2.worker_services.git_service import GitCommit
from tests.selected_commit_fixtures import History, Preferences, snapshot


def noop(*args: object, **kwargs: object) -> None:
    del args, kwargs


def empty_diff(_root: Path, _path: str, _base: str) -> dict[str, object]:
    return {}


class ComparisonBaselineTests(unittest.TestCase):
    def __init__(self, methodName: str = 'runTest') -> None:
        super().__init__(methodName)
        self.preferences: Preferences = Preferences()
        self.history: History = History(ref='older')

    @override
    def setUp(self) -> None:
        for name, value in [('get_history_store', self.history), ('get_preferences_store', self.preferences)]:
            patcher = patch.object(comparison, name, return_value=value)
            _ = patcher.start()
            self.addCleanup(patcher.stop)

    def test_disk_does_not_read_git_and_preserves_disk_text(self) -> None:
        self.preferences.editor.update(showDraftDiffs=True)
        with patch.object(git_service, 'get_snapshot') as lookup, patch.object(git_service, 'get_commit_info') as info, patch.object(git_service, 'read_head_blob_text') as blob:
            payload = comparison.selected_baseline('/project', '/project/file.py', lambda _: 'disk\r\nπ')
        lookup.assert_not_called()
        info.assert_not_called()
        blob.assert_not_called()
        self.assertEqual(payload['comparison_mode'], 'disk')
        self.assertEqual(payload['disk_content'], 'disk\r\nπ')
        self.assertIsNone(payload['head_content'])
        self.assertIsNone(payload['base_ref'])

    def test_commit_resolves_ref_once_and_reads_exact_object(self) -> None:
        commit = GitCommit('a' * 40, 'aaaaaaa', 'old', 'author', '')
        with patch.object(git_service, 'get_snapshot', return_value=snapshot()), patch.object(git_service, 'get_commit_info', return_value=commit) as info, patch.object(git_service, 'read_head_blob_text', return_value='old text') as blob:
            payload = comparison.selected_baseline('/project', '/project/file.py', lambda _: 'new text')
        info.assert_called_once_with(Path('/project'), 'older')
        blob.assert_called_once_with(Path('/project'), 'file.py', rev=commit.hash)
        self.assertEqual(payload['head_content'], 'old text')
        self.assertEqual(payload['base_commit'], commit.hash)

    def test_selection_change_during_read_rejects_old_result(self) -> None:
        self.preferences.editor.update(showDraftDiffs=True)
        def read(_path: str) -> str:
            self.history.ref = 'HEAD'
            return 'disk'
        with self.assertRaisesRegex(ValueError, 'stale_comparison'):
            _ = comparison.selected_baseline('/project', '/project/file.py', read)

    def test_unborn_repository_has_empty_commit_baseline(self) -> None:
        with patch.object(git_service, 'get_snapshot', return_value=snapshot(None)), patch.object(git_service, 'get_commit_info') as info:
            payload = comparison.selected_baseline('/project', '/project/file.py', lambda _: 'new file')
        info.assert_not_called()
        self.assertFalse(payload['tracked'])
        self.assertIsNone(payload['head_content'])


class ComparisonPreferenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_disk_mode_updates_all_flags_in_one_store_transaction(self) -> None:
        from app.apps.code_te2.monaco_editor.editor_backend_services.preferences_routes_service import handle_update_preference
        store = Preferences(editor={})
        _ = await handle_update_preference(
            {'key': 'comparisonMode', 'value': 'disk'}, editors=[],
            preferences_store=store, history_store=History(),
            get_project_root=lambda: Path('/project'), get_current_file=lambda: None,
            resolve_font_scale=lambda _: 1, normalize_rel_path=lambda _, p: p,
            collect_diff=empty_diff, current_diff_base=lambda _: 'HEAD',
            broadcast_cache_state=noop, refresh_active_diffs=noop,
            build_view_state_dict=lambda: {}, theme_map={}, emit_preferences_changed=noop,
        )
        self.assertEqual(store.updates, [{
            'showInlineDiffs': False, 'showDraftDiffs': True, 'autoSave': False,
        }])
