from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.explorer.context import ExplorerFileTreeHandlerContext
from app.apps.code_te2.explorer.handlers.file_tree import handle_open_second_window
from app.apps.code_te2.explorer.transport.rpc_contract import (
    dispatcher_message_type_from_rpc_method,
)
from app.apps.code_te2.ui_ipc.rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_HOST_SECOND_EDITOR_OPEN,
)


class ExplorerSecondWindowTests(unittest.IsolatedAsyncioTestCase):
    async def test_routes_admitted_file_to_exact_source_client(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project = Path(temp_dir).resolve()
            target = project / "src" / "main.py"
            target.parent.mkdir()
            _ = target.write_text("print('ready')\n", encoding="utf-8")
            emit_personal = AsyncMock()
            emit_ui = AsyncMock()

            class HistoryStub:
                @staticmethod
                def get_cached_document(
                    project_path: str,
                    file_path: str,
                ) -> None:
                    del project_path, file_path
                    return None

            history = HistoryStub()
            context = ExplorerFileTreeHandlerContext(
                project_root=project,
                client_instance_id="client_source123456",
                emit_personal=emit_personal,
                broadcast=AsyncMock(),
                broadcast_git_status=AsyncMock(),
                broadcast_git_decorations=AsyncMock(),
            )

            with (
                patch(
                    "app.apps.code_te2.stores.get_history_store",
                    return_value=history,
                ),
                patch(
                    "app.apps.code_te2.ui_ipc.ui_ipc_ws.emit_ui_ipc_rpc_notification",
                    emit_ui,
                ),
            ):
                await handle_open_second_window(
                    context,
                    {"rel": "src/main.py"},
                    "request-1",
                )

            emit_ui.assert_awaited_once_with(
                UI_IPC_RPC_NOTIFICATION_HOST_SECOND_EDITOR_OPEN,
                {
                    "path": str(target),
                    "projectPath": str(project),
                },
                client_instance_id="client_source123456",
            )
            emit_personal.assert_awaited_once_with(
                "explorer.editor.secondWindow.opened",
                {"ok": True, "path": str(target)},
                "request-1",
            )

    async def test_rejects_symlink_escape_before_projection(self) -> None:
        with tempfile.TemporaryDirectory() as project_dir, tempfile.TemporaryDirectory() as outside_dir:
            project = Path(project_dir).resolve()
            outside = Path(outside_dir).resolve() / "outside.py"
            _ = outside.write_text("pass\n", encoding="utf-8")
            (project / "escape.py").symlink_to(outside)
            context = ExplorerFileTreeHandlerContext(
                project_root=project,
                client_instance_id="client_source123456",
                emit_personal=AsyncMock(),
                broadcast=AsyncMock(),
                broadcast_git_status=AsyncMock(),
                broadcast_git_decorations=AsyncMock(),
            )

            with self.assertRaisesRegex(ValueError, "inside the active project"):
                await handle_open_second_window(
                    context,
                    {"rel": "escape.py"},
                    "request-2",
                )

    def test_rpc_method_has_a_dedicated_dispatch_target(self) -> None:
        self.assertEqual(
            "explorer:editor_openSecondWindow",
            dispatcher_message_type_from_rpc_method(
                "explorer.editor.openSecondWindow"
            ),
        )


if __name__ == "__main__":
    _ = unittest.main()
