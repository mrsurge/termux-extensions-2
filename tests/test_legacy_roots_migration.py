# pyright: reportPrivateUsage=false, reportUnusedCallResult=false, reportUninitializedInstanceVariable=false, reportImplicitOverride=false, reportAny=false, reportUnknownVariableType=false, reportPrivateLocalImportUsage=false
from __future__ import annotations

import fcntl
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.cli import legacy_roots
from app.cli import run_rust_framework
from app.extensions.apps import registry as app_registry
from app.te2_paths import te2_app_data_home


class LegacyRootMigrationTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    root: Path = Path()
    roots: legacy_roots.LegacyRoots

    def setUp(self) -> None:
        scratch_root = Path(os.environ.get("TEMPDIR") or Path.cwd() / ".codex-scratch")
        scratch_root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = tempfile.TemporaryDirectory(dir=scratch_root)
        self.root = Path(self.temp_dir.name)
        home = self.root / "home"
        self.roots = legacy_roots.LegacyRoots(
            home=home,
            legacy_cache_base=home / ".cache",
            legacy_data_base=home / ".local" / "share",
            legacy_config_base=home / ".config",
            legacy_runtime_base=self.root / "legacy-runtime",
            cache_home=self.root / "canonical-cache",
            data_home=self.root / "canonical-data",
            config_home=self.root / "canonical-config",
            runtime_home=self.root / "canonical-runtime",
        )

    def tearDown(self) -> None:
        if self.temp_dir is not None:
            self.temp_dir.cleanup()

    def test_dry_run_is_write_free_and_reports_overwrite_delete_and_unknown(self) -> None:
        source = self.roots.legacy_cache_base / "termux_extensions" / "settings.json"
        destination = self.roots.config_home / "framework" / "settings.json"
        _write_json(source, {"source": True})
        _write_json(destination, {"destination": True})
        cleanup = self.roots.legacy_cache_base / "te2-android-install" / "old.apk"
        _write(cleanup, b"apk")
        unknown = self.roots.legacy_cache_base / "te2_kotlin_lsp" / "external"
        _write(unknown, b"external")

        result = legacy_roots.run_migration(self.roots)

        by_id = {item.action_id: item for item in result.items}
        self.assertEqual("overwrite", by_id["framework-settings"].status)
        self.assertEqual("delete", by_id["obsolete-android-install-cache"].status)
        self.assertEqual(("external",), by_id["unowned-kotlin-lsp-cache"].unknown_children)
        self.assertEqual({"source": True}, _read_json(source))
        self.assertEqual({"destination": True}, _read_json(destination))
        self.assertTrue(cleanup.exists())
        self.assertTrue(unknown.exists())
        self.assertFalse(self.roots.runtime_home.exists())
        self.assertFalse(self.roots.receipt_path.exists())

    def test_apply_overwrites_matching_files_and_preserves_destination_only_files(self) -> None:
        old_settings = self.roots.legacy_cache_base / "termux_extensions" / "settings.json"
        new_settings = self.roots.config_home / "framework" / "settings.json"
        _write_json(old_settings, {"owner": "legacy"})
        _write_json(new_settings, {"owner": "canonical"})

        old_projects = self.roots.home / ".cache" / "cm6_editor" / "projects"
        new_projects = self.roots.data_home / "code_te2" / "projects"
        _write_json(old_projects / "shared.json", _sidecar("/legacy", marker="legacy"))
        _write_json(new_projects / "shared.json", _sidecar("/canonical", marker="canonical"))
        _write_json(new_projects / "destination-only.json", _sidecar("/destination-only"))

        cleanup = self.roots.legacy_cache_base / "dev.te2.desktop" / "cache.bin"
        _write(cleanup, b"cache")

        result = legacy_roots.run_migration(self.roots, apply=True)

        self.assertTrue(result.applied)
        self.assertEqual({"owner": "legacy"}, _read_json(new_settings))
        self.assertEqual("legacy", _read_json(new_projects / "shared.json")["marker"])
        self.assertTrue((new_projects / "destination-only.json").is_file())
        self.assertFalse(old_settings.exists())
        self.assertFalse(old_projects.exists())
        self.assertFalse(cleanup.parent.exists())
        self.assertTrue(self.roots.receipt_path.is_file())
        receipt = _read_json(self.roots.receipt_path)
        self.assertEqual(
            "legacy-source-overwrites-matching-canonical-files",
            receipt["collisionPolicy"],
        )

    def test_identical_source_and_destination_deduplicate_to_canonical_file(self) -> None:
        source = self.roots.legacy_cache_base / "termux_extensions" / "jobs.json"
        destination = self.roots.data_home / "framework" / "jobs.json"
        _write_json(source, {"job": {"status": "done"}})
        _write_json(destination, {"job": {"status": "done"}})

        legacy_roots.run_migration(self.roots, apply=True)

        self.assertFalse(source.exists())
        self.assertEqual({"job": {"status": "done"}}, _read_json(destination))

    def test_source_permissions_replace_existing_destination_permissions(self) -> None:
        source = (
            self.roots.legacy_cache_base
            / "termux_extensions"
            / "file_explorer"
            / "bookmarks"
            / "bookmarks.json"
        )
        destination = self.roots.data_home / "framework" / "bookmarks.json"
        _write_json(source, [{"owner": "legacy"}])
        _write_json(destination, [{"owner": "canonical"}])
        source.chmod(0o600)
        destination.chmod(0o644)

        legacy_roots.run_migration(self.roots, apply=True)

        self.assertEqual(
            [{"owner": "legacy"}],
            json.loads(destination.read_text("utf-8")),
        )
        self.assertEqual(0o600, destination.stat().st_mode & 0o777)

    def test_new_only_destination_is_preserved_and_receipted(self) -> None:
        destination = self.roots.data_home / "framework" / "state_store.json"
        _write_json(destination, {"canonical": True})

        result = legacy_roots.run_migration(self.roots, apply=True)

        self.assertEqual((), result.changed)
        self.assertEqual({"canonical": True}, _read_json(destination))
        self.assertTrue(self.roots.receipt_path.is_file())

    def test_invalid_source_schema_aborts_before_any_mutation(self) -> None:
        invalid = self.roots.legacy_cache_base / "termux_extensions" / "settings.json"
        invalid.parent.mkdir(parents=True, exist_ok=True)
        invalid.write_text("[]", encoding="utf-8")
        cleanup = self.roots.legacy_cache_base / "te2-android-install" / "old.apk"
        _write(cleanup, b"apk")

        with self.assertRaisesRegex(legacy_roots.MigrationError, "expected a JSON object"):
            legacy_roots.run_migration(self.roots, apply=True)

        self.assertTrue(invalid.exists())
        self.assertTrue(cleanup.exists())
        self.assertFalse(self.roots.receipt_path.exists())

    def test_source_symlink_is_refused_without_following_it(self) -> None:
        external = self.root / "external-settings.json"
        _write_json(external, {"external": True})
        source = self.roots.legacy_cache_base / "termux_extensions" / "settings.json"
        source.parent.mkdir(parents=True, exist_ok=True)
        source.symlink_to(external)

        with self.assertRaisesRegex(legacy_roots.MigrationError, "must not be a symbolic link"):
            legacy_roots.run_migration(self.roots, apply=True)

        self.assertEqual({"external": True}, _read_json(external))
        self.assertTrue(source.is_symlink())

    def test_active_framework_shared_guard_blocks_apply(self) -> None:
        source = self.roots.legacy_cache_base / "termux_extensions" / "settings.json"
        _write_json(source, {"source": True})
        self.roots.framework_guard_path.parent.mkdir(parents=True, exist_ok=True)

        with self.roots.framework_guard_path.open("a+b") as guard:
            fcntl.flock(guard.fileno(), fcntl.LOCK_SH)
            with self.assertRaisesRegex(legacy_roots.ActiveFrameworkError, "framework is active"):
                legacy_roots.run_migration(self.roots, apply=True)

        self.assertTrue(source.exists())
        self.assertFalse(self.roots.receipt_path.exists())

    def test_interrupted_directory_swap_is_recovered_before_overlay(self) -> None:
        source = self.roots.home / ".cache" / "cm6_editor" / "projects"
        destination = self.roots.data_home / "code_te2" / "projects"
        _write_json(source / "legacy.json", _sidecar("/legacy"))
        _write_json(destination / "canonical.json", _sidecar("/canonical"))
        spec = next(
            item for item in legacy_roots.migration_specs(self.roots)
            if item.action_id == "code-te2-projects"
        )
        stage, backup = legacy_roots._transaction_paths(spec)
        backup.parent.mkdir(parents=True, exist_ok=True)
        os.replace(destination, backup)
        _write_json(stage / "discarded.json", _sidecar("/discarded"))

        legacy_roots.run_migration(self.roots, apply=True)

        self.assertTrue((destination / "canonical.json").is_file())
        self.assertTrue((destination / "legacy.json").is_file())
        self.assertFalse((destination / "discarded.json").exists())
        self.assertFalse(stage.exists())
        self.assertFalse(backup.exists())

    def test_existing_receipt_refuses_second_apply(self) -> None:
        _write_json(self.roots.receipt_path, {"version": 1})

        with self.assertRaisesRegex(
            legacy_roots.MigrationAlreadyAppliedError,
            "receipt already exists",
        ):
            legacy_roots.run_migration(self.roots, apply=True)

    def test_external_code_server_config_and_app_server_content_are_report_only(self) -> None:
        config = self.roots.home / ".config" / "code-server" / "config.yaml"
        conversation = self.roots.home / ".cache" / "app_server" / "conversations" / "keep"
        _write(config, b"bind-addr: 127.0.0.1:8080\n")
        _write(conversation, b"keep")

        legacy_roots.run_migration(self.roots, apply=True)

        self.assertTrue(config.exists())
        self.assertTrue(conversation.exists())


