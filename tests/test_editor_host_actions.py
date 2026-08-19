from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.monaco_editor.editor_host_actions_backend import (
    handle_editor_host_action,
)
from app.apps.code_te2.monaco_editor.editor_rpc_contract import (
    EDITOR_RPC_METHOD_BLUR,
    EDITOR_RPC_METHOD_FOCUS,
    EDITOR_RPC_METHOD_HOST_SAVE,
)
from app.apps.code_te2.ui_ipc import ui_ipc_ws
from app.apps.code_te2.ui_ipc.rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_EDITOR_BLUR,
    UI_IPC_RPC_NOTIFICATION_EDITOR_FOCUS,
    UI_IPC_RPC_NOTIFICATION_EDITOR_SAVE,
)


class EditorHostActionTests(unittest.TestCase):
    def test_host_actions_target_only_the_originating_client(self) -> None:
        cases = (
            (EDITOR_RPC_METHOD_HOST_SAVE, UI_IPC_RPC_NOTIFICATION_EDITOR_SAVE),
            (EDITOR_RPC_METHOD_FOCUS, UI_IPC_RPC_NOTIFICATION_EDITOR_FOCUS),
            (EDITOR_RPC_METHOD_BLUR, UI_IPC_RPC_NOTIFICATION_EDITOR_BLUR),
        )
        for method, notification in cases:
            with self.subTest(method=method):
                emitter = AsyncMock()
                with patch.object(ui_ipc_ws, "emit_ui_ipc_rpc_notification", emitter):
                    result = asyncio.run(
                        handle_editor_host_action(
                            method,
                            {"path": "/project/file.py"},
                            source_client="client_secondary1234567890",
                        )
                    )
                self.assertEqual(result, {"ok": True})
                emitter.assert_awaited_once_with(
                    notification,
                    {"path": "/project/file.py"},
                    client_instance_id="client_secondary1234567890",
                )


if __name__ == "__main__":
    _ = unittest.main()
