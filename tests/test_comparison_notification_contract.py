import unittest
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.client_presentation import client_presentation_room
from app.apps.code_te2.frontend_rpc_codec import encode_frontend_rpc_message
from app.apps.code_te2.host import comparison_actions_backend as actions
from app.apps.code_te2.monaco_editor import editor_preferences_backend, editor_ws
from app.apps.code_te2.ui_ipc import notifications
from app.apps.code_te2.ui_ipc.rpc_contract import build_jsonrpc_notification
from app.apps.code_te2.ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification


class ComparisonNotificationContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_sender_preserves_bytes_rooms_sid_and_public_import(self) -> None:
        self.assertIs(emit_ui_ipc_rpc_notification, notifications.emit_ui_ipc_rpc_notification)
        sent: list[dict[str, object]] = []

        async def emit(event: str, data: object, *, namespace: str, to: str | None = None,
                       room: str | None = None, skip_sid: str | None = None) -> None:
            sent.append({'event': event, 'data': data, 'namespace': namespace,
                         'to': to, 'room': room, 'skip_sid': skip_sid})

        method = 'ui.comparison.changed'
        params: dict[str, object] = {'projectPath': '/project', 'mode': 'disk'}
        expected = encode_frontend_rpc_message(build_jsonrpc_notification(method, params), lane='ui_ipc', method=method)
        with patch.object(notifications, 'emit_code_te2_socketio', new=emit):
            await emit_ui_ipc_rpc_notification(method, params, client_instance_id='client_123456789abc', skip_sid='origin')
            await emit_ui_ipc_rpc_notification(method, params, to_sid='exact')
            await emit_ui_ipc_rpc_notification(method, params)
        self.assertEqual([item['data'] for item in sent], [expected] * 3)
        self.assertEqual(sent[0]['room'], client_presentation_room('client_123456789abc'))
        self.assertEqual(sent[0]['skip_sid'], 'origin')
        self.assertEqual(sent[1]['to'], 'exact')
        self.assertIsNone(sent[1]['room'])
        self.assertEqual(sent[2]['room'], 'ui_ipc')
        self.assertTrue(all(item['namespace'] == '/ui_ipc' for item in sent))

    async def test_moved_host_command_keeps_exact_preference_target(self) -> None:
        preference = AsyncMock(return_value={})
        with patch.object(editor_ws, 'editor_runtime_active_project', return_value='/project'), patch.object(editor_preferences_backend, 'handle_editor_preference_update_request', new=preference), patch.object(actions, 'comparison_state', return_value={'mode': 'disk'}):
            result = await actions.handle_comparison_request({'projectPath': '/project', 'mode': 'disk'}, 'client_test')
        self.assertEqual(result, {'mode': 'disk'})
        preference.assert_awaited_once_with({'key': 'comparisonMode', 'value': 'disk'}, source_client='client_test')

    async def test_moved_host_command_rejects_stale_project(self) -> None:
        preference = AsyncMock()
        with patch.object(editor_ws, 'editor_runtime_active_project', return_value='/new'), patch.object(editor_preferences_backend, 'handle_editor_preference_update_request', new=preference):
            with self.assertRaisesRegex(ValueError, 'stale_project_path'):
                _ = await actions.handle_comparison_request({'projectPath': '/old', 'mode': 'disk'}, 'client_test')
        preference.assert_not_called()
