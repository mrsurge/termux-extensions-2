from __future__ import annotations

import json
from pathlib import Path
import shlex
import sys
import tempfile
import unittest
from unittest.mock import patch
from typing import Any, cast

from desktop_client import electron_runtime


IDENTITY = {
    "platform": "linux",
    "arch": "x64",
    "modules": "137",
    "node": "22.23.1",
}


class DesktopElectronRuntimeTests(unittest.TestCase):
    temporary = cast(tempfile.TemporaryDirectory[str], cast(object, None))
    home = Path()
    node = Path()
    npm = Path()
    environ: dict[str, str] = {}
    labels: list[str] = []

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.home = root / "home"
        self.home.mkdir()
        self.node = root / "toolchain" / "node"
        self.npm = root / "toolchain" / "npm"
        self.node.parent.mkdir()
        for executable in (self.node, self.npm):
            executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            executable.chmod(0o755)
        self.environ = {
            "HOME": str(self.home),
            "PATH": str(self.node.parent),
            "TE2_DATA_HOME": str(root / "data"),
            "TE2_CACHE_HOME": str(root / "cache"),
            "XDG_DATA_HOME": str(root / "xdg-data"),
        }
        self.labels: list[str] = []

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _fake_run_checked(
        self,
        command: list[str],
        *,
        cwd: Path,
        env: dict[str, str],
        label: str,
        timeout: int = 1800,
    ) -> None:
        del command, env, timeout
        self.labels.append(label)
        if label != "Electron application packaging":
            return
        output = cwd / "build" / "TE2Desktop-linux-x64"
        (output / "resources").mkdir(parents=True)
        (output / "resources" / "app.asar").write_bytes(b"asar")
        for name in ("TE2Desktop", "TE2Desktop-bin"):
            path = output / name
            path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            path.chmod(0o755)

    def _patches(self) -> tuple[Any, Any, Any, Any, Any]:
        return (
            patch.object(
                electron_runtime,
                "resolve_node_toolchain",
                return_value=(self.node, self.npm),
            ),
            patch.object(
                electron_runtime,
                "inspect_node_identity",
                return_value=IDENTITY.copy(),
            ),
            patch.object(electron_runtime, "_host_libc_name", return_value="glibc"),
            patch.object(
                electron_runtime,
                "_free_bytes",
                return_value=electron_runtime.MINIMUM_FREE_BYTES + 1,
            ),
            patch.object(electron_runtime, "_run_checked", side_effect=self._fake_run_checked),
        )

    def test_install_is_atomic_reusable_and_writes_xdg_integration(self) -> None:
        patches = self._patches()
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            first = electron_runtime.ensure_desktop_runtime(environ=self.environ)
            self.assertTrue(first.executable.is_file())
            self.assertTrue(first.launcher.is_file())
            self.assertEqual(
                self.labels,
                [
                    "Electron dependency installation",
                    "Electron source compilation",
                    "Electron application packaging",
                ],
            )
            second = electron_runtime.ensure_desktop_runtime(environ=self.environ)

        self.assertEqual(second.root, first.root)
        self.assertEqual(len(self.labels), 3)
        current = electron_runtime.desktop_runtime_base(self.environ) / "current"
        self.assertTrue(current.is_symlink())
        self.assertEqual(current.resolve(), first.root)
        integration = electron_runtime.desktop_integration_paths(self.environ)
        self.assertEqual(integration.wrapper.stat().st_mode & 0o777, 0o755)
        self.assertIn("desktop_client.electron_cli launch", integration.wrapper.read_text())
        self.assertIn(shlex.quote(sys.executable), integration.wrapper.read_text())
        desktop_entry = integration.desktop_entry.read_text()
        self.assertIn("Terminal=false", desktop_entry)
        self.assertIn(f'Exec="{integration.wrapper}"', desktop_entry)
        self.assertNotIn("TryExec=", desktop_entry)
        self.assertTrue(integration.icon.is_file())
        receipt = json.loads(integration.receipt.read_text(encoding="utf-8"))
        self.assertEqual(receipt["runtimeFingerprint"], first.fingerprint)

    def test_force_rebuild_replaces_same_fingerprint(self) -> None:
        patches = self._patches()
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            first = electron_runtime.ensure_desktop_runtime(environ=self.environ)
            marker = first.root / electron_runtime.RUNTIME_MARKER
            marker.write_text("broken", encoding="utf-8")
            repaired = electron_runtime.ensure_desktop_runtime(
                force=True,
                environ=self.environ,
            )
        self.assertEqual(first.root, repaired.root)
        self.assertEqual(len(self.labels), 6)
        self.assertIsNotNone(electron_runtime.current_desktop_runtime(self.environ))

    def test_low_disk_blocks_build_but_not_current_status(self) -> None:
        patches = self._patches()
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            runtime = electron_runtime.ensure_desktop_runtime(environ=self.environ)
        with patch.object(electron_runtime, "_free_bytes", return_value=0):
            status = electron_runtime.desktop_runtime_status(self.environ)
        self.assertTrue(status["installed"])
        self.assertEqual(status["runtimeRoot"], str(runtime.root))

    def test_uninstall_preserves_modified_integration_file(self) -> None:
        patches = self._patches()
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            electron_runtime.ensure_desktop_runtime(environ=self.environ)
        integration = electron_runtime.desktop_integration_paths(self.environ)
        integration.wrapper.write_text("user modified\n", encoding="utf-8")

        result = electron_runtime.uninstall_desktop_runtime(self.environ)

        self.assertTrue(integration.wrapper.is_file())
        preserved = cast(list[str], result["preserved"])
        self.assertIn(str(integration.wrapper), preserved)
        self.assertFalse(integration.desktop_entry.exists())
        self.assertFalse(integration.icon.exists())
        self.assertFalse(electron_runtime.desktop_runtime_base(self.environ).exists())

    def test_install_refuses_unowned_integration_file(self) -> None:
        integration = electron_runtime.desktop_integration_paths(self.environ)
        integration.wrapper.parent.mkdir(parents=True)
        integration.wrapper.write_text("unrelated command\n", encoding="utf-8")
        patches = self._patches()
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with self.assertRaisesRegex(
                electron_runtime.ElectronRuntimeError,
                "Refusing to overwrite an unowned",
            ):
                electron_runtime.ensure_desktop_runtime(environ=self.environ)
        self.assertEqual(
            integration.wrapper.read_text(encoding="utf-8"),
            "unrelated command\n",
        )
        self.assertFalse(integration.desktop_entry.exists())
        self.assertFalse(integration.icon.exists())

    def test_rejects_unsupported_or_old_node_identity(self) -> None:
        with patch.object(electron_runtime, "_host_libc_name", return_value="glibc"):
            with self.assertRaisesRegex(electron_runtime.ElectronRuntimeError, "Linux x86-64"):
                electron_runtime._validate_identity(
                    {**IDENTITY, "platform": "android", "arch": "arm64"}
                )
            with self.assertRaisesRegex(electron_runtime.ElectronRuntimeError, "22.12.0"):
                electron_runtime._validate_identity({**IDENTITY, "node": "20.19.0"})

    def test_packaged_source_is_bounded(self) -> None:
        names = [name for name, _path in electron_runtime._iter_source_files()]
        self.assertIn("electron/package-lock.json", names)
        self.assertIn("android_shell/settings.html", names)
        self.assertIn("desktop_asset_inventory.json", names)
        self.assertIn(
            "app/apps/code_te2/main_page/frontend/ui/component-runtime/index.ts",
            names,
        )
        self.assertIn("app/static/js/te_dialog.mjs", names)
        self.assertIn("app/static/js/te_modal_surface_portal.mjs", names)
        self.assertFalse(any("node_modules" in name for name in names))
        self.assertFalse(any(name.startswith("electron/build/") for name in names))
        self.assertFalse(any(name.endswith(".test.ts") for name in names))
        self.assertFalse(any("heap" in name.lower() for name in names))
        self.assertFalse(any("tracemalloc" in name for name in names))
        self.assertFalse(any("process-tree-samples" in name for name in names))
        self.assertFalse(any(name.endswith("/README.md") for name in names))


if __name__ == "__main__":
    unittest.main()
