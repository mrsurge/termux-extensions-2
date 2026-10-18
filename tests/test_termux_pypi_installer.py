"""PyPI staging tests: no network, apt installs, native builds or live activation."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("termux_pypi_installer", ROOT / "release/installer/install_te2.py")
assert SPEC and SPEC.loader
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class TermuxPyPIInstallerTests(unittest.TestCase):
    def test_stages_binary_only_pypi_tree_and_validates_before_activation(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            prefix = root / "prefix"
            calls = []

            def run(command, **kwargs):
                calls.append((command, kwargs))
                if "pip" in command:
                    tree = Path(command[command.index("--target") + 1])
                    server = tree / "app/release_runtime/bin/te2-server"
                    server.parent.mkdir(parents=True)
                    server.write_bytes(b"wheel server")
                    return SimpleNamespace(returncode=0)
                return SimpleNamespace(stdout=json.dumps({
                    "server": str(Path(kwargs["cwd"]) / "python/app/release_runtime/bin/te2-server"),
                    "distribution": {"version": "0.2.354", "frameworkShellsVersion": "0.2.65",
                                     "agentLogServerVersion": "0.2.139"},
                }))

            with patch.object(installer.subprocess, "run", side_effect=run), \
                 patch.object(installer, "_inspect_server_build_info", return_value={"version": "0.2.354"}), \
                 patch.object(installer, "_validate_installed_tree") as validate, \
                 patch.dict(os.environ, {"PYTHONPATH": "untrusted", "PYTHONHOME": "untrusted"}):
                stage = installer._materialize_termux_pypi_release(root, prefix, "0.2.354")
            pip, environment = calls[0]
            self.assertIn("--isolated", pip)
            self.assertIn("--only-binary=:all:", pip)
            self.assertIn("te2==0.2.354", pip)
            self.assertNotIn("--no-deps", pip)
            self.assertEqual(pip[pip.index("--index-url") + 1], "https://pypi.org/simple")
            self.assertNotIn("PYTHONHOME", environment["env"])
            self.assertEqual(environment["cwd"], stage)
            self.assertEqual((stage / "libexec/te2-server").read_bytes(), b"wheel server")
            validate.assert_called_once()
            self.assertEqual(json.loads((stage / "install-receipt.json").read_text())["source"], "pypi")
            self.assertFalse((root / "current").exists())

    def test_missing_wheel_cleans_stage_preserving_current_release(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            current = root / "current"
            current.symlink_to("releases/previous")
            with patch.object(installer.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "pip")):
                with self.assertRaisesRegex(SystemExit, "no source-build fallback"):
                    installer._materialize_termux_pypi_release(root, root / "prefix", "0.2.354")
            self.assertEqual(os.readlink(current), "releases/previous")
            self.assertEqual(list((root / "releases").iterdir()), [])

    def test_pypi_route_never_reads_legacy_payload(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            args = SimpleNamespace(desktop=False, prefix=None, uninstall=False, rollback=None,
                                   release_version="0.2.354", yes=True)
            with patch.object(installer, "_resolve_prefix", return_value=root / "prefix"), \
                 patch.object(installer.sys, "version_info", (3, 14, 6)), \
                 patch.object(installer.platform, "machine", return_value="aarch64"), \
                 patch.object(installer, "_ensure_prerequisites"), \
                 patch.object(installer, "_check_free_space"), \
                 patch.object(installer, "_load_manifest", side_effect=AssertionError("legacy payload")), \
                 patch.object(installer, "_materialize_termux_pypi_release", return_value=root / "stage") as stage, \
                 patch.object(installer, "_activate_release") as activate:
                self.assertEqual(installer._run_termux(args, root / "missing", root), 0)
            stage.assert_called_once_with(root, root / "prefix", "0.2.354")
            activate.assert_called_once_with(root, root / "prefix", root / "stage", "0.2.354")

    def test_termux_runtime_prerequisites_omit_retired_crypto_and_unused_bun(self) -> None:
        names = {item["name"] for item in installer.TERMUX_APT_PACKAGES}
        self.assertFalse(names & {"python-cryptography", "bun"})
        self.assertTrue({"python", "python-pip", "nodejs-lts", "libarchive", "libgit2"} <= names)
