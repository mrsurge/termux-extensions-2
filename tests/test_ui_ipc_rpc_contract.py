from __future__ import annotations

import unittest

from app.apps.code_te2.ui_ipc.rpc_contract import parse_ui_ipc_rpc_request


class UiIpcRpcContractTests(unittest.TestCase):
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
