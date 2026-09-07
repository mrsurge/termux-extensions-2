import unittest
from unittest.mock import Mock, patch
from pathlib import Path
from app.apps.code_te2 import comparison_backend as comparison
from app.apps.code_te2.worker_services.git_service import GitCommit


class ComparisonBaselineTests(unittest.TestCase):
    def setUp(self):
        self.prefs = {'editor': {'showInlineDiffs': True, 'showDraftDiffs': False, 'autoSave': False}}
        self.history = Mock()
        self.history.get_diff_base.return_value = 'older'
        self.preferences = Mock()
        self.preferences.get_preferences.side_effect = lambda _: self.prefs
        for name, value in [('get_history_store', self.history), ('get_preferences_store', self.preferences)]:
            patcher = patch.object(comparison, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_disk_does_not_read_git_and_preserves_disk_text(self):
        self.prefs['editor'].update(showDraftDiffs=True)
        with patch.object(comparison.git_service, 'get_snapshot') as snapshot, patch.object(comparison.git_service, 'get_commit_info') as info, patch.object(comparison.git_service, 'read_head_blob_text') as blob:
            payload = comparison.selected_baseline('/project', '/project/file.py', lambda _: 'disk\r\nπ')
        snapshot.assert_not_called()
        info.assert_not_called()
        blob.assert_not_called()
        self.assertEqual(payload['comparison_mode'], 'disk')
        self.assertEqual(payload['disk_content'], 'disk\r\nπ')
        self.assertIsNone(payload['head_content'])
        self.assertIsNone(payload['base_ref'])

    def test_commit_resolves_ref_once_and_reads_exact_object(self):
        commit = GitCommit('a' * 40, 'aaaaaaa', 'old', 'author', '')
        with patch.object(comparison.git_service, 'get_snapshot', return_value={'isRepository': True, 'head': {'full': 'b' * 40}}), patch.object(comparison.git_service, 'get_commit_info', return_value=commit) as info, patch.object(comparison.git_service, 'read_head_blob_text', return_value='old text') as blob:
            payload = comparison.selected_baseline('/project', '/project/file.py', lambda _: 'new text')
        self.assertEqual(info.call_args.args[1], 'older')
        self.assertEqual(blob.call_args.kwargs['rev'], commit.hash)
        self.assertEqual(payload['head_content'], 'old text')
        self.assertEqual(payload['base_commit'], commit.hash)

    def test_selection_change_during_read_rejects_old_result(self):
        self.prefs['editor'].update(showDraftDiffs=True)
        def read(_):
            self.history.get_diff_base.return_value = 'HEAD'
            return 'disk'
        with self.assertRaisesRegex(ValueError, 'stale_comparison'):
            comparison.selected_baseline('/project', '/project/file.py', read)

    def test_unborn_repository_has_empty_commit_baseline(self):
        with patch.object(comparison.git_service, 'get_snapshot', return_value={'isRepository': True, 'head': None}), patch.object(comparison.git_service, 'get_commit_info') as info:
            payload = comparison.selected_baseline('/project', '/project/file.py', lambda _: 'new file')
        info.assert_not_called()
        self.assertFalse(payload['tracked'])
        self.assertIsNone(payload['head_content'])


class ComparisonPreferenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_disk_mode_updates_all_flags_in_one_store_transaction(self):
        from app.apps.code_te2.monaco_editor.editor_backend_services.preferences_routes_service import handle_update_preference
        store = Mock()
        store.get_preferences.return_value = {'editor': {}}
        history = Mock()
        history.get_active_project.return_value = '/project'
        await handle_update_preference(
            {'key': 'comparisonMode', 'value': 'disk'}, editors=[],
            preferences_store=store, history_store=history,
            get_project_root=lambda: Path('/project'), get_current_file=lambda: None,
            resolve_font_scale=lambda _: 1, normalize_rel_path=lambda _, p: p,
            collect_diff=lambda *_: {}, current_diff_base=lambda _: 'HEAD',
            broadcast_cache_state=Mock(), refresh_active_diffs=Mock(),
            build_view_state_dict=lambda: {}, theme_map={}, emit_preferences_changed=Mock(),
        )
        store.update_preferences.assert_called_once_with(editor={
            'showInlineDiffs': False, 'showDraftDiffs': True, 'autoSave': False,
        })
