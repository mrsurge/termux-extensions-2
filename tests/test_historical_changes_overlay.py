import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.explorer import search


class HistoricalChangesOverlayTests(unittest.IsolatedAsyncioTestCase):
    async def test_selected_ref_is_forwarded_to_native_changes_job(self):
        ref = 'a' * 40
        with patch.object(search, '_call_search_provider', new_callable=AsyncMock, return_value={'dto': 'SearchJobStarted'}) as provider:
            await search.start_changes_search(Path('/project'), project_generation=7, correlation_id='view', base=ref, head_view=False, offset=0, snapshot_token=None)
        method, params = provider.call_args.args
        self.assertEqual(method, 'search.changes.start')
        self.assertEqual(params['base'], ref)
        self.assertFalse(params['headView'])
        self.assertEqual(params['projectGeneration'], 7)
        self.assertEqual(params['correlationId'], 'view')
