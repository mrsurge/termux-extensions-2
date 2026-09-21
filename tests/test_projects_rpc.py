"""Production Projects actions use isolated stores, never the live workspace."""
# pyright: strict, reportPrivateUsage=false
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from hashlib import sha1
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.history_store import HistoryStore
from app.apps.code_te2.project_sidecar import ProjectSidecar
from app.apps.code_te2.host import projects_backend as projects
from app.apps.code_te2.ui_ipc import rpc_dispatch
from app.apps.code_te2.ui_ipc.rpc_contract import UiIpcRpcMethod, parse_ui_ipc_rpc_request


@contextmanager
def project_fixture() -> Iterator[tuple[HistoryStore, str, str]]:
    with tempfile.TemporaryDirectory(prefix="te2-projects-rpc-") as directory:
        root = Path(directory)
        active, inactive = root / "active", root / "inactive"
        for path in (active, inactive):
            path.mkdir()
            _ = (path / "keep.txt").write_text("project files are not state")

        def sidecar_path(project: str) -> Path:
            return root / "state" / (sha1(project.encode()).hexdigest() + ".json")

        with (
            patch.object(ProjectSidecar, "get_sidecar_path", side_effect=sidecar_path),
            patch.object(ProjectSidecar, "_instances", {}),
        ):
            history = HistoryStore(root / "history.json")
            _ = history.touch_project(str(active))
            _ = history.touch_project(str(inactive))
            _ = history.set_active_project(str(active))
            for path in (active, inactive):
                sidecar = ProjectSidecar.load_or_create(str(path))
                _ = sidecar.record_document_activity(str(path / "keep.txt"))
                _ = sidecar.upsert_cached_document(
                    str(path / "keep.txt"), "unsaved draft", "disk-hash",
                    "run", "shell", "shell-run", 0, 0,
                )
                _ = sidecar.set_diff_base("older-commit")
                sidecar.save()
            with patch.object(projects, "get_history_store", return_value=history):
                yield history, str(active), str(inactive)


