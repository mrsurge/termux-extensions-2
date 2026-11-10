from __future__ import annotations

import unittest

from app.apps.code_te2.editor_renderer_bindings import EditorRendererBinding
from app.apps.code_te2.host.editor_menu_target import EditorMenuFocus, validate_editor_menu_context
from app.apps.code_te2.monaco_editor.editor_backend_services.save_service import handle_editor_save_request


class EditorMenuTargetTests(unittest.TestCase):
    def test_execution_rejects_project_generation_and_document_changes(self) -> None:
        data: dict[str, object] = {"menuProjectPath": "/project", "menuProjectGeneration": 1,
                                   "menuPath": "/project/file"}
        validate_editor_menu_context(data, project="/project", generation=1, path="/project/file")
        with self.assertRaisesRegex(ValueError, "project changed"):
            validate_editor_menu_context(data, project="/other", generation=1, path="/project/file")
        with self.assertRaisesRegex(ValueError, "project changed"):
            validate_editor_menu_context(data, project="/project", generation=2, path="/project/file")
        with self.assertRaisesRegex(ValueError, "document changed"):
            validate_editor_menu_context(data, project="/project", generation=1, path="/project/other")
        data["menuProjectGeneration"] = True
        with self.assertRaisesRegex(ValueError, "project changed"):
            validate_editor_menu_context(data, project="/project", generation=1, path="/project/file")

    def setUp(self) -> None:
        self.bindings = {
            "main-a": EditorRendererBinding("main-a", "main-a", "primary"),
            "second-a": EditorRendererBinding("second-a", "main-a", "secondary"),
            "main-b": EditorRendererBinding("main-b", "main-b", "primary"),
            "second-b": EditorRendererBinding("second-b", "main-b", "secondary"),
        }
        self.connected = set(self.bindings)
        self.focus = EditorMenuFocus(self.bindings.get, lambda: tuple(self.connected))

    def test_primary_fallback_and_each_main_page_has_its_own_focus(self) -> None:
        self.assertEqual(self.focus.select("main-a").renderer_id, "main-a")
        self.focus.record("second-a")
        self.assertEqual(self.focus.select("main-a").renderer_id, "second-a")
        self.assertEqual(self.focus.select("main-b").renderer_id, "main-b")
        self.focus.record("second-b")
        self.assertEqual(self.focus.select("main-a").renderer_id, "second-a")
        self.assertEqual(self.focus.select("main-b").renderer_id, "second-b")

    def test_primary_focus_replaces_secondary_and_secondary_own_menu_stays_local(self) -> None:
        self.focus.record("second-a")
        captured = self.focus.select("main-a")
        self.focus.record("main-a")
        self.assertEqual(self.focus.select("main-a").renderer_id, "main-a")
        self.assertEqual(self.focus.select("second-a").renderer_id, "second-a")
        self.assertEqual(captured.renderer_id, "second-a", "capture must not mutate after a dialog steals focus")

    def test_disconnected_or_unregistered_renderer_cannot_be_selected(self) -> None:
        self.focus.record("unknown")
        self.connected.remove("second-a")
        self.focus.record("second-a")
        self.assertEqual(self.focus.select("main-a").renderer_id, "main-a")
        self.connected.add("second-a")
        self.focus.record("second-a")
        self.connected.remove("second-a")
        self.assertEqual(self.focus.select("main-a").renderer_id, "main-a")

    def test_releasing_one_connection_does_not_evict_a_still_connected_identity(self) -> None:
        self.focus.record("second-a")
        self.focus.release("second-a")
        self.assertEqual(self.focus.select("main-a").renderer_id, "second-a")
        self.connected.remove("second-a")
        self.focus.release("second-a")
        self.connected.add("second-a")
        self.assertEqual(self.focus.select("main-a").renderer_id, "main-a")

    def test_changed_association_cannot_redirect_another_main_pages_menu(self) -> None:
        self.focus.record("second-a")
        self.bindings["second-a"] = EditorRendererBinding("second-a", "main-b", "secondary")
        self.assertEqual(self.focus.select("main-a").renderer_id, "main-a")

    def test_legacy_primary_identity_has_no_inferred_secondary_association(self) -> None:
        self.focus.record("second-a")
        self.assertEqual(self.focus.select("legacy-client"),
                         EditorRendererBinding("legacy-client", "legacy-client", "primary"))

    def test_execution_validates_captured_association_not_current_focus(self) -> None:
        self.focus.record("second-a")
        self.focus.record("main-a")
        self.focus.validate("main-a", "second-a")
        with self.assertRaisesRegex(ValueError, "associated"):
            self.focus.validate("main-b", "second-a")
        with self.assertRaisesRegex(ValueError, "associated"):
            self.focus.validate("second-a", "main-a")
        self.connected.remove("second-a")
        with self.assertRaisesRegex(ValueError, "disconnected"):
            self.focus.validate("main-a", "second-a")


class EditorMenuSaveAsTests(unittest.IsolatedAsyncioTestCase):
    async def test_save_as_validates_source_but_checks_destination_before_writing(self) -> None:
        async def snapshot(request_id: str) -> dict[str, object]:
            return {"path": "/project/source", "content": "edited"}

        async def emit(event: str, payload: dict[str, object]) -> None:
            self.fail("rejected save must not publish")

        for expected_path, expected_error in (("/project/source", "outside_project"),
                                                ("/project/changed", "active_file_changed")):
            result = await handle_editor_save_request(
                "menu-client", {"expected_path": expected_path, "target_path": "/outside/destination"},
                active_project=lambda: "/project", normalize_abs_path=lambda path: path,
                is_under_project=lambda root, path: path.startswith(root + "/"),
                request_snapshot=snapshot, emit_to_room=emit,
                notify_draft_state_changed=lambda path: None, record_save_sha=lambda path, sha: None,
            )
            self.assertEqual(result.get("error"), expected_error)


if __name__ == "__main__":
    unittest.main()
