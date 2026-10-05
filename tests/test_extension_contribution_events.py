from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.extension_contribution_events import publish_extension_contributions_changed
from app.apps.code_te2.ui_ipc.rpc_contract import parse_ui_ipc_rpc_notification


class ContributionEventsTests(unittest.IsolatedAsyncioTestCase):
    async def test_broadcast_uses_each_owners_existing_lane(self) -> None:
        editor = AsyncMock()
        host = AsyncMock()
        with (
            patch("app.apps.code_te2.monaco_editor.editor_socketio.EDITOR_SIO.emit", editor),
            patch("app.apps.code_te2.ui_ipc.ui_ipc_ws.emit_ui_ipc_rpc_notification", host),
        ):
            await publish_extension_contributions_changed("ext_install")
        editor.assert_awaited_once_with("rpc", {
            "jsonrpc": "2.0", "method": "editor.extensions.contributionsChanged",
            "params": {"reason": "ext_install"},
        }, room="code_te2", namespace="/rpc/editor")
        host.assert_awaited_once_with("ui.extensions.contributionsChanged", {"reason": "ext_install"})
        parsed = parse_ui_ipc_rpc_notification({
            "jsonrpc": "2.0", "method": "ui.extensions.contributionsChanged",
            "params": {"reason": "ext_install"},
        })
        self.assertEqual(parsed["method"], "ui.extensions.contributionsChanged")
