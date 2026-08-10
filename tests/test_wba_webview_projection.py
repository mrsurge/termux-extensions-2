# pyright: basic
from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.apps.code_te2 import wba_event_bridge


class WbaWebviewProjectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_snapshot_projects_membership_without_forcing_activation(self) -> None:
        project = "/workspace/project"
        surface = {
            "dto": "ExtensionWebviewSurface",
            "version": 1,
            "surfaceId": "vsix:workspace:view",
            "hostId": "vsix-webview:vsix:workspace:view",
            "workspaceId": "workspace",
            "projectPath": project,
            "extensionId": "example.webview",
            "viewId": "example.view",
            "surfaceKind": "view",
            "title": "Example View",
            "url": "/api/app/code_te2/services/wba/webview/vsix%3Aworkspace%3Aview",
            "iconUrl": "/api/app/code_te2/services/wba/webview-resource/vsix%3Aworkspace%3Aview/icon.svg",
            "retainContextWhenHidden": True,
            "viewColumn": 0,
            "htmlRevision": 2,
        }
        create = AsyncMock(return_value={"ok": True})
        close = AsyncMock(return_value={"ok": True})
        with (
            patch.object(wba_event_bridge, "_event_workspace_root", return_value=project),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_window_state.get_sidebar_window_state",
                return_value={"slots": {}},
            ),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_ws.handle_ui_sidebar_window_create_request",
                create,
            ),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_ws.handle_ui_sidebar_window_close_request",
                close,
            ),
        ):
            await wba_event_bridge.dispatch_wba_pipe_event(
                {
                    "type": "webview/snapshot",
                    "workspaceFolder": project,
                    "surfaces": [surface],
                }
            )

        create.assert_awaited_once()
        create_call = create.await_args
        self.assertIsNotNone(create_call)
        assert create_call is not None
        payload = create_call.args[0]
        self.assertFalse(payload["activate"])
        self.assertEqual("image", payload["icon"]["kind"])
        self.assertEqual(surface["iconUrl"], payload["icon"]["src"])
        self.assertEqual("ExtensionWebviewSurface", payload["webviewSurface"]["dto"])
        self.assertEqual("view", payload["webviewSurface"]["surfaceKind"])
        self.assertTrue(payload["webviewSurface"]["retainContextWhenHidden"])
        close.assert_not_awaited()

    async def test_panel_snapshot_projects_disposable_surface_identity(self) -> None:
        project = "/workspace/project"
        surface = {
            "dto": "ExtensionWebviewSurface",
            "version": 1,
            "surfaceId": "vsix-panel:workspace:jsoncrack:1",
            "hostId": "vsix-webview:vsix-panel:workspace:jsoncrack:1",
            "workspaceId": "workspace",
            "projectPath": project,
            "extensionId": "example.webview",
            "viewId": "example.panel",
            "surfaceKind": "panel",
            "title": "Example Panel",
            "url": "/api/app/code_te2/services/wba/webview/vsix-panel%3Aworkspace%3Ajsoncrack%3A1",
            "iconUrl": "",
            "retainContextWhenHidden": True,
            "viewColumn": 2,
            "htmlRevision": 1,
        }
        create = AsyncMock(return_value={"ok": True})
        with (
            patch.object(wba_event_bridge, "_event_workspace_root", return_value=project),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_window_state.get_sidebar_window_state",
                return_value={"slots": {}},
            ),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_ws.handle_ui_sidebar_window_create_request",
                create,
            ),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_ws.handle_ui_sidebar_window_close_request",
                AsyncMock(return_value={"ok": True}),
            ),
        ):
            await wba_event_bridge.dispatch_wba_pipe_event(
                {
                    "type": "webview/snapshot",
                    "workspaceFolder": project,
                    "surfaces": [surface],
                }
            )

        create_call = create.await_args
        self.assertIsNotNone(create_call)
        assert create_call is not None
        payload = create_call.args[0]
        self.assertEqual("panel", payload["webviewSurface"]["surfaceKind"])
        self.assertEqual(2, payload["webviewSurface"]["viewColumn"])
        self.assertEqual("EX", payload["icon"]["text"])

    async def test_empty_snapshot_closes_stale_workspace_surface(self) -> None:
        project = "/workspace/project"
        host_id = "vsix-webview:vsix:workspace:view"
        close = AsyncMock(return_value={"ok": True})
        with (
            patch.object(wba_event_bridge, "_event_workspace_root", return_value=project),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_window_state.get_sidebar_window_state",
                return_value={
                    "slots": {
                        host_id: {
                            "webviewSurface": {
                                "dto": "ExtensionWebviewSurface",
                                "version": 1,
                                "projectPath": project,
                            }
                        }
                    }
                },
            ),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_ws.handle_ui_sidebar_window_create_request",
                AsyncMock(return_value={"ok": True}),
            ),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_ws.handle_ui_sidebar_window_close_request",
                close,
            ),
        ):
            await wba_event_bridge.dispatch_wba_pipe_event(
                {
                    "type": "webview/snapshot",
                    "workspaceFolder": project,
                    "surfaces": [],
                }
            )

        close.assert_awaited_once()
        close_call = close.await_args
        self.assertIsNotNone(close_call)
        assert close_call is not None
        self.assertEqual(host_id, close_call.args[0]["host_id"])


if __name__ == "__main__":
    unittest.main()
