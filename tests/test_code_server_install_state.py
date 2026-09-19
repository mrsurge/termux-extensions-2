# pyright: strict, reportUninitializedInstanceVariable=false, reportPrivateUsage=false
from __future__ import annotations

import os
import subprocess
import asyncio
from contextlib import ExitStack
from pathlib import Path
import tempfile
import unittest
from typing import override
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock

from app.apps.code_te2 import code_server_install_state as state
from app.apps.code_te2.preferences_store import PreferencesStore
from app.apps.code_te2 import code_server_bootstrap as bootstrap
from app.apps.code_te2 import code_server_shell_manager as shells
from app.apps.code_te2 import extension_registry as registry
from app.apps.code_te2.project_sidecar import ProjectSidecar
from app.apps.code_te2.host import code_server_backend


class InstallationStateTests(unittest.TestCase):
    prefs: PreferencesStore

    @override
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR"))
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.prefs = PreferencesStore(root / "preferences.json")
        for item in (
            patch.object(state, "_preferences", return_value=self.prefs),
            patch.object(state, "te2_managed_code_server_root", return_value=root / "code-server"),
            patch.object(state, "default_layout", return_value="termux"),
        ):
            _ = item.start()
            self.addCleanup(item.stop)

    def test_existing_install_migrates_only_after_success(self) -> None:
        candidate = state.selected_installation()
        assert candidate is not None
        self.assertIsNone(self.prefs.get_code_server_installation())
        state.record_installation(candidate)
        self.assertEqual(self.prefs.get_code_server_installation(), {
            "installed": True, "version": "4.130.0", "layout": "termux",
        })
        with patch.object(Path, "is_file", side_effect=AssertionError("no probing")), patch.object(Path, "is_dir", side_effect=AssertionError("no probing")):
            self.assertEqual(state.selected_installation(), candidate)

    def test_launch_failure_ends_optimistic_migration(self) -> None:
        state.clear_installation()
        self.assertIsNone(state.selected_installation())
        self.assertEqual(self.prefs.get_code_server_installation(), {"installed": False})

    def test_web_workers_do_not_adopt_unknown_install(self) -> None:
        _ = self.prefs.update_preferences(ui={"webWorkersEnabled": True})
        self.assertIsNone(state.selected_installation())

    def test_runtime_pin_and_layout_are_required(self) -> None:
        for record in (
            {"installed": True, "version": "old", "layout": "termux"},
            {"installed": True, "version": "4.130.0", "layout": "external"},
        ):
            self.prefs.set_code_server_installation(dict(record))
            self.assertIsNone(state.selected_installation())

    def test_generic_ui_updates_cannot_set_installation_flag(self) -> None:
        _ = self.prefs.update_preferences(ui={"codeServerInstallation": {"installed": True}})
        self.assertIsNone(self.prefs.get_code_server_installation())

    def test_standalone_layout_round_trips(self) -> None:
        installation = state.installation_for_layout("standalone")
        state.record_installation(installation)
        self.assertEqual(state.selected_installation(), installation)
        state.clear_installation()
        self.assertFalse(installation.executable.exists())
        self.assertIsNone(state.selected_installation())

    def test_explicit_install_adopts_package_and_records_without_version_process(self) -> None:
        installation = state.installation_for_layout("termux")
        with (
            patch.object(bootstrap, "code_server_bootstrap_cache_dir", return_value=installation.executable.parent / "cache"),
            patch.object(bootstrap, "code_server_install_prefix", return_value=installation.executable.parent.parent),
            patch.object(bootstrap, "te2_managed_code_server_installation", return_value=installation),
            patch.object(subprocess, "check_output", side_effect=AssertionError("no version subprocess")),
            patch.object(bootstrap, "_install_android_code_server", side_effect=AssertionError("no download")),
            patch.object(bootstrap, "_install_official_code_server", side_effect=AssertionError("no download")),
        ):
            self.assertEqual(bootstrap.install_code_server_installation(), installation)
        self.assertEqual(state.selected_installation(), installation)

    def test_worker_mode_clears_flag_but_preserves_package(self) -> None:
        installation = state.installation_for_layout("termux")
        installation.executable.parent.mkdir(parents=True)
        _ = installation.executable.write_text("preserved", encoding="utf-8")
        state.record_installation(installation)
        with patch.object(code_server_backend, "get_preferences_store", return_value=self.prefs), patch.object(code_server_backend, "publish_preferences_changed", AsyncMock()):
            _ = asyncio.run(code_server_backend._persist_mode(web_workers_enabled=True))
        self.assertIsNone(state.selected_installation())
        self.assertEqual(installation.executable.read_text(encoding="utf-8"), "preserved")

    def test_launch_failure_clears_flag_but_adapter_callback_failure_does_not(self) -> None:
        installation = state.installation_for_layout("termux")
        root = installation.executable.parent.parent

        async def exercise(failure: str) -> None:
            state.record_installation(installation)
            shell = SimpleNamespace(id="test-code-server")
            manager = SimpleNamespace(find_shell_by_label=AsyncMock(return_value=None))
            orchestrator = SimpleNamespace(start_from_ref=AsyncMock(
                return_value=shell,
                side_effect=RuntimeError("spawn failed") if failure == "spawn" else None,
            ))
            def factory(_manager: object) -> SimpleNamespace:
                return orchestrator

            def sidecar_data() -> dict[str, object]:
                return {}
            with ExitStack() as stack:
                for item in (
                    patch.object(bootstrap, "ensure_code_server_installation", return_value=installation),
                    patch.object(shells, "_spawn_lock", asyncio.Lock()),
                    patch.object(shells, "_active_shell_id", None),
                    patch.object(shells, "_ready_event", None),
                    patch.object(shells, "_get_manager", AsyncMock(return_value=manager)),
                    patch.object(shells, "_orchestrator_factory", return_value=factory),
                    patch.object(shells, "_CODE_SERVER_DATA_DIR", root / "data"),
                    patch.object(shells, "_CODE_SERVER_SOCKET_PATH", root / "server.sock"),
                    patch.object(shells, "_CODE_SERVER_PROBE_OUTPUT_PATH", root / "probe"),
                    patch.object(shells, "ensure_runtime_home"),
                    patch.object(shells, "remove_legacy_bridge_extension", return_value=False),
                    patch.object(shells, "node_compile_cache", return_value=""),
                    patch.object(shells, "sync_vscode_watcher_settings"),
                    patch.object(shells, "_has_live_pipe", AsyncMock(return_value=True)),
                    patch.object(shells, "_wait_for_code_server_readiness", AsyncMock(side_effect=RuntimeError("readiness failed"))),
                    patch.object(registry, "ensure_registry_and_gate", return_value={}),
                    patch.object(ProjectSidecar, "load_or_create", return_value=SimpleNamespace(dump_raw=sidecar_data)),
                ):
                    _ = stack.enter_context(item)

                def failed_adapter(_record: shells.ShellRecord) -> None:
                    raise RuntimeError("adapter failed")

                with self.assertRaises(RuntimeError):
                    _ = await shells.ensure_code_server_shell(str(root), on_spawned=failed_adapter if failure == "adapter" else None)
                saved = self.prefs.get_code_server_installation()
                assert saved is not None
                self.assertEqual(saved.get("installed"), failure == "adapter")

        for failure in ("spawn", "readiness", "adapter"):
            asyncio.run(exercise(failure))
