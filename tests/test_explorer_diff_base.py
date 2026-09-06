from pathlib import Path
import unittest
from unittest.mock import patch
from typing import cast

from app.apps.code_te2.explorer.services.git_diff_base import (
    _immutable_commit, project_diff_base,
)
from app.apps.code_te2.worker_services.git_service import GitCommit, GitSnapshot


class DiffBaseProjectionTests(unittest.TestCase):
    def test_head_advances_but_pinned_commit_is_preserved_and_cached(self):
        _immutable_commit.cache_clear()
        first, second = 'a' * 40, 'b' * 40
        def snapshot(head):
            return cast(GitSnapshot, {'isRepository': True, 'head': {'full': head}})
        def commit(_project, revision):
            return GitCommit(revision, revision[:7], 'subject', 'author', 'date')
        with patch('app.apps.code_te2.worker_services.git_service.get_commit_info', side_effect=commit) as lookup:
            old = project_diff_base(Path('/p'), 'HEAD', snapshot(first))
            new = project_diff_base(Path('/p'), 'HEAD', snapshot(second))
            pinned = project_diff_base(Path('/p'), first, snapshot(second))
            self.assertEqual(old['commit']['hash'], first)
            self.assertEqual(new['commit']['hash'], second)
            self.assertEqual(pinned['commit']['hash'], first)
            self.assertEqual(pinned['ref'], first)
            self.assertEqual(lookup.call_count, 2)

    def test_unborn_head_has_no_commit(self):
        snapshot = cast(GitSnapshot, {'isRepository': True, 'head': None})
        self.assertEqual(project_diff_base(Path('/p'), 'HEAD', snapshot), {
            'ref': 'HEAD', 'mode': 'head', 'commit': None,
        })
