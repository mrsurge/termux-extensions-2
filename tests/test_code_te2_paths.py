# pyright: reportPrivateUsage=false, reportUnusedCallResult=false, reportAny=false
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import cast, override
from unittest.mock import AsyncMock, patch

from app.apps.code_te2 import code_server_shell_manager, extension_registry
from app.apps.code_te2 import workbench_adapter_shell_manager
from app.apps.code_te2.code_te2_paths import (
    code_te2_paths,
    resolve_code_te2_paths,
)
from app.apps.code_te2.draft_index_sidecar import DraftIndexSidecar
from app.apps.code_te2.history_store import HistoryStore
from app.apps.code_te2.preferences_store import PreferencesStore
from app.apps.code_te2.project_sidecar import ProjectSidecar
from app.apps.code_te2.services import sidebar_backchannel_uds


REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = REPO_ROOT / "tests" / "fixtures" / "code_te2"


class CodeTe2PathTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    root: Path = Path()

    @override
    def setUp(self) -> None:
        scratch_root = Path(os.environ.get("TEMPDIR") or REPO_ROOT / ".codex-scratch")
        scratch_root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = tempfile.TemporaryDirectory(dir=scratch_root)
        self.root = Path(self.temp_dir.name)
        ProjectSidecar._instances.clear()
        DraftIndexSidecar._instances.clear()

    @override
    def tearDown(self) -> None:
        ProjectSidecar._instances.clear()
        DraftIndexSidecar._instances.clear()
        if self.temp_dir is not None:
            self.temp_dir.cleanup()

    def _canonical_env(self) -> dict[str, str]:
        return {
            "HOME": str(self.root / "home"),
            "TE2_CACHE_HOME": str(self.root / "cache"),
            "TE2_DATA_HOME": str(self.root / "data"),
            "TE2_CONFIG_HOME": str(self.root / "config"),
            "TE2_RUNTIME_HOME": str(self.root / "runtime"),
        }

    def test_resolver_partitions_code_te2_data_config_cache_and_runtime(self) -> None:
        env = self._canonical_env()
        paths = resolve_code_te2_paths(env)

        self.assertEqual(self.root / "data" / "code_te2", paths.data_root)
        self.assertEqual(self.root / "config" / "code_te2", paths.config_root)
        self.assertEqual(self.root / "cache" / "code_te2", paths.cache_root)
        self.assertEqual(self.root / "runtime" / "code_te2", paths.runtime_root)
        self.assertEqual(paths.data_root / "projects", paths.project_sidecars_dir)
        self.assertEqual(paths.data_root / "history.json", paths.history_path)
        self.assertEqual(paths.config_root / "preferences.json", paths.preferences_path)
        self.assertEqual(paths.data_root / "agent_icons", paths.agent_icons_dir)
        self.assertEqual(
            paths.runtime_root / "sidebar_backchannel.sock",
            paths.sidebar_backchannel_socket_path,
        )
        self.assertEqual(
            paths.data_root / "code_server" / "extensions",
            paths.code_server_extensions_dir,
        )
        self.assertEqual(
            paths.data_root / "code_server" / "User" / "te2-extension-storage",
            paths.code_server_extension_storage_dir,
        )
        self.assertEqual(
            paths.data_root
            / "code_server"
            / "User"
            / "te2-webview-reconstruction",
            paths.code_server_webview_reconstruction_dir,
        )
        self.assertEqual(
            paths.runtime_root / "code_server.sock",
            paths.code_server_socket_path,
        )
        self.assertEqual(
            self.root / "cache" / "code_server" / "probes" / "te2_rpc_config.json",
            paths.code_server_rpc_config_path,
        )

    def test_history_and_preferences_persist_only_in_canonical_roots(self) -> None:
        env = self._canonical_env()
        project = str(self.root / "workspace")
        with patch.dict(os.environ, env, clear=False):
            history = HistoryStore()
            history.set_active_project(project)
            preferences = PreferencesStore()
            preferences.update_preferences(editor={"wordWrap": True})

            self.assertEqual(code_te2_paths().history_path, history.path)
            self.assertEqual(code_te2_paths().preferences_path, preferences.path)
            self.assertEqual(project, HistoryStore().get_active_project())
            self.assertTrue(
                cast(
                    dict[str, object],
                    PreferencesStore().get_preferences()["editor"],
                )["wordWrap"]
            )

        home = Path(env["HOME"])
        self.assertFalse((home / ".cache" / "cm6_sessions").exists())
        self.assertFalse((home / ".cache" / "cm6_editor").exists())
        self.assertFalse((home / ".local" / "share" / "termux-extensions-2").exists())

    def test_fresh_editor_preferences_start_in_draft_mode_without_diff_overlays(self) -> None:
        with patch.dict(os.environ, self._canonical_env(), clear=False):
            editor = cast(
                dict[str, object],
                PreferencesStore().get_preferences()["editor"],
            )

        self.assertFalse(editor["autoSave"])
        self.assertFalse(editor["showInlineDiffs"])
        self.assertFalse(editor["showDraftDiffs"])

    def test_real_shape_project_sidecar_and_draft_index_survive_reload(self) -> None:
        env = self._canonical_env()
        project = "/workspace/example"
        file_path = "/workspace/example/src/main.py"
        with patch.dict(os.environ, env, clear=False):
            sidecar_path = ProjectSidecar.get_sidecar_path(project)
            sidecar_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(FIXTURE_ROOT / "project_sidecar_v2.json", sidecar_path)
            shutil.copyfile(
                FIXTURE_ROOT / "project_sidecar_v2.draft_index.json",
                sidecar_path.with_suffix(".draft_index.json"),
            )

            sidecar = ProjectSidecar.load_or_create(project)
            draft = sidecar.get_cached_document(file_path)
            self.assertIsNotNone(draft)
            assert draft is not None
            self.assertEqual('print("draft")\n', draft["content"])
            self.assertTrue(draft["unsaved"])
            self.assertEqual(file_path, sidecar.get_last_file())
            self.assertEqual(file_path, sidecar.list_recent_files()[0]["path"])

            index = DraftIndexSidecar.load_or_create(project)
            draft_files, draft_dirs = index.snapshot()
            self.assertEqual({"src/main.py"}, draft_files)
            self.assertEqual({"src"}, draft_dirs)

            sidecar.set_diff_base("origin/main")
            sidecar.save()
            ProjectSidecar._instances.clear()
            DraftIndexSidecar._instances.clear()

            reloaded = ProjectSidecar.load_or_create(project)
            self.assertEqual("origin/main", reloaded.get_diff_base())
            self.assertEqual(
                'print("draft")\n',
                cast(dict[str, object], reloaded.get_cached_document(file_path))["content"],
            )
            self.assertEqual(
                {"src/main.py"},
                DraftIndexSidecar.load_or_create(project).snapshot()[0],
            )

    def test_sidebar_socket_default_is_canonical_and_override_remains_explicit(self) -> None:
        env = self._canonical_env()
        with patch.dict(os.environ, env, clear=False):
            os.environ.pop("TE_BACKCHANNEL_SOCKET", None)
            self.assertEqual(
                code_te2_paths().sidebar_backchannel_socket_path,
                sidebar_backchannel_uds._resolve_socket_path(),
            )

            override = self.root / "override" / "sidebar.sock"
            os.environ["TE_BACKCHANNEL_SOCKET"] = str(override)
            self.assertEqual(
                override.resolve(strict=False),
                sidebar_backchannel_uds._resolve_socket_path(),
            )

    def test_managed_code_server_paths_share_the_canonical_contract(self) -> None:
        paths = code_te2_paths()
        self.assertEqual(paths.code_server_data_dir, extension_registry._CODE_SERVER_DATA_DIR)
        self.assertEqual(paths.code_server_extensions_dir, extension_registry._EXTENSIONS_DIR)
        self.assertEqual(
            paths.code_server_user_settings_path,
            extension_registry._USER_SETTINGS_PATH,
        )
        self.assertEqual(paths.code_server_registry_path, extension_registry._REGISTRY_PATH)
        self.assertEqual(paths.code_server_rpc_config_path, extension_registry._RPC_CONFIG_PATH)
        self.assertEqual(
            paths.code_server_data_dir,
            code_server_shell_manager._CODE_SERVER_DATA_DIR,
        )
        self.assertEqual(
            paths.code_server_socket_path,
            code_server_shell_manager._CODE_SERVER_SOCKET_PATH,
        )

    def test_workbench_shellspec_forwards_private_code_server_paths(self) -> None:
        shellspec = (
            REPO_ROOT
            / "app"
            / "apps"
            / "code_te2"
            / "shellspec"
            / "workbench_adapter.yaml"
        ).read_text("utf-8")
        self.assertIn(
            "TE2_EXTENSIONS_JSON: ${ctx:CODE_SERVER_EXTENSIONS_JSON}",
            shellspec,
        )
        self.assertIn(
            "TE2_USER_SETTINGS_PATH: ${ctx:CODE_SERVER_USER_SETTINGS}",
            shellspec,
        )
        self.assertIn(
            "TE2_EXTENSION_STORAGE_PATH: ${ctx:CODE_SERVER_EXTENSION_STORAGE}",
            shellspec,
        )
        self.assertIn(
            "TE2_WEBVIEW_RECONSTRUCTION_STORAGE_PATH: ${ctx:CODE_SERVER_WEBVIEW_RECONSTRUCTION}",
            shellspec,
        )
        self.assertIn(
            "TE2_RPC_CONFIG_PATH: ${ctx:CODE_SERVER_RPC_CONFIG}",
            shellspec,
        )

    def test_dead_cm6_session_helpers_are_removed(self) -> None:
        for name in (
            "_normalize_cache_key",
            "_get_sidecar_path",
            "_write_sidecar",
            "_read_sidecar",
            "_delete_sidecar",
        ):
            self.assertFalse(hasattr(HistoryStore, name), name)

    def test_active_runtime_sources_do_not_reference_legacy_roots(self) -> None:
        sources = (
            "project_sidecar.py",
            "history_store.py",
            "preferences_store.py",
            "extension_registry.py",
            "code_server_shell_manager.py",
            "services/sidebar_backchannel_uds.py",
            "explorer/handlers/prefs.py",
            "monaco_editor/editor_backend.py",
            "workbench_protocol_proxy/node_workbench_adapter/src/extensions/catalog.ts",
            "workbench_protocol_proxy/node_workbench_adapter/src/client/configuration.ts",
            "workbench_protocol_proxy/node_workbench_adapter/src/protocol/rpc-ids.ts",
        )
        app_root = REPO_ROOT / "app" / "apps" / "code_te2"
        forbidden = (
            ".cache/cm6_editor",
            ".cache/cm6_sessions",
            ".local/share/termux-extensions-2",
            ".config/code-server",
        )
        for relative in sources:
            content = (app_root / relative).read_text("utf-8")
            for legacy in forbidden:
                self.assertNotIn(legacy, content, f"{legacy} in {relative}")

    def test_sidecar_fixture_has_current_version_and_draft_shape(self) -> None:
        decoded = cast(
            dict[str, object],
            json.loads((FIXTURE_ROOT / "project_sidecar_v2.json").read_text("utf-8")),
        )
        self.assertEqual(ProjectSidecar.VERSION, decoded["version"])
        cache = cast(dict[str, object], decoded["session_cache"])
        self.assertEqual(1, len(cache))
        draft = cast(dict[str, object], next(iter(cache.values())))
        self.assertEqual(
            {
                "project_path",
                "file_path",
                "content",
                "content_length",
                "content_sha256",
                "base_sha256",
                "unsaved",
                "run_id",
                "shell_id",
                "shell_run_id",
                "launcher_pid",
                "worker_pid",
                "updated_at",
            },
            set(draft),
        )
