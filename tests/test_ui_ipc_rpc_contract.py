from __future__ import annotations

import unittest

from app.apps.code_te2.ui_ipc.rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_HOST_SECOND_EDITOR_OPEN,
    parse_ui_ipc_rpc_notification,
    parse_ui_ipc_rpc_request,
)


class UiIpcRpcContractTests(unittest.TestCase):
    def test_comparison_request_and_projection_are_allowed(self):
        self.assertIsNotNone(parse_ui_ipc_rpc_request({
            'jsonrpc': '2.0', 'id': 'comparison', 'method': 'ui.host.comparison',
            'params': {'projectPath': '/project', 'mode': 'disk'},
        }))
        self.assertIsNotNone(parse_ui_ipc_rpc_notification({
            'jsonrpc': '2.0', 'method': 'ui.comparison.changed',
            'params': {'projectPath': '/project'},
        }))

    def test_second_editor_open_is_an_allowed_notification(self) -> None:
        parsed = parse_ui_ipc_rpc_notification(
            {
                "jsonrpc": "2.0",
                "method": UI_IPC_RPC_NOTIFICATION_HOST_SECOND_EDITOR_OPEN,
                "params": {
                    "projectPath": "/workspace",
                    "path": "/workspace/main.py",
                },
            }
        )

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(
            UI_IPC_RPC_NOTIFICATION_HOST_SECOND_EDITOR_OPEN,
            parsed["method"],
        )

    def test_extension_webview_dispose_is_an_allowed_request(self) -> None:
        parsed = parse_ui_ipc_rpc_request(
            {
                "jsonrpc": "2.0",
                "id": "close-panel",
                "method": "ui.host.extensionWebview.dispose",
                "params": {"surfaceId": "vsix-panel:example"},
            }
        )

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual("close-panel", parsed["request_id"])
        self.assertEqual("ui.host.extensionWebview.dispose", parsed["method"])
        self.assertEqual("vsix-panel:example", parsed["params"]["surfaceId"])


if __name__ == "__main__":
    _ = unittest.main()
