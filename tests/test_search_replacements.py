from __future__ import annotations

from pathlib import Path
from typing import cast
import unittest
from unittest.mock import patch

from app.libs import pipe_runtime
from app.apps.code_te2.explorer.contracts.search_review import (
    ExplorerSearchReviewContractError, parse_search_replace_params,
)
from app.apps.code_te2.explorer.services import search_sessions, guarded_text_edits
from app.apps.code_te2.worker_services import text_edit_service


def payload() -> dict[str, object]:
    return {'phase': 'prepare', 'searchId': 's', 'projectGeneration': 1,
        'relativePath': 'file.py', 'matchIndexes': [1], 'replacement': ''}


class ReplacementTests(unittest.IsolatedAsyncioTestCase):
    def test_contract_rejects_ambiguous_or_unbounded_selection(self) -> None:
        self.assertEqual(parse_search_replace_params(payload())['replacement'], '')
        for key, value in [('matchIndexes', []), ('matchIndexes', [True]),
            ('matchIndexes', [1, 1]), ('matchIndexes', [700]), ('projectGeneration', True),
            ('discardDraft', 'yes'), ('phase', 'other')]:
            with self.subTest(key=key, value=value), self.assertRaises(ExplorerSearchReviewContractError):
                _ = parse_search_replace_params({**payload(), key: value})

    async def test_transport_fences_reply_identity_and_ranges(self) -> None:
        response: dict[str, object] = {'dto': 'PreparedReplaceResult', 'version': 1,
            'path': 'file.py', 'sourceSha256': 'a' * 64,
            'edits': [{'startByte': 4, 'endByte': 7, 'expectedText': 'cat', 'replacement': ''}]}

        async def call(method: str, params: object, **kwargs: object) -> object:
            self.assertEqual(method, 'fs.textEdits.prepareReplace')
            self.assertEqual(kwargs['target_nid'], 2100)
            self.assertEqual(cast(dict[str, object], params)['ranges'], [{'startByte': 4, 'endByte': 7}])
            return response

        async def prepare() -> tuple[text_edit_service.ExactEdit, ...]:
            return await text_edit_service.prepare_replacement(Path('/project'), 'file.py', 'a' * 64,
                'cat', '', ((4, 7),), is_regex=False, is_case_sensitive=True, is_whole_words=False)

        with patch.object(pipe_runtime, 'call_async', new=call):
            self.assertEqual(await prepare(), (text_edit_service.ExactEdit(4, 7, 'cat', ''),))
            response['path'] = 'other.py'
            with self.assertRaises(ValueError):
                _ = await prepare()
            response['path'] = 'file.py'
            response['edits'] = [{'startByte': 0, 'endByte': 3, 'expectedText': 'cat', 'replacement': ''}]
            with self.assertRaises(ValueError):
                _ = await prepare()

    async def test_session_prepares_only_retained_selected_hit(self) -> None:
        async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
            del method, payload, reply_to

        manager = search_sessions.ExplorerSearchSessions(get_project_root=lambda: Path('/project'), emit_personal=emit)
        session = search_sessions.SearchSession(search_id='s', job_id='j', kind='content',
            root=Path('/project'), project_generation=1, correlation_id='c', query='cat')
        session.content_files['file.py'] = search_sessions.CachedContentFile(path='/project/file.py', relative_path='file.py',
            matches=[search_sessions.CachedContentMatch(line=1, column=start, text='cat cat', snippet='cat cat', match_text='cat',
                edit_target={'sourceSha256': 'a' * 64, 'startByte': start, 'endByte': start + 3}) for start in (0, 4)])
        calls: list[tuple[tuple[int, int], ...]] = []
        alive = True
        supersede_on_read = False

        def resolve(search_id: str, generation: int | None) -> search_sessions.SearchSession:
            self.assertEqual((search_id, generation), ('s', 1))
            if not alive:
                raise ValueError('superseded')
            return session

        async def prepare(project: Path, path: str, source: str, query: str, replacement: str,
            ranges: tuple[tuple[int, int], ...], **kwargs: object) -> tuple[text_edit_service.ExactEdit, ...]:
            nonlocal alive
            self.assertEqual((project, path, source, query, replacement), (Path('/project'), 'file.py', 'a' * 64, 'cat', ''))
            self.assertFalse(kwargs['is_regex'])
            calls.append(ranges)
            if supersede_on_read:
                alive = False
            return (text_edit_service.ExactEdit(4, 7, 'cat', ''),)

        def consent(project: Path, client: str, path: str, source: str,
            edits: tuple[text_edit_service.ExactEdit, ...]) -> dict[str, object]:
            self.assertEqual((project, client, path, source, edits[0].start_byte), (Path('/project'), 'client', 'file.py', 'a' * 64, 4))
            return {'token': 't', 'hasDraft': True}

        with patch.object(manager, '_session_for_request', new=resolve), patch.object(text_edit_service, 'prepare_replacement', new=prepare), patch.object(guarded_text_edits, 'prepare', new=consent):
            result = await manager.replace(parse_search_replace_params(payload()), 'client')
            self.assertTrue(result['hasDraft'])
            self.assertEqual(calls, [((4, 7),)])
            retained = session.content_files['file.py'].matches[1]
            session.content_files['file.py'].matches[1] = search_sessions.CachedContentMatch(line=1, column=4, text='cat', snippet='cat', match_text='cat')
            with self.assertRaisesRegex(ValueError, 'display-only'):
                _ = await manager.replace(parse_search_replace_params(payload()), 'client')
            session.content_files['file.py'].matches[1] = retained
            supersede_on_read = True
            with self.assertRaisesRegex(ValueError, 'superseded'):
                _ = await manager.replace(parse_search_replace_params(payload()), 'client')
