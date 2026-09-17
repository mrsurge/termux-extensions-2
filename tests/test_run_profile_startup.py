# pyright: strict, reportPrivateUsage=false
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.apps.code_te2 import runner_profiles, run_profile_state, run_profile_events
from app.apps.code_te2.worker_services.event_bus import build_event


class RunProfileStartupTests(unittest.TestCase):
    def test_contract_imports_do_not_load_runtime_services(self) -> None:
        # A fresh interpreter exposes eager package side effects hidden by test imports.
        code = """
import sys
import app.apps.code_te2.host.run_target_service
import app.apps.code_te2.monaco_editor.editor_backend_services.contracts
import app.apps.code_te2.terminal_shell
import app.apps.code_te2.run_profile_surfaces
assert 'httpx' not in sys.modules
assert 'framework_shells' not in sys.modules
assert 'app.apps.code_te2.monaco_editor.editor_backend' not in sys.modules
"""
        with tempfile.TemporaryDirectory() as temp:
            env = dict(os.environ)
            for kind in ("DATA", "CONFIG", "RUNTIME", "CACHE"):
                env[f"TE2_{kind}_HOME"] = str(Path(temp) / kind.lower())
            result = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_load_constructs_profiles_once_and_still_validates(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config = runner_profiles.run_profiles_config_path(root)
            config.parent.mkdir()
            _ = config.write_text('{"profiles": []}')
            with patch.object(runner_profiles, "_profiles_from_config", wraps=runner_profiles._profiles_from_config) as parse:
                self.assertEqual(runner_profiles.load_run_profiles(root), [])
                parse.assert_called_once()
            _ = config.write_text('{"profiles": [false]}')
            with self.assertRaises(ValueError):
                _ = runner_profiles.load_run_profiles(root)
            with self.assertRaises(ValueError):
                _ = runner_profiles.load_run_profiles_config(root)


class ProjectionSnapshotTests(unittest.IsolatedAsyncioTestCase):
    async def test_projection_reads_once_off_loop_and_reuses_for_candidates(self) -> None:
        loop_thread = threading.get_ident()
        threads: list[int] = []

        def load(_root: Path) -> list[runner_profiles.RunProfile]:
            threads.append(threading.get_ident())
            return []

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            with (
                patch.object(run_profile_state, "run_profile_request_context", return_value=(str(root), str(root / "test.py"))),
                patch.object(run_profile_state, "load_run_profiles", side_effect=load),
                patch.object(runner_profiles, "load_run_profiles", side_effect=AssertionError("second read")),
            ):
                result = await run_profile_state.build_run_profile_state_projection()
        self.assertEqual(result["candidates"], [])
        self.assertEqual(len(threads), 1)
        self.assertNotEqual(threads[0], loop_thread)

    async def test_broadcast_reads_once_for_all_clients(self) -> None:
        from app.apps.code_te2.ui_ipc import ui_ipc_ws
        from app.apps.code_te2 import open_state_backend

        event = build_event("RunProfileStateChanged", source="test", project_root="/project", payload={"runProfileState": {"revision": 1}})
        with (
            patch.object(ui_ipc_ws, "list_ui_ipc_browser_clients", return_value=["one", "two"]),
            patch.object(ui_ipc_ws, "emit_ui_ipc_rpc_notification", AsyncMock()) as emit,
            patch.object(open_state_backend, "read_client_foreground", return_value={"path": "/project/test.py"}),
            patch.object(run_profile_events, "load_run_profiles", return_value=[]) as load,
            patch.object(run_profile_events, "build_run_profile_state_projection", AsyncMock(return_value={})) as build,
        ):
            await run_profile_events._project_run_profile_state(event)
        load.assert_called_once_with("/project")
        self.assertEqual(emit.await_count, 2)
        self.assertEqual(build.await_count, 2)
        build.assert_awaited_with({"path": "/project/test.py"}, profiles=[])

    async def test_generation_change_during_config_read_drops_broadcast(self) -> None:
        from app.apps.code_te2.ui_ipc import ui_ipc_ws

        event = build_event("RunProfileStateChanged", source="test", project_root="/project", project_generation=1, payload={"runProfileState": {"revision": 1}})
        with (
            patch.object(ui_ipc_ws, "list_ui_ipc_browser_clients", return_value=["one"]),
            patch.object(ui_ipc_ws, "emit_ui_ipc_rpc_notification", AsyncMock()) as emit,
            patch.object(run_profile_events, "load_run_profiles", return_value=[]),
            patch.object(run_profile_events, "current_project_generation", side_effect=[1, 2]),
        ):
            await run_profile_events._project_run_profile_state(event)
        emit.assert_not_awaited()
