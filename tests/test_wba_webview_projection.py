# pyright: basic
from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, Mock, patch

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
        reconcile = Mock(
            return_value={"ok": True, "changed": True, "removed": [], "state": {"slots": {}}}
        )
        publish = AsyncMock()
        with (
            patch.object(wba_event_bridge, "_event_workspace_root", return_value=project),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_window_state.reconcile_extension_webview_slots",
                reconcile,
            ),
            patch(
                "app.apps.code_te2.sidebar_window_events.publish_sidebar_window_state_changed",
                publish,
            ),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_ws.forget_sidebar_window_runtime_state",
                Mock(),
            ),
        ):
            await wba_event_bridge.dispatch_wba_pipe_event(
                {
                    "type": "webview/snapshot",
                    "workspaceFolder": project,
                    "surfaces": [surface],
                }
            )

        reconcile.assert_called_once()
        reconcile_call = reconcile.call_args
        self.assertIsNotNone(reconcile_call)
        assert reconcile_call is not None
        self.assertEqual(project, reconcile_call.args[0])
        self.assertTrue(reconcile_call.kwargs["upsert"])
        payload = reconcile_call.args[1][surface["hostId"]]
        self.assertEqual("image", payload["icon"]["kind"])
        self.assertEqual(surface["iconUrl"], payload["icon"]["src"])
        self.assertEqual("ExtensionWebviewSurface", payload["webviewSurface"]["dto"])
        self.assertEqual("view", payload["webviewSurface"]["surfaceKind"])
        self.assertTrue(payload["webviewSurface"]["retainContextWhenHidden"])
        publish.assert_awaited_once()

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
        reconcile = Mock(
            return_value={"ok": True, "changed": True, "removed": [], "state": {"slots": {}}}
        )
        with (
            patch.object(wba_event_bridge, "_event_workspace_root", return_value=project),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_window_state.reconcile_extension_webview_slots",
                reconcile,
            ),
            patch(
                "app.apps.code_te2.sidebar_window_events.publish_sidebar_window_state_changed",
                AsyncMock(),
            ),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_ws.forget_sidebar_window_runtime_state",
                Mock(),
            ),
        ):
            await wba_event_bridge.dispatch_wba_pipe_event(
                {
                    "type": "webview/snapshot",
                    "workspaceFolder": project,
                    "surfaces": [surface],
                }
            )

        reconcile_call = reconcile.call_args
        self.assertIsNotNone(reconcile_call)
        assert reconcile_call is not None
        payload = reconcile_call.args[1][surface["hostId"]]
        self.assertEqual("panel", payload["webviewSurface"]["surfaceKind"])
        self.assertEqual(2, payload["webviewSurface"]["viewColumn"])
        self.assertEqual("EX", payload["icon"]["text"])

    async def test_empty_snapshot_closes_stale_workspace_surface(self) -> None:
        project = "/workspace/project"
        host_id = "vsix-webview:vsix:workspace:view"
        reconcile = Mock(
            return_value={
                "ok": True,
                "changed": True,
                "removed": [host_id],
                "state": {"slots": {}},
            }
        )
        forget = Mock()
        publish = AsyncMock()
        with (
            patch.object(wba_event_bridge, "_event_workspace_root", return_value=project),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_window_state.reconcile_extension_webview_slots",
                reconcile,
            ),
            patch(
                "app.apps.code_te2.sidebar_window_events.publish_sidebar_window_state_changed",
                publish,
            ),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_ws.forget_sidebar_window_runtime_state",
                forget,
            ),
        ):
            await wba_event_bridge.dispatch_wba_pipe_event(
                {
                    "type": "webview/snapshot",
                    "workspaceFolder": project,
                    "surfaces": [],
                }
            )

        reconcile.assert_called_once_with(project, {}, upsert=True)
        forget.assert_called_once_with([host_id])
        publish.assert_awaited_once()

    async def test_session_reset_snapshot_retains_membership(self) -> None:
        project = "/workspace/project"
        reconcile = Mock()
        publish = AsyncMock()
        with (
            patch.object(wba_event_bridge, "_event_workspace_root", return_value=project),
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_window_state.reconcile_extension_webview_slots",
                reconcile,
            ),
            patch(
                "app.apps.code_te2.sidebar_window_events.publish_sidebar_window_state_changed",
                publish,
            ),
        ):
            await wba_event_bridge.dispatch_wba_pipe_event(
                {
                    "type": "webview/snapshot",
                    "workspaceFolder": project,
                    "authoritative": False,
                    "reason": "disconnect",
                    "surfaces": [],
                }
            )

        reconcile.assert_not_called()
        publish.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
