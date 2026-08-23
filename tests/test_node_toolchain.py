from __future__ import annotations

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
                executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                executable.chmod(0o755)
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

    def test_missing_toolchain_reports_override_names(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(node_toolchain, "_login_shell_node_pair", return_value=None):
                with self.assertRaisesRegex(
                    node_toolchain.NodeToolchainError,
                    "TE2_TEST_NODE and TE2_TEST_NPM",
                ):
                    node_toolchain.resolve_node_toolchain(
                        node_override_key="TE2_TEST_NODE",
                        npm_override_key="TE2_TEST_NPM",
                        environ={"HOME": str(root), "PATH": ""},
                    )


if __name__ == "__main__":
    unittest.main()
