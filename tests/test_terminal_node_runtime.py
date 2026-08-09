from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.apps.terminal import node_runtime


class TerminalNodeRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        scratch_root = Path(
            os.environ.get("TEMPDIR")
            or Path(__file__).resolve().parents[1] / ".test-scratch"
        )
        scratch_root.mkdir(parents=True, exist_ok=True)
        self._scratch_root = scratch_root
        self._tempdir = tempfile.TemporaryDirectory(dir=scratch_root)
        self.root = Path(self._tempdir.name)

    def tearDown(self) -> None:
        self._tempdir.cleanup()
        try:
            self._scratch_root.rmdir()
        except OSError:
            pass

    def test_default_runtime_uses_te2_data_home(self) -> None:
        data_home = self.root / "data"
        with patch.dict(
            os.environ,
            {"XDG_DATA_HOME": str(data_home), "TE2_DATA_HOME": ""},
            clear=False,
        ):
            os.environ.pop("TE2_TERMINAL_NODE_RUNTIME_DIR", None)
            self.assertEqual(
                node_runtime.terminal_node_runtime_base(),
                data_home / "te2" / "node_runtime" / "terminal",
            )

    def test_explicit_runtime_directory_wins(self) -> None:
        explicit = self.root / "custom-runtime"
        with patch.dict(
            os.environ,
            {"TE2_TERMINAL_NODE_RUNTIME_DIR": str(explicit)},
            clear=False,
        ):
            self.assertEqual(node_runtime.terminal_node_runtime_base(), explicit)

    def test_runtime_marker_requires_every_production_package(self) -> None:
        runtime_root = self.root / "runtime"
        expected = {"fingerprint": "test"}
        runtime_root.mkdir()
        (runtime_root / ".te2-runtime.json").write_text(json.dumps(expected), encoding="utf-8")
        self.assertFalse(node_runtime._runtime_is_ready(runtime_root, expected))

        for package in node_runtime.RUNTIME_PACKAGES:
            package_root = runtime_root / "node_modules" / Path(*package.split("/"))
            package_root.mkdir(parents=True)
            (package_root / "package.json").write_text("{}\n", encoding="utf-8")
        self.assertTrue(node_runtime._runtime_is_ready(runtime_root, expected))

    def test_bootstrap_is_atomic_and_reuses_ready_runtime(self) -> None:
        runtime_base = self.root / "runtime-base"
        node_binary = self.root / "bin" / "node"
        npm_binary = self.root / "bin" / "npm"
        node_binary.parent.mkdir()
        node_binary.touch(mode=0o755)
        npm_binary.touch(mode=0o755)
        identity = {
            "platform": "test-os",
            "arch": "test-arch",
            "modules": "123",
            "node": "22.0.0",
        }

        def fake_install(
            stage: Path,
            _node: Path,
            _npm: Path,
            _identity: dict[str, str],
        ) -> None:
            stage.mkdir(parents=True)
            (stage / "package.json").write_text("{}\n", encoding="utf-8")
            for package in node_runtime.RUNTIME_PACKAGES:
                package_root = stage / "node_modules" / Path(*package.split("/"))
                package_root.mkdir(parents=True)
                (package_root / "package.json").write_text("{}\n", encoding="utf-8")

        with (
            patch.dict(
                os.environ,
                {"TE2_TERMINAL_NODE_RUNTIME_DIR": str(runtime_base)},
                clear=False,
            ),
            patch.object(node_runtime, "resolve_node_toolchain", return_value=(node_binary, npm_binary)),
            patch.object(node_runtime, "_node_identity", return_value=identity),
            patch.object(node_runtime, "_install_runtime", side_effect=fake_install) as install,
        ):
            first = node_runtime.ensure_terminal_node_runtime()
            second = node_runtime.ensure_terminal_node_runtime()

        self.assertEqual(first.root, second.root)
        self.assertEqual(first.fingerprint, second.fingerprint)
        self.assertEqual(install.call_count, 1)
        self.assertTrue((first.root / ".te2-runtime.json").is_file())
        self.assertFalse(any(runtime_base.glob("*.tmp")))

    def test_foreign_node_pty_prebuilds_are_pruned(self) -> None:
        stage = self.root / "stage"
        prebuilds = stage / "node_modules" / "node-pty" / "prebuilds"
        current = prebuilds / "linux-x64"
        foreign = prebuilds / "win32-x64"
        current.mkdir(parents=True)
        foreign.mkdir()
        (current / "pty.node").touch()
        (foreign / "pty.node").touch()

        node_runtime._prune_foreign_node_pty_prebuilds(
            stage,
            {"platform": "linux", "arch": "x64"},
        )

        self.assertTrue(current.is_dir())
        self.assertFalse(foreign.exists())

    def test_production_dependencies_are_backend_only(self) -> None:
        package = json.loads(node_runtime.PACKAGE_JSON.read_text(encoding="utf-8"))
        dependencies = set(package["dependencies"])
        dev_dependencies = set(package["devDependencies"])
        self.assertEqual(dependencies, set(node_runtime.RUNTIME_PACKAGES))
        self.assertIn("reconnecting-websocket", dev_dependencies)
        self.assertIn("@xterm/addon-web-fonts", dev_dependencies)


if __name__ == "__main__":
    unittest.main()
