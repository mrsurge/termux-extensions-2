# pyright: strict
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.apps.code_te2.host import file_ops_backend
from app.apps.code_te2.monaco_editor.editor_backend_services.contracts import (
    EditorOpenPayload,
)
from app.apps.code_te2.open_state_backend import (
    ClientForegroundPayload,
    SidecarOpenStatePayload,
)


class _History:
    def __init__(self, root: str) -> None:
        self.root: str = root

    def get_active_project(self) -> str:
        return self.root


class HostSymbolNavigationTests(unittest.IsolatedAsyncioTestCase):
    async def _open(self, options: dict[str, object]) -> dict[str, object]:
        # Exercise both real open layers; isolate only persistence and transport.
        notifications: list[dict[str, object]] = []
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory).resolve())
            target = Path(root) / 'sample.py'
            _ = target.write_text('def sample():\n    pass\n', encoding='utf-8')

            def read_file(project: str, path: str) -> EditorOpenPayload:
                self.assertEqual(project, root)
                self.assertEqual(path, str(target))
                return {'path': path, 'content': target.read_text(encoding='utf-8'),
                        'document_revision': 1}

            def record_open(
                project: str, path: str, *, client_instance_id: str, reason: str,
            ) -> tuple[SidecarOpenStatePayload, ClientForegroundPayload]:
                self.assertEqual(client_instance_id, 'client_test')
                return ({
                    'projectPath': project, 'sidecarPath': '', 'openFile': path,
                    'openFileRel': 'sample.py', 'openFileExists': True,
                    'invalidOpenFile': None, 'revision': 1, 'reason': reason,
                    'ts': 0, 'recents': [],
                }, {
                    'projectPath': project, 'clientInstanceId': client_instance_id,
                    'path': path, 'rel': 'sample.py', 'exists': True,
                    'revision': 1, 'seededFromLegacy': False,
                    'clientRole': 'primary', 'reason': reason, 'ts': 0,
                })

            async def emit_open(
                event: str, payload: dict[str, object], *, client_instance_id: str,
            ) -> None:
                self.assertEqual(event, 'editor:open')
                self.assertEqual(client_instance_id, 'client_test')
                notifications.append(payload)

            async def emit_state(
                state: SidecarOpenStatePayload, *,
                client_foreground: ClientForegroundPayload | None = None,
                source: str | None = None, request_id: str | None = None,
            ) -> None:
                self.assertEqual(state['projectPath'], root)
                self.assertIsNotNone(client_foreground)
                self.assertEqual(source, 'client_test')
                self.assertEqual(request_id, 'symbol-test')

            with (
                patch.object(file_ops_backend, 'get_history_store', lambda: _History(root)),
                patch.object(file_ops_backend, 'editor_runtime_active_project', lambda: root),
                patch.object(file_ops_backend, 'editor_runtime_read_file_payload', read_file),
                patch.object(file_ops_backend, 'editor_runtime_record_sidecar_open_file', record_open),
                patch.object(file_ops_backend, 'editor_runtime_emit_room_event', emit_open),
                patch.object(file_ops_backend, 'editor_runtime_emit_open_state_changed', emit_state),
            ):
                result = await file_ops_backend.handle_host_open_request(
                    {'path': 'sample.py', 'request_id': 'symbol-test', **options},
                    source_name='client_test', request_prefix='inspector',
                )
            self.assertTrue(result['ok'])
            self.assertEqual(len(notifications), 1)
            return notifications[0]

    async def test_symbol_range_and_cursor_intent_reach_editor_without_focus(self) -> None:
        symbol_range = {
            'startLineNumber': 1, 'startColumn': 1,
            'endLineNumber': 2, 'endColumn': 9,
        }
        payload = await self._open({
            'line': 1, 'column': 5, 'focus': False, 'place_cursor': True,
            'symbol_range': symbol_range, 'scroll_y': 'center',
        })
        self.assertEqual(payload['symbol_range'], symbol_range)
        self.assertIs(payload['place_cursor'], True)
        self.assertIs(payload['focus'], False)
        self.assertEqual(payload['scroll_y'], 'center')
        self.assertEqual(payload['line'], 1)
        self.assertEqual(payload['column'], 5)

    async def test_invalid_navigation_is_still_validated_by_editor_service(self) -> None:
        for invalid_range in (
            {'startLineNumber': 2, 'startColumn': 1, 'endLineNumber': 1, 'endColumn': 1},
            {'startLineNumber': True, 'startColumn': 1, 'endLineNumber': 2, 'endColumn': 1},
            {'startLineNumber': 1},
        ):
            with self.subTest(symbol_range=invalid_range):
                payload = await self._open({
                    'symbol_range': invalid_range, 'place_cursor': 'true',
                    'scroll_y': 3, 'scroll_to_top': 'true', 'focus': False,
                })
                self.assertNotIn('symbol_range', payload)
                self.assertNotIn('place_cursor', payload)
                self.assertNotIn('scroll_y', payload)
                self.assertNotIn('scroll_to_top', payload)
                self.assertIs(payload['focus'], False)

    async def test_scroll_aliases_and_explicit_false_survive_host_handoff(self) -> None:
        payload = await self._open({'scrollY': 'center', 'scrollToTop': True})
        self.assertEqual(payload['scroll_y'], 'center')
        self.assertIs(payload['scroll_to_top'], True)
        payload = await self._open({'scroll_y': 'top', 'scroll_to_top': False})
        self.assertEqual(payload['scroll_y'], 'top')
        self.assertIs(payload['scroll_to_top'], False)

    async def test_regular_open_does_not_invent_symbol_or_focus_options(self) -> None:
        payload = await self._open({'unrecognized_option': 'not forwarded'})
        for key in ('symbol_range', 'place_cursor', 'focus', 'scroll_y',
                    'scroll_to_top', 'unrecognized_option'):
            self.assertNotIn(key, payload)
