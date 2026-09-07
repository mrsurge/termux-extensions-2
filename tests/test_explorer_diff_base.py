from pathlib import Path
import unittest
from unittest.mock import patch

from app.apps.code_te2.explorer.services.git_diff_base import project_diff_base
from app.apps.code_te2.worker_services.git_service import GitCommit
from tests.selected_commit_fixtures import snapshot, object_map


class DiffBaseProjectionTests(unittest.TestCase):
    def test_head_advances_but_pinned_commit_is_preserved_and_cached(self) -> None:
        first, second = 'a' * 40, 'b' * 40

        def commit(_project: Path, revision: str) -> GitCommit:
            return GitCommit(revision, revision[:7], 'subject', 'author', 'date')

        # A distinct project key isolates this cache test without touching private cache internals.
        project = Path('/selector-cache-test')
        with patch('app.apps.code_te2.worker_services.git_service.get_commit_info', side_effect=commit) as lookup:
            old = project_diff_base(project, 'HEAD', snapshot(first))
            new = project_diff_base(project, 'HEAD', snapshot(second))
            pinned = project_diff_base(project, first, snapshot(second))
            self.assertEqual(object_map(old['commit'])['hash'], first)
            self.assertEqual(object_map(new['commit'])['hash'], second)
            self.assertEqual(object_map(pinned['commit'])['hash'], first)
            self.assertEqual(pinned['ref'], first)
            self.assertEqual(lookup.call_count, 2)

    def test_unborn_head_has_no_commit(self) -> None:
        self.assertEqual(project_diff_base(Path('/p'), 'HEAD', snapshot(None)), {
            'ref': 'HEAD', 'mode': 'head', 'commit': None,
        })
