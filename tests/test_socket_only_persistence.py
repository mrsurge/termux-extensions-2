# pyright: strict
import ast
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.apps.code_te2.host import diagnostics_export_backend as exports
from app.apps.code_te2.host import transport_state_backend as state
from app.apps.code_te2.ui_ipc.rpc_contract import parse_ui_ipc_rpc_request

ROOT = Path(__file__).resolve().parents[1]


class FakeHistory:
    def __init__(self, root: str) -> None:
        self.root: str = root
        self.draft: dict[str, object] | None = None
        self.updated: dict[str, object] = {}

    def get_active_project(self) -> str:
        return self.root

    def get_cached_document(self, _project: str, _path: str) -> dict[str, object] | None:
        return self.draft

    def update_session_state(self, value: dict[str, object]) -> dict[str, object]:
        self.updated = value
        return value


class SocketPersistenceTests(unittest.IsolatedAsyncioTestCase):
    def test_host_methods_are_admitted(self) -> None:
        for method in ("ui.host.editorState.get", "ui.host.session.update", "ui.host.diagnostics.export"):
            self.assertIsNotNone(parse_ui_ipc_rpc_request({
                "jsonrpc": "2.0", "id": "test", "method": method, "params": {},
            }))

    def test_superseded_http_routes_are_absent(self) -> None:
        forbidden = {
            "/session_cache", "/session_state", "/preferences", "/write",
            "/review/save", "/review/discard", "/save", "/view_state",
            "/update_preference", "/set_view_settings", "/set_font_scale",
            "/check_cache", "/cache_state", "/refresh_cache_state", "/discard_draft",
            "/set_content", "/color_picker/toggle", "/read_only/set", "/minimap/mode",
            "/refresh_diffs", "/jump_to_line", "/search/open", "/debug/state",
            "/read", "/state", "/diff", "/review/list", "/edit_tracker/status",
            "/ws/read", "/ws/edit_tracker", "/ws/debug_console", "/editor/update_diffs",
        }
        for name in ("main.py", "monaco_editor/editor_backend.py"):
            tree = ast.parse((ROOT / "app/apps/code_te2" / name).read_text())
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    for decorator in node.decorator_list:
                        if isinstance(decorator, ast.Call) and decorator.args:
                            route = decorator.args[0]
                            if isinstance(route, ast.Constant):
                                self.assertNotIn(route.value, forbidden)

    def test_main_retains_only_health_and_resource_routes(self) -> None:
        # Inspect assembly without importing main: importing it installs process
        # hooks and opens the user's stores, which this contract test must not do.
        source = (ROOT / "app/apps/code_te2/main.py").read_text()
        tree = ast.parse(source)
        routes: set[tuple[str, str]] = set()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call) or not decorator.args:
                    continue
                function = decorator.func
                if not isinstance(function, ast.Attribute):
                    continue
                if not isinstance(function.value, ast.Name) or function.value.id != "code_te2_bp":
                    continue
                route = decorator.args[0]
                if isinstance(route, ast.Constant) and isinstance(route.value, str):
                    routes.add((function.attr, route.value))
        self.assertEqual(routes, {
            ("get", "/"), ("get", "/status"),
            ("get", "/static/{file_path:path}"), ("get", "/agent_icons/{name}"),
        })
        self.assertIn('register_monaco_editor_routes(code_te2_bp, "/ui")', source)
        self.assertIn("edit_tracker.set_project_root(project_root)", source)
        self.assertIn("invalidate_diff_cache(new_root)", source)
        for retired in (
            "_STATE_PAYLOAD_DEPS", "_build_state_payload", "_resolve_diff_base",
            "_get_runtime_metadata", "_expand_and_validate_path", "_get_file_meta",
            "_edit_tracker_status", "_edit_tracker_subscribe", "_collect_diff",
            "_compute_draft_diff", "_normalize_rel_path", "_json_list", "_debug_log_path",
        ):
            self.assertNotIn(retired, source)

    def test_session_update_validates_and_does_not_admit_authority_keys(self) -> None:
        history = FakeHistory("/project")
        with patch.object(state, "get_history_store", return_value=history):
            result = state.handle_session_update({"currentPath": "/project/file", "unsaved": True, "client_foregrounds": {}})
            self.assertEqual(result, {"currentPath": "/project/file", "unsaved": True})
            with self.assertRaises(ValueError):
                _ = state.handle_session_update({"unsaved": "true"})
            self.assertEqual(history.updated, result)

    async def test_export_refuses_outside_paths_and_drafts(self) -> None:
        with tempfile.TemporaryDirectory(prefix="te2-export-test-") as directory:
            history = FakeHistory(directory)
            with patch.object(exports, "get_history_store", return_value=history):
                with self.assertRaises(ValueError):
                    _ = await exports.handle_diagnostics_export(
                        {"path": "../outside.txt", "content": "", "op_id": "test"}, source_name="test",
                    )
                history.draft = {"content": "draft"}
                reply = await exports.handle_diagnostics_export(
                    {"path": "a.txt", "content": "export", "op_id": "test"}, source_name="test",
                )
                self.assertEqual(reply, {"ok": False, "error": "DRAFT_EXISTS"})
                self.assertFalse((Path(directory) / "a.txt").exists())

    async def test_directory_rpc_respects_project_containment(self) -> None:
        with tempfile.TemporaryDirectory(prefix="te2-export-dir-") as directory:
            history = FakeHistory(directory)
            with patch.object(exports, "get_history_store", return_value=history):
                reply = await exports.handle_diagnostics_export({"action": "directory"}, source_name="test")
                self.assertFalse(reply["exists"])
                reply = await exports.handle_diagnostics_export({"action": "mkdir"}, source_name="test")
                self.assertTrue(reply["exists"])

    async def test_export_writes_and_projects_without_changing_foreground(self) -> None:
        with tempfile.TemporaryDirectory(prefix="te2-export-write-") as directory:
            history = FakeHistory(directory)
            target = Path(directory) / "report.txt"
            _ = target.write_text("previous")
            target.chmod(0o640)
            with (
                patch.object(exports, "get_history_store", return_value=history),
                patch.object(exports, "push_save_ack") as ack,
                patch.object(exports, "emit_diff_changed") as diff,
                patch.object(exports, "mark_git_cache_dirty"),
                patch.object(exports, "invalidate_diff_cache"),
            ):
                reply = await exports.handle_diagnostics_export(
                    {"path": str(target), "content": "diagnostics", "op_id": "export"},
                    source_name="client-a",
                )
                self.assertTrue(reply["ok"])
                self.assertEqual(target.read_text(), "diagnostics")
                self.assertEqual(target.stat().st_mode & 0o777, 0o640)
                ack.assert_called_once()
                diff.assert_called_once()
                self.assertEqual(history.updated, {})