class ProjectsRpcTests(unittest.IsolatedAsyncioTestCase):
    def test_service_imports_without_web_frameworks(self) -> None:
        # A fresh process detects accidental transitive transport dependencies.
        script = """
import importlib.abc
import sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'fastapi', 'pydantic', 'pydantic_core', 'starlette'}:
            raise ImportError('forbidden: ' + fullname)
sys.meta_path.insert(0, Block())
from app.apps.code_te2.host import projects_backend
"""
        result = subprocess.run(
            [sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1],
            capture_output=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    async def test_contract_dispatch_and_authenticated_source(self) -> None:
        cases: tuple[tuple[UiIpcRpcMethod, str], ...] = (
            ("ui.host.projects.list", "handle_projects_list"),
            ("ui.host.projects.reset", "handle_projects_reset"),
            ("ui.host.projects.remove", "handle_projects_remove"),
            ("ui.host.projects.open", "handle_projects_open"),
        )
        params: dict[str, object] = {"path": "/project"}
        for method, hook in cases:
            self.assertIsNotNone(parse_ui_ipc_rpc_request({
                "jsonrpc": "2.0", "id": "req", "method": method, "params": params,
            }))
            with patch.object(rpc_dispatch, hook, return_value={"ok": True}) as call:
                result = await rpc_dispatch.dispatch_ui_ipc_rpc_request(method, params, source_name="client-a")
                if method == "ui.host.projects.list":
                    _ = call.assert_awaited_once_with()
                else:
                    _ = call.assert_awaited_once_with(params, source_name="client-a")
            self.assertEqual(result, {"ok": True})

    async def test_list_uses_sidecar_metadata_and_preserves_project_files(self) -> None:
        with project_fixture() as (history, active, inactive):
            reply = await projects.handle_projects_list()
            self.assertTrue(reply["ok"])
            self.assertEqual(len(history.list_projects()), 2)
            self.assertIn(active, str(reply["data"]))
            self.assertIn(inactive, str(reply["data"]))
            self.assertEqual((Path(active) / "keep.txt").read_text(), "project files are not state")

    async def test_reset_clears_state_and_publishes_after_persistence(self) -> None:
        with project_fixture() as (history, active, _inactive):
            sidecar = ProjectSidecar.load_or_create(active)
            _ = sidecar.set_client_foreground("client-a", str(Path(active) / "keep.txt"))
            sidecar.add_tracked_job("job-a")
            sidecar.save()
            previous_revision = sidecar.get_open_state_revision()

            async def published(path: str, source: str) -> None:
                self.assertEqual((path, source), (active, "client-a:projects_reset"))
                disk = ProjectSidecar(active)
                self.assertEqual(disk.list_recent_files(), [])
                self.assertIsNone(disk.get_client_foreground("client-a"))
                self.assertEqual(disk.get_diff_base(), "HEAD")
                self.assertEqual(disk.get_draft_count(), 0)
                self.assertEqual(disk.list_tracked_jobs(), [])
                self.assertGreater(disk.get_open_state_revision(), previous_revision)

            notify = AsyncMock(side_effect=published)
            with patch.object(projects, "_project_reset_notifications", notify):
                result = await projects.handle_projects_reset({"path": active}, source_name="client-a")
            notify.assert_awaited_once()
            self.assertEqual(result, {"ok": True, "data": {"history_reset": True, "is_active": True}})
            self.assertEqual(history.get_active_project(), active)
            self.assertEqual(len(history.list_projects()), 2)
            self.assertTrue((Path(active) / "keep.txt").is_file())

    async def test_remove_only_inactive_sidecar_and_history_including_cached_state(self) -> None:
        with project_fixture() as (history, active, inactive):
            cached = ProjectSidecar.load_or_create(inactive)
            self.assertTrue(cached.list_recent_files())
            self.assertEqual(cached.get_draft_count(), 1)
            result = await projects.handle_projects_remove({"path": inactive}, source_name="client-a")
            self.assertTrue(result["ok"])
            self.assertFalse(ProjectSidecar.get_sidecar_path(inactive).exists())
            self.assertEqual(cached.list_recent_files(), [])
            self.assertEqual(cached.get_draft_count(), 0)
            self.assertEqual(len(history.list_projects()), 1)
            self.assertEqual(history.get_active_project(), active)
            self.assertTrue((Path(inactive) / "keep.txt").is_file())

    async def test_stale_confirmation_cannot_swap_reset_and_remove(self) -> None:
        with project_fixture() as (history, active, inactive):
            with self.assertRaisesRegex(ValueError, "now active"):
                _ = await projects.handle_projects_remove({"path": active}, source_name="client-a")
            with self.assertRaisesRegex(ValueError, "Active project changed"):
                _ = await projects.handle_projects_reset({"path": inactive}, source_name="client-a")
            self.assertEqual(len(history.list_projects()), 2)
            self.assertTrue(ProjectSidecar.load_or_create(active).list_recent_files())

    async def test_invalid_or_unknown_paths_are_rejected(self) -> None:
        with project_fixture():
            cases: tuple[dict[str, object], ...] = ({}, {"path": ""}, {"path": "/not-a-recent-project"})
            for params in cases:
                with self.assertRaises(ValueError):
                    _ = await projects.handle_projects_remove(params, source_name="client-a")

    async def test_persistence_failure_does_not_publish_or_report_success(self) -> None:
        with project_fixture() as (history, active, inactive):
            notify = AsyncMock()
            with patch.object(history, "reset_project_history", return_value=False), patch.object(projects, "_project_reset_notifications", notify):
                with self.assertRaises(RuntimeError):
                    _ = await projects.handle_projects_reset({"path": active}, source_name="client-a")
                notify.assert_not_awaited()
            with patch.object(ProjectSidecar, "save", side_effect=PermissionError("denied")), patch.object(projects, "_project_reset_notifications", notify):
                with self.assertRaises(PermissionError):
                    _ = await projects.handle_projects_reset({"path": active}, source_name="client-a")
                notify.assert_not_awaited()
            with patch.object(Path, "unlink", side_effect=PermissionError("denied")):
                with self.assertRaises(PermissionError):
                    _ = await projects.handle_projects_remove({"path": inactive}, source_name="client-a")
            self.assertEqual(len(history.list_projects()), 2)

    async def test_open_uses_backend_project_switch_not_a_frontend_explorer_call(self) -> None:
        with project_fixture() as (_history, _active, inactive):
            with patch.object(projects, "handle_host_project_open_request", return_value={"ok": True}) as opened:
                result = await projects.handle_projects_open({"path": inactive}, source_name="client-a")
                _ = opened.assert_awaited_once_with({"path": inactive}, source_name="client-a")
            self.assertEqual(result, {"ok": True})

    async def test_reset_uses_existing_cross_client_and_comparison_projectors(self) -> None:
        from app.apps.code_te2.monaco_editor import editor_ws
        from app.apps.code_te2.explorer.services import file_ops, state_facts
        from app.apps.code_te2 import diff_helper

        with (
            patch.object(editor_ws, "editor_runtime_replay_sidecar_open_state", return_value={}) as replay,
            patch.object(editor_ws, "editor_runtime_notify_draft_state_changed") as drafts,
            patch.object(state_facts, "publish_git_diff_base_changed") as comparison,
            patch.object(file_ops, "mark_draft_cache_dirty"),
            patch.object(file_ops, "mark_git_cache_dirty"),
            patch.object(diff_helper, "invalidate_diff_cache"),
        ):
            await projects._project_reset_notifications("/project", "client-a")
            _ = replay.assert_awaited_once_with("/project", reason="no_file", source="client-a")
            drafts.assert_called_once_with("/project")
            _ = comparison.assert_awaited_once_with(Path("/project"), ref="HEAD", refresh=True, source="client-a")

    def test_obsolete_history_router_is_not_assembled(self) -> None:
        app = Path(__file__).resolve().parents[1] / "app/apps/code_te2"
        self.assertFalse((app / "main_page/backend/history_routes.py").exists())
        self.assertNotIn("history_routes", (app / "main.py").read_text())
