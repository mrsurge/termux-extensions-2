# pyright: basic
from __future__ import annotations

import copy
import unittest
from typing import cast
from unittest.mock import patch

from app.apps.code_te2.ui_ipc import sidebar_window_state


class _FakePreferencesStore:
    def __init__(self, sidebar_state: dict[str, object]) -> None:
        self.data: dict[str, object] = {
            "ui": {"sidebarWindowState": copy.deepcopy(sidebar_state)}
        }
        self.update_count = 0

    def get_preferences(self) -> dict[str, object]:
        return copy.deepcopy(self.data)

    def update_preferences(
        self,
        *,
        ui: dict[str, object] | None = None,
        **_kwargs: object,
    ) -> dict[str, object]:
        if ui:
            ui_store = self.data.setdefault("ui", {})
            assert isinstance(ui_store, dict)
            ui_store.update(copy.deepcopy(ui))
            self.update_count += 1
        return copy.deepcopy(self.data)


def _url_slot(host_id: str) -> dict[str, object]:
    return {
        "kind": "url",
        "host_id": host_id,
        "hostId": host_id,
        "title": host_id,
        "label": host_id,
        "url": f"http://127.0.0.1/{host_id}",
        "restore_url": f"http://127.0.0.1/{host_id}",
        "state_kind": "url",
        "query_state": {"url": f"http://127.0.0.1/{host_id}"},
    }


def _legacy_code_te2_slot() -> dict[str, object]:
    return {
        "kind": "app",
        "app_id": "file_editor_cm6",
        "host_id": "slot:file_editor_cm6:primary",
        "base_url": "/app/file_editor_cm6",
        "url": "/app/file_editor_cm6?embed=1",
        "restore_url": "/app/file_editor_cm6?embed=1#editor",
        "token_id": "file_editor_cm6",
        "console_worker_id": "file_editor_cm6:primary",
        "console_worker_prefix": "file_editor_cm6",
        "stateful": True,
        "readiness": {"status": "ready"},
    }


class SidebarWindowLedgerTests(unittest.TestCase):
    def test_legacy_code_te2_slot_identity_is_migrated_once(self) -> None:
        store = _FakePreferencesStore(
            {
                "version": 2,
                "slots": {
                    "slot:file_editor_cm6:primary": _legacy_code_te2_slot(),
                },
            }
        )
        with patch.object(
            sidebar_window_state,
            "get_preferences_store",
            return_value=store,
        ):
            first = sidebar_window_state._load_pref_state()
            second = sidebar_window_state._load_pref_state()

        slots = cast(dict[str, object], first["slots"])
        self.assertEqual({"slot:code_te2:primary"}, set(slots))
        slot = cast(dict[str, object], slots["slot:code_te2:primary"])
        self.assertEqual("code_te2", slot["app_id"])
        self.assertEqual("/app/code_te2", slot["base_url"])
        self.assertEqual("/app/code_te2?embed=1", slot["url"])
        self.assertEqual("/app/code_te2?embed=1#editor", slot["restore_url"])
        self.assertEqual(first["slots"], second["slots"])
        self.assertEqual(1, store.update_count)
        self.assertNotIn("file_editor_cm6", repr(store.data))

    def test_legacy_presentation_fields_are_not_projected_or_resaved(self) -> None:
        store = _FakePreferencesStore(
            {
                "version": 1,
                "active_host_id": "beta",
                "order": ["launcher", "beta", "alpha"],
                "slots": {
                    "alpha": _url_slot("alpha"),
                    "beta": _url_slot("beta"),
                },
            }
        )
        with (
            patch.object(sidebar_window_state, "get_preferences_store", return_value=store),
            patch.object(sidebar_window_state, "list_launcher_apps", return_value=[]),
        ):
            projected = sidebar_window_state.get_sidebar_window_state()
            saved = sidebar_window_state._save_pref_state(
                sidebar_window_state._load_pref_state()
            )

        self.assertEqual(2, projected["version"])
        self.assertNotIn("active_host_id", projected)
        self.assertNotIn("activeHostId", projected)
        self.assertNotIn("order", projected)
        projected_slots = cast(dict[str, object], projected["slots"])
        self.assertEqual({"alpha", "beta"}, set(projected_slots))
        self.assertNotIn("active_host_id", saved)
        self.assertNotIn("order", saved)

    def test_activation_validates_membership_without_writing_preferences(self) -> None:
        store = _FakePreferencesStore(
            {"version": 2, "slots": {"alpha": _url_slot("alpha")}}
        )
        with (
            patch.object(sidebar_window_state, "get_preferences_store", return_value=store),
            patch.object(sidebar_window_state, "list_launcher_apps", return_value=[]),
        ):
            result = sidebar_window_state.activate_sidebar_window(
                {"host_id": "alpha"}
            )
            with self.assertRaisesRegex(ValueError, "unknown sidebar window"):
                sidebar_window_state.activate_sidebar_window(
                    {"host_id": "missing"}
                )

        self.assertTrue(result["ok"])
        self.assertEqual(0, store.update_count)

    def test_close_removes_only_ledger_membership(self) -> None:
        store = _FakePreferencesStore(
            {
                "version": 2,
                "slots": {
                    "alpha": _url_slot("alpha"),
                    "beta": _url_slot("beta"),
                },
            }
        )
        with (
            patch.object(sidebar_window_state, "get_preferences_store", return_value=store),
            patch.object(sidebar_window_state, "list_launcher_apps", return_value=[]),
        ):
            result = sidebar_window_state.close_sidebar_window(
                {"host_id": "alpha"}
            )

        state = cast(dict[str, object], result["state"])
        slots = cast(dict[str, object], state["slots"])
        self.assertEqual({"beta"}, set(slots))
        self.assertNotIn("activeHostId", state)
        self.assertNotIn("order", state)

    def test_extension_webview_surface_round_trips_as_url_slot(self) -> None:
        url = "/api/app/code_te2/services/wba/webview/vsix%3Aworkspace%3Aview"
        host_id = "vsix-webview:vsix:workspace:view"
        store = _FakePreferencesStore({"version": 2, "slots": {}})
        payload: dict[str, object] = {
            "kind": "url",
            "host_id": host_id,
            "title": "Extension View",
            "url": url,
            "icon": {"kind": "emoji", "emoji": "🧩"},
            "webviewSurface": {
                "dto": "ExtensionWebviewSurface",
                "version": 1,
                "surfaceId": "vsix:workspace:view",
                "hostId": host_id,
                "workspaceId": "workspace",
                "projectPath": "/workspace/project",
                "extensionId": "example.webview",
                "viewId": "example.view",
                "url": url,
            },
        }
        with (
            patch.object(sidebar_window_state, "get_preferences_store", return_value=store),
            patch.object(sidebar_window_state, "list_launcher_apps", return_value=[]),
        ):
            result = sidebar_window_state.create_sidebar_window(payload)

        window = cast(dict[str, object], result["window"])
        self.assertEqual({"kind": "emoji", "emoji": "🧩"}, window["icon"])
        surface = cast(dict[str, object], window["webviewSurface"])
        self.assertEqual("ExtensionWebviewSurface", surface["dto"])
        self.assertEqual("example.view", surface["viewId"])


if __name__ == "__main__":
    unittest.main()
