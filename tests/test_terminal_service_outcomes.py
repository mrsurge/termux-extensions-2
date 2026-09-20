"""Guard the terminal service/Socket.IO boundary without creating real shells."""
# pyright: strict, reportPrivateUsage=false
from __future__ import annotations

import asyncio
from contextlib import ExitStack
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

from app.apps.code_te2 import terminal_backend as terminal
from app.apps.code_te2.host import terminal_actions_backend as actions
from app.apps.code_te2.host import runner_profiles_backend as profiles
from app.apps.code_te2.terminal_outcomes import TerminalServiceError

ROOT = Path(__file__).resolve().parents[1]


class History:
    def get_active_project(self) -> str | None:
        return None

    def get_last_file(self, _project: str | None) -> str | None:
        return None


class TerminalServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_no_legacy_routes_or_fastapi_imports(self) -> None:
        source = (ROOT / "app/apps/code_te2/terminal_backend.py").read_text()
        for removed in ("terminal_router", "fastapi", "HTTPException", "\n_active_terminal_sockets:"):
            self.assertNotIn(removed, source)
        assembly = (ROOT / "app/apps/code_te2/main.py").read_text()
        self.assertNotIn("include_router(terminal_router)", assembly)

    def test_terminal_imports_without_web_frameworks(self) -> None:
        # A fresh interpreter catches indirect imports, not just source spellings.
        script = """
import importlib.abc
import sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'fastapi', 'pydantic', 'pydantic_core', 'starlette'}:
            raise ImportError('forbidden: ' + fullname)
sys.meta_path.insert(0, Block())
from app.apps.code_te2 import terminal_backend
from app.apps.code_te2.host import terminal_actions_backend
"""
        result = subprocess.run([sys.executable, "-c", script], cwd=ROOT,
                                capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    async def test_rpc_preserves_detail_and_correlation_for_all_error_kinds(self) -> None:
        failures = [
            TerminalServiceError("invalid", "No active project selected"),
            TerminalServiceError("missing", "Shell not tracked for this project"),
            TerminalServiceError("conflict", "Shell is not running"),
            TerminalServiceError("internal", "Failed to destroy shell"),
        ]
        namespace = terminal.TerminalSocketIONamespace("/terminal")
        for failure, code in zip(failures, (400, 404, 409, 500), strict=True):
            self.assertEqual(str(failure), f"{code}: {failure.detail}")
            with patch.object(terminal, "_create_terminal_shell_data", side_effect=failure):
                result = await namespace.on_terminal_request("sid", {
                    "id": "req", "method": "shell.create", "params": {},
                })
            self.assertEqual(result, {"id": "req", "ok": False, "error": failure.detail})

    async def test_all_control_methods_keep_the_existing_service_hooks(self) -> None:
        methods = {
            "shells.get": "_terminal_shell_list_data",
            "shell.create": "_create_terminal_shell_data",
            "shell.activate": "_activate_terminal_shell_data",
            "shell.title": "_set_terminal_shell_title_data",
            "shell.remove": "_destroy_terminal_shell_data",
            "shell.destroy": "_destroy_terminal_shell_data",
            "shell.history": "_terminal_history_data",
        }
        namespace = terminal.TerminalSocketIONamespace("/terminal")
        for method, hook in methods.items():
            with patch.object(terminal, hook, return_value={"shell_id": "shell-a"}) as called:
                result = await namespace.on_terminal_request("sid", {
                    "id": "req", "method": method,
                    "params": {"shell_id": "shell-a", "title": "build"},
                })
                _ = called.assert_awaited_once()
            self.assertEqual(result, {"id": "req", "ok": True, "result": {"shell_id": "shell-a"}})

    async def test_rpc_does_not_swallow_cancellation(self) -> None:
        with patch.object(terminal, "_create_terminal_shell_data", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                _ = await terminal.TerminalSocketIONamespace("/terminal").on_terminal_request(
                    "sid", {"id": "req", "method": "shell.create"},
                )

    async def test_missing_project_and_missing_file_are_typed(self) -> None:
        with patch.object(terminal, "get_history_store", return_value=History()):
            with self.assertRaises(TerminalServiceError) as error:
                _ = await terminal._create_terminal_shell_data()
            self.assertEqual(error.exception.kind, "invalid")
            self.assertEqual(error.exception.detail, "No active project selected")
            with self.assertRaises(TerminalServiceError) as error:
                _ = await terminal.handle_run_active_file_request()
            self.assertEqual(error.exception.detail, "No file is currently open")
            with tempfile.TemporaryDirectory(prefix="te2-run-error-") as directory:
                with self.assertRaises(TerminalServiceError) as error:
                    _ = await terminal.handle_run_active_file_request({"path": str(Path(directory) / "missing.py")})
                self.assertEqual(error.exception.kind, "missing")

    async def test_rebind_notifies_existing_socket_clients_without_closing_transport(self) -> None:
        emit = AsyncMock()
        with (
            patch.object(terminal, "_terminal_sio", object()),
            patch.object(terminal, "_active_terminal_sids", {"a": "/project", "b": "/project"}),
            patch.object(terminal, "_emit_terminal_to_sid", emit),
            patch.object(time, "time", return_value=1),
        ):
            await terminal.close_active_terminal_sockets("project switch")
        self.assertEqual(emit.await_count, 2)
        for sid in ("a", "b"):
            emit.assert_any_await("terminal:rebind_required", {"reason": "project switch", "ts": 1000}, sid)

    async def test_shell_list_broadcast_keeps_project_filter(self) -> None:
        emit = AsyncMock()
        with (
            patch.object(terminal, "_terminal_sio", object()),
            patch.object(terminal, "_active_terminal_sids", {"a": "/project", "b": "/other"}),
            patch.object(terminal, "_emit_terminal_to_sid", emit),
            patch.object(terminal, "_build_terminal_shell_list", return_value={"shells": []}),
        ):
            await terminal._broadcast_terminal_shell_list("/project")
        emit.assert_awaited_once_with("terminal:shell_list", {"type": "shell_list", "shells": []}, "a")

    async def test_host_preserves_unsupported_file_message_and_propagates_other_errors(self) -> None:
        # Bypass only profile/save setup; the real host error translation runs.
        with ExitStack() as stack:
            _ = stack.enter_context(patch.object(profiles, "resolve_runner_profile_run_request", return_value=None))
            _ = stack.enter_context(patch.object(actions, "_active_file", return_value=Path("/project/file.txt")))
            _ = stack.enter_context(patch.object(actions, "fallback_show_save_warning", return_value=False))
            _ = stack.enter_context(patch.object(actions, "_save_before_play", return_value=None))
            failure = TerminalServiceError("invalid", actions._LEGACY_UNSUPPORTED_RUNNER_MESSAGE)
            with patch.object(terminal, "handle_run_active_file_request", side_effect=failure):
                result = await actions._handle_host_run_active_file_request(
                    {}, project_root=Path("/project"), source_name="client-a",
                )
            self.assertEqual(result, {"ok": False, "error": "No run profile or default runner for this file", "data": {"action": "none"}})
            with patch.object(terminal, "handle_run_active_file_request", side_effect=TerminalServiceError("internal", "dispatch failed")):
                with self.assertRaises(TerminalServiceError):
                    _ = await actions._handle_host_run_active_file_request(
                        {}, project_root=Path("/project"), source_name="client-a",
                    )
