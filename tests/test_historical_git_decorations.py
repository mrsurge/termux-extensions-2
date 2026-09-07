from pathlib import Path
from typing import cast
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.apps.code_te2.explorer.services import git_comparison as comparison
from app.apps.code_te2.worker_services.git_service import GitSnapshot, GitChangeEntry
from app.apps.code_te2.explorer.handlers import git


class HistoricalDecorationTests(unittest.TestCase):
    def test_actual_index_and_worktree_flags_are_independent(self):
        snapshot = cast(GitSnapshot, {
            'statuses': {'both.py': 'renamed', 'stage.py': 'added'},
            'staged': ['both.py', 'stage.py'], 'unstaged': ['both.py'],
            'untracked': ['new.py'],
        })
        self.assertEqual(comparison.actual_flags(snapshot), {
            'both.py': ['staged', 'modified'], 'stage.py': ['staged'],
            'new.py': ['modified'],
        })
        self.assertEqual(comparison.actual_statuses(snapshot)['both.py'], 'staged_modified')

    def test_historical_cache_is_ref_fenced_and_open_lookup_never_calls_git(self):
        project = Path('/project')
        comparison.install(project, comparison.Comparison('old', {'clean-at-head.py': 'modified'}))
        with patch.object(comparison, 'selected_ref', return_value='old'), patch.object(comparison.git_service, 'get_worktree_changes') as rpc:
            self.assertTrue(comparison.is_historical_change(project, 'clean-at-head.py'))
            self.assertFalse(comparison.is_historical_change(project, 'other.py'))
            rpc.assert_not_called()
        with patch.object(comparison, 'selected_ref', return_value='new'):
            self.assertEqual(comparison.cached_statuses(project), {})
            self.assertFalse(comparison.is_historical_change(project, 'clean-at-head.py'))
        with patch.object(comparison, 'selected_ref', return_value='HEAD'), patch.object(comparison.git_service, 'get_cached_statuses', return_value={'actual.py': 'staged'}):
            self.assertEqual(comparison.cached_statuses(project), {'actual.py': 'staged'})

    def test_selected_changes_are_not_head_status(self):
        changes = [GitChangeEntry('historical.py', 'M', None), GitChangeEntry('gone.py', 'D', None)]
        with patch.object(comparison.git_service, 'get_worktree_changes', return_value=changes) as rpc:
            result = comparison.compute(Path('/project'), 'old', 'a' * 40)
        self.assertEqual(result.statuses, {'historical.py': 'modified', 'gone.py': 'deleted'})
        rpc.assert_called_once_with(Path('/project'), 'a' * 40, limit=100_000)

    def test_background_mutation_rechecks_selection(self):
        action = Mock()
        with patch.object(comparison, 'selected_ref', return_value='old'):
            with self.assertRaisesRegex(ValueError, 'Return to HEAD'):
                comparison.head_action(Path('/project'), action)
        action.assert_not_called()


class HistoricalActionTests(unittest.IsolatedAsyncioTestCase):
    async def test_stage_commit_and_restore_rejected_including_bulk(self):
        context = Mock(project_root=Path('/project'))
        context.broadcast_git_status = AsyncMock()
        for handler in (git.handle_git_stage, git.handle_git_stage_all, git.handle_git_commit, git.handle_git_restore, git.handle_git_reset):
            with self.subTest(handler=handler.__name__), patch.object(comparison, 'selected_ref', return_value='old'), patch.object(git.asyncio, 'to_thread') as thread:
                with self.assertRaisesRegex(ValueError, 'Return to HEAD'):
                    await handler(context, {}, None)
                thread.assert_not_called()

    async def test_only_tree_navigation_promotes_historical_diff(self):
        from app.apps.code_te2.explorer.handlers import file_tree
        from app.apps.code_te2.monaco_editor import editor_preferences_backend
        context = Mock(project_root=Path('/project'), client_instance_id='client_test')
        emit = AsyncMock()
        preference = AsyncMock()
        with patch.object(comparison, 'is_historical_change', return_value=True) as lookup, patch.object(file_tree, '_get_emit_editor_open_from_backend', return_value=emit), patch.object(editor_preferences_backend, 'handle_editor_preference_update_request', preference):
            await file_tree.handle_editor_open(context, {'source': 'explorer_tree', 'raw_path': 'file.py'}, 'open1')
            preference.assert_awaited_once_with({'key': 'comparisonMode', 'value': 'commit'}, source_client='client_test')
            lookup.assert_called_once_with(Path('/project'), 'file.py')
            preference.reset_mock()
            await file_tree.handle_editor_open(context, {'source': 'explorer_rpc', 'raw_path': 'file.py'}, 'open2')
            preference.assert_not_called()
            self.assertEqual(emit.await_count, 2)

    async def test_projection_keeps_actual_status_and_discards_superseded_ref(self):
        from app.apps.code_te2.explorer.services import runtime_notifications as runtime
        snapshot = cast(GitSnapshot, {
            'statuses': {'actual.py': 'staged'}, 'staged': ['actual.py'], 'unstaged': [], 'untracked': [],
            'branch': 'main', 'detached': False, 'ahead': 0, 'behind': 0,
            'isRepository': True, 'hasHead': True, 'head': {'full': 'b' * 40, 'short': 'bbbbbbb'},
        })
        history = Mock()
        history.get_diff_base.return_value = 'old'
        emit = AsyncMock()
        with patch.object(runtime, 'mark_git_cache_dirty'), patch.object(runtime.worker_git_service, 'get_snapshot', return_value=snapshot), patch.object(runtime, 'get_history_store', return_value=history), patch.object(runtime, 'project_diff_base', return_value={'commit': {'hash': 'a' * 40}}), patch.object(comparison, 'compute', return_value=comparison.Comparison('old', {'historical.py': 'modified'})), patch.object(runtime, 'publish_worker_event', emit):
            await runtime.broadcast_git_status_update('/project')
            payload = emit.await_args.args[0]['payload']['decorations']
            self.assertEqual(payload['statuses'], {'actual.py': 'staged'})
            self.assertIn('historical.py', payload['nodes'])
            self.assertNotIn('historical.py', payload['actualNodes'])
            emit.reset_mock()
            history.get_diff_base.side_effect = ['old', 'new']
            with patch.object(comparison, 'install') as install:
                await runtime.broadcast_git_status_update('/project')
                install.assert_not_called()
                emit.assert_not_called()
