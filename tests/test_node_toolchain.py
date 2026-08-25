from __future__ import annotations

from importlib.machinery import ModuleSpec
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app import node_toolchain


class NodeToolchainTests(unittest.TestCase):
    def test_explicit_toolchain_wins_without_shell_probe(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            node = root / "bin" / "node"
            npm = root / "bin" / "npm"
            node.parent.mkdir()
            for executable in (node, npm):
                _ = executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                _ = executable.chmod(0o755)
            environ = {
                "HOME": str(root),
                "PATH": "",
                "TE2_TEST_NODE": str(node),
                "TE2_TEST_NPM": str(npm),
            }
            with patch.object(
                node_toolchain,
                "_login_shell_node_pair",
                side_effect=AssertionError("login shell should not be probed"),
            ):
                resolved = node_toolchain.resolve_node_toolchain(
                    node_override_key="TE2_TEST_NODE",
                    npm_override_key="TE2_TEST_NPM",
                    environ=environ,
                )
            self.assertEqual(resolved, (node, npm))

    def test_current_python_environment_toolchain_precedes_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            python = root / "venv" / "bin" / "python"
            venv_node = python.parent / "node"
            venv_npm = python.parent / "npm"
            path_node = root / "path" / "node"
            path_npm = root / "path" / "npm"
            for executable in (python, venv_node, venv_npm, path_node, path_npm):
                executable.parent.mkdir(parents=True, exist_ok=True)
                _ = executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                _ = executable.chmod(0o755)

            with patch("app.node_toolchain.sys.executable", str(python)):
                resolved = node_toolchain.resolve_node_toolchain(
                    node_override_key="TE2_TEST_NODE",
                    npm_override_key="TE2_TEST_NPM",
                    environ={"HOME": str(root), "PATH": str(path_node.parent)},
                )

            self.assertEqual(resolved, (venv_node, venv_npm))

    def test_nodejs_wheel_headers_are_exported_for_node_gyp(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            python = root / "venv" / "bin" / "python"
            node = python.parent / "node"
            package_root = root / "venv" / "lib" / "nodejs_wheel"
            header = package_root / "include" / "node" / "node.h"
            for path in (python, node):
                path.parent.mkdir(parents=True, exist_ok=True)
                _ = path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                _ = path.chmod(0o755)
            header.parent.mkdir(parents=True)
            _ = header.write_text("", encoding="utf-8")
            module = package_root / "__init__.py"
            _ = module.write_text("", encoding="utf-8")
            spec = ModuleSpec("nodejs_wheel", loader=None, origin=str(module))

            with (
                patch("app.node_toolchain.sys.executable", str(python)),
                patch("app.node_toolchain.importlib.util.find_spec", return_value=spec),
            ):
                env = node_toolchain.node_toolchain_env(node, environ={"PATH": ""})

            self.assertEqual(env["npm_config_nodedir"], str(package_root))
            self.assertEqual(env["PATH"].split(":")[0], str(node.parent))

    def test_missing_toolchain_reports_override_names(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with (
                patch.object(
                    node_toolchain,
                    "_python_environment_node_pair",
                    return_value=None,
                ),
                patch.object(
                    node_toolchain,
                    "_login_shell_node_pair",
                    return_value=None,
                ),
            ):
                with self.assertRaisesRegex(
                    node_toolchain.NodeToolchainError,
                    "TE2_TEST_NODE and TE2_TEST_NPM",
                ):
                    _ = node_toolchain.resolve_node_toolchain(
                        node_override_key="TE2_TEST_NODE",
                        npm_override_key="TE2_TEST_NPM",
                        environ={"HOME": str(root), "PATH": ""},
                    )


if __name__ == "__main__":
    _ = unittest.main()
