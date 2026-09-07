import unittest
from pathlib import Path
from unittest.mock import patch

from app.apps.code_te2.explorer import search
from tests.selected_commit_fixtures import SearchProvider


class HistoricalChangesOverlayTests(unittest.IsolatedAsyncioTestCase):
    async def test_selected_ref_is_forwarded_to_native_changes_job(self) -> None:
        ref = 'a' * 40
        provider = SearchProvider(response={'dto': 'SearchJobStarted'})
        with patch.object(search, '_call_search_provider', new=provider):
            _ = await search.start_changes_search(Path('/project'), project_generation=7, correlation_id='view', base=ref, head_view=False, offset=0, snapshot_token=None)
        self.assertEqual(len(provider.calls), 1)
        method, params = provider.calls[0]
        self.assertEqual(method, 'search.changes.start')
        self.assertEqual(params['base'], ref)
        self.assertFalse(params['headView'])
        self.assertEqual(params['projectGeneration'], 7)
        self.assertEqual(params['correlationId'], 'view')