class CodeTe2WorkbenchPathHandoffTests(unittest.IsolatedAsyncioTestCase):
    async def test_workbench_launch_receives_exact_canonical_paths(self) -> None:
        shell = SimpleNamespace(
            id="wba-test",
            label="workbench_adapter:code_te2:global",
            pid=42,
            status="running",
            env_overrides={},
            command=[],
        )
        manager = SimpleNamespace(find_shell_by_label=AsyncMock(return_value=None))
        orchestrator = SimpleNamespace(start_from_ref=AsyncMock(return_value=shell))

        with (
            patch.object(workbench_adapter_shell_manager, "_active_shell_id", None),
            patch.object(
                workbench_adapter_shell_manager,
                "get_manager",
                AsyncMock(return_value=manager),
            ),
            patch.object(
                workbench_adapter_shell_manager,
                "Orchestrator",
                return_value=orchestrator,
            ),
            patch.object(
                workbench_adapter_shell_manager,
                "_ensure_live_adapter_io",
                AsyncMock(return_value=False),
            ),
            patch.object(
                workbench_adapter_shell_manager,
                "_publish_adapter_state_fact",
                AsyncMock(),
            ),
            patch.object(extension_registry, "ensure_rpc_config", return_value={}),
        ):
            result = await workbench_adapter_shell_manager.ensure_workbench_adapter_shell(
                "/workspace/example",
                "http://localhost",
                "/runtime/code-server.sock",
            )

        self.assertIs(shell, result)
        call = orchestrator.start_from_ref.await_args
        assert call is not None
        ctx = cast(dict[str, object], call.kwargs["ctx"])
        paths = code_te2_paths()
        self.assertEqual(
            str(paths.code_server_extensions_manifest_path),
            ctx["CODE_SERVER_EXTENSIONS_JSON"],
        )
        self.assertEqual(
            str(paths.code_server_user_settings_path),
            ctx["CODE_SERVER_USER_SETTINGS"],
        )
        self.assertEqual(
            str(paths.code_server_extension_storage_dir),
            ctx["CODE_SERVER_EXTENSION_STORAGE"],
        )
        self.assertEqual(
            str(paths.code_server_webview_reconstruction_dir),
            ctx["CODE_SERVER_WEBVIEW_RECONSTRUCTION"],
        )
        self.assertEqual(
            str(paths.code_server_rpc_config_path),
            ctx["CODE_SERVER_RPC_CONFIG"],
        )


if __name__ == "__main__":
    unittest.main()