class PhaseThreeDPathTests(unittest.TestCase):
    def test_app_data_state_is_separate_from_installable_app_source(self) -> None:
        root = Path("/example/data")
        state = te2_app_data_home(
            "aria_downloader",
            {"TE2_DATA_HOME": str(root), "HOME": "/home/test"},
        )

        self.assertEqual(root / "app_state" / "aria_downloader", state)
        self.assertNotEqual(root / "apps" / "aria_downloader", state)

    def test_app_data_state_rejects_path_traversal_ids(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid TE2 app id"):
            te2_app_data_home("../escape", {"TE2_DATA_HOME": "/data"})

    def test_app_registry_uses_canonical_explicit_data_root(self) -> None:
        with mock.patch.dict(
            os.environ,
            {"TE2_DATA_HOME": "/custom/te2-data"},
            clear=False,
        ):
            self.assertEqual(Path("/custom/te2-data"), app_registry.te2_data_root())
            self.assertEqual(Path("/custom/te2-data/apps"), app_registry.te2_apps_root())

    def test_cli_dispatches_migration_without_loading_framework_bootstrap(self) -> None:
        with (
            mock.patch.object(legacy_roots, "main", return_value=17) as migration_main,
            mock.patch.object(run_rust_framework, "_load_bootstrap_module") as bootstrap,
            mock.patch.object(
                run_rust_framework.sys,
                "argv",
                ["te2", "migrate-legacy-roots", "--json"],
            ),
        ):
            result = run_rust_framework.main()

        self.assertEqual(17, result)
        migration_main.assert_called_once_with(["--json"])
        bootstrap.assert_not_called()


def _sidecar(project: str, *, marker: str | None = None) -> dict[str, object]:
    payload: dict[str, object] = {"version": 2, "project_path": project}
    if marker is not None:
        payload["marker"] = marker
    return payload


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _read_json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise AssertionError(f"expected object: {path}")
    return value


def _write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


if __name__ == "__main__":
    unittest.main()
