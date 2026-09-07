import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.apps.code_te2.explorer import search
from app.apps.code_te2.worker_services.git_service import GitChangeEntry


class HistoricalChangesOverlayTests(unittest.TestCase):
    def test_selected_ref_drives_both_candidates_and_hunks(self):
        root = Path('/project')
        ref = 'a' * 40
        history = Mock()
        history.get_diff_base.return_value = ref
        entries = [GitChangeEntry('clean-at-head.py', 'M '), GitChangeEntry('deleted.py', 'D ')]
        with patch.object(search, 'get_history_store', return_value=history), \
             patch.object(search.worker_git_service, 'is_git_repository', return_value=True), \
             patch.object(search.worker_git_service, 'get_worktree_changes', return_value=entries) as listing, \
             patch.object(search, '_collect_diff', return_value={'summary': {'added': 1, 'deleted': 1, 'tracked': True}, 'hunks': [{'oldStart': 1}]}) as hunks, \
             patch.object(search, '_diff_base_payload', return_value={'ref': ref, 'mode': 'detached', 'commit': None}):
            result = search.search_by_changes(root)
        listing.assert_called_once_with(root, ref)
        self.assertEqual({row['rel'] for row in result['changes']}, {entry.path for entry in entries})
        self.assertTrue(all(row['hunks'] for row in result['changes']))
        self.assertEqual(hunks.call_count, 2)
        self.assertTrue(all(call.kwargs['base_ref'] == ref for call in hunks.call_args_list))
