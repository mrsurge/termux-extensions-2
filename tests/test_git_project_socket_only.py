"""Keep Git/project intent on the existing, guarded application RPC lanes."""
# pyright: strict
from __future__ import annotations

import ast
from pathlib import Path
import unittest
from unittest.mock import patch

from app.apps.code_te2.explorer.transport.rpc_contract import parse_explorer_rpc_request
from app.apps.code_te2.host import project_backend
from app.apps.code_te2.ui_ipc import rpc_dispatch
from app.apps.code_te2.ui_ipc.rpc_contract import UiIpcRpcMethod, parse_ui_ipc_rpc_request
from app.apps.code_te2.ui_ipc.sidebar_rpc_contract import parse_sidebar_ipc_rpc_request

APP = Path(__file__).resolve().parents[1] / "app/apps/code_te2"


class GitProjectSocketTests(unittest.IsolatedAsyncioTestCase):
    def test_legacy_route_modules_and_assembly_are_removed(self) -> None:
        # Audit source instead of booting a worker or touching the user's project.
        source = (APP / "main.py").read_text()
        for module in ("git_routes", "project_routes"):
            self.assertFalse((APP / "main_page/backend" / f"{module}.py").exists())
            self.assertNotIn(module, source)
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call) or not decorator.args:
                    continue
                route = decorator.args[0]
                if isinstance(route, ast.Constant) and isinstance(route.value, str):
                    self.assertFalse(route.value.startswith("/git/"), route.value)
                    self.assertNotIn(route.value, {"/project/open", "/project/create", "/project/current"})

    def test_explorer_git_and_project_methods_are_still_admitted(self) -> None:
        methods = (
            "git.branches.list", "git.commit", "git.commits.list", "git.diffBase.get",
            "git.diffBase.set", "git.init", "git.pull", "git.push", "git.fetch",
            "git.reset", "git.restore", "git.stage", "git.stageAll", "git.status.get",
            "git.unstage", "git.unstageAll", "project.open", "project.create", "project.list",
        )
        for suffix in methods:
            method = f"explorer.{suffix}"
            request = parse_explorer_rpc_request({
                "jsonrpc": "2.0", "id": "test", "method": method, "params": {},
            })
            self.assertEqual(request["method"], method)
            self.assertEqual(request["request_id"], "test")

    async def test_host_git_rpc_dispatch_preserves_params_and_source(self) -> None:
        cases: tuple[tuple[UiIpcRpcMethod, str], ...] = (
            ("ui.host.git.branches.list", "handle_host_git_branches_list_request"),
            ("ui.host.git.branch.checkout", "handle_host_git_branch_checkout_request"),
            ("ui.host.git.branch.create", "handle_host_git_branch_create_request"),
            ("ui.host.git.remote.add", "handle_host_git_remote_add_request"),
        )
        params: dict[str, object] = {"name": "branch", "url": "test-remote"}
        for method, hook in cases:
            self.assertIsNotNone(parse_ui_ipc_rpc_request({
                "jsonrpc": "2.0", "id": "test", "method": method, "params": params,
            }))
            with patch.object(rpc_dispatch, hook, return_value={"ok": True}) as call:
                result = await rpc_dispatch.dispatch_ui_ipc_rpc_request(method, params, source_name="client-a")
                _ = call.assert_awaited_once_with(params, source_name="client-a")
            self.assertEqual(result, {"ok": True})

    async def test_host_git_failure_is_not_reported_as_success(self) -> None:
        with patch.object(rpc_dispatch, "handle_host_git_branch_checkout_request", side_effect=RuntimeError("checkout rejected")):
            with self.assertRaisesRegex(RuntimeError, "checkout rejected"):
                _ = await rpc_dispatch.dispatch_ui_ipc_rpc_request(
                    "ui.host.git.branch.checkout", {"name": "branch"}, source_name="client-a",
                )

    def test_sidebar_project_contract_remains_available(self) -> None:
        for method in ("sidebar.project.lookup", "sidebar.project.open", "sidebar.project.create"):
            self.assertIsNotNone(parse_sidebar_ipc_rpc_request({
                "jsonrpc": "2.0", "id": "test", "method": method, "params": {"path": "/project"},
            }))

    async def test_sidebar_open_keeps_service_validation_and_source_attribution(self) -> None:
        deps = object()
        with (
            patch.object(project_backend, "_project_service_deps", return_value=deps),
            patch.object(project_backend, "open_project", return_value={"ok": True}) as call,
        ):
            result = await project_backend.handle_sidebar_project_open_request(
                {"path": "/project", "file": "/project/file.py"}, source_name="sidebar-a",
            )
            _ = call.assert_awaited_once_with(
                deps, "/project", require_known_sidecar=True,
                reason="sidebar_project_open", file_target="/project/file.py",
            )
        self.assertEqual(result, {"ok": True, "source": "sidebar-a"})

    async def test_sidebar_create_keeps_explicit_adopt_and_open_flags(self) -> None:
        deps = object()
        with (
            patch.object(project_backend, "_project_service_deps", return_value=deps),
            patch.object(project_backend, "create_project_from_path", return_value={"ok": True}) as call,
        ):
            result = await project_backend.handle_sidebar_project_create_request(
                {"path": "/project", "adoptExisting": True, "open": False}, source_name="sidebar-a",
            )
            _ = call.assert_awaited_once_with(deps, path="/project", adopt_existing=True, open_after=False)
        self.assertEqual(result, {"ok": True, "source": "sidebar-a"})

    async def test_sidebar_failure_does_not_gain_a_success_projection(self) -> None:
        with (
            patch.object(project_backend, "_project_service_deps", return_value=object()),
            patch.object(project_backend, "open_project", return_value={"ok": False, "reason": "unknown project"}),
        ):
            result = await project_backend.handle_sidebar_project_open_request(
                {"path": "/project"}, source_name="sidebar-a",
            )
        self.assertEqual(result, {"ok": False, "reason": "unknown project"})
