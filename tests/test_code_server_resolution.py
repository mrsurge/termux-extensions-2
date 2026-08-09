from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from typing import override

from app.apps.file_editor_cm6 import extension_registry


REPO_ROOT = Path(__file__).resolve().parents[1]
RESOLUTION_ENV_KEYS = (
    "NVM_BIN",
    "NVM_DIR",
    "PREFIX",
    "TE2_BUILTIN_EXTENSIONS_DIR",
    "TE2_CODE_SERVER_BIN",
    "TE2_CODE_SERVER_ROOT",
    "TE2_DATA_HOME",
    "TE2_EXTENSION_HOST_BUNDLE",
    "TE2_EXT_HOST_PROTOCOL_SOURCE",
    "XDG_DATA_HOME",
)


def _make_executable(path: Path, body: str = "#!/usr/bin/env sh\nexit 0\n") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)
    return path


def _make_vscode_root(code_server_root: Path) -> Path:
    vscode_root = code_server_root / "lib" / "vscode"
    (vscode_root / "extensions").mkdir(parents=True)
    bundle = (
        vscode_root
        / "out"
        / "vs"
        / "workbench"
        / "api"
        / "node"
        / "extensionHostProcess.js"
    )
    bundle.parent.mkdir(parents=True)
    bundle.write_text("var x={MainThreadA:n(\"MainThreadA\")};", encoding="utf-8")
    return vscode_root


class CodeServerResolutionTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str]
    root: Path
    saved_env: dict[str, str | None]

    @override
    def setUp(self) -> None:
        scratch_root = Path(os.environ.get("TEMPDIR") or REPO_ROOT / ".codex-scratch")
        scratch_root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = tempfile.TemporaryDirectory(dir=scratch_root)
        self.root = Path(self.temp_dir.name)
        self.saved_env = {key: os.environ.get(key) for key in RESOLUTION_ENV_KEYS}
        for key in RESOLUTION_ENV_KEYS:
            os.environ.pop(key, None)
        os.environ["XDG_DATA_HOME"] = str(self.root / "data")
        extension_registry.select_code_server_runtime_installation(None)

    @override
    def tearDown(self) -> None:
        extension_registry.select_code_server_runtime_installation(None)
        for key, value in self.saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.temp_dir.cleanup()

    def test_managed_termux_wrapper_finds_private_package_layout(self) -> None:
        install_root = (
            Path(os.environ["XDG_DATA_HOME"])
            / "te2"
            / "code_server"
            / extension_registry.PINNED_CODE_SERVER_VERSION
        )
        launcher = _make_executable(
            install_root / "bin" / "code-server",
            (
                "#!/data/data/com.termux/files/usr/bin/sh\n"
                'ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\n'
                'exec "$ROOT/lib/code-server/bin/code-server" "$@"\n'
            ),
        )
        package_root = install_root / "lib" / "code-server"
        _make_executable(package_root / "bin" / "code-server")
        vscode_root = _make_vscode_root(package_root)

        installation = extension_registry.resolve_code_server_installation()

        self.assertIsNotNone(installation)
        assert installation is not None
        self.assertEqual(launcher, installation.executable)
        self.assertEqual(vscode_root, installation.vscode_root)
        self.assertEqual("te2-managed", installation.source)

    def test_external_installations_and_overrides_are_ignored(self) -> None:
        external = _make_executable(self.root / "external" / "bin" / "code-server")
        _make_vscode_root(self.root / "external")
        os.environ["TE2_CODE_SERVER_BIN"] = str(external)
        os.environ["TE2_CODE_SERVER_ROOT"] = str(self.root / "external")
        os.environ["NVM_BIN"] = str(external.parent)
        os.environ["PREFIX"] = str(self.root / "external")

        self.assertIsNone(extension_registry.resolve_code_server_installation())

    def test_only_the_pinned_managed_version_is_considered(self) -> None:
        managed_root = Path(os.environ["XDG_DATA_HOME"]) / "te2" / "code_server"
        other_root = managed_root / "99.0.0"
        _make_executable(other_root / "bin" / "code-server")
        _make_vscode_root(other_root)

        self.assertIsNone(extension_registry.resolve_code_server_installation())

    def test_bundle_and_builtin_discovery_ignore_environment_overrides(self) -> None:
        install_root = (
            Path(os.environ["XDG_DATA_HOME"])
            / "te2"
            / "code_server"
            / extension_registry.PINNED_CODE_SERVER_VERSION
        )
        launcher = _make_executable(install_root / "bin" / "code-server")
        vscode_root = _make_vscode_root(install_root)
        override_bundle = self.root / "override" / "extensionHostProcess.js"
        override_bundle.parent.mkdir(parents=True)
        override_bundle.write_text("override", encoding="utf-8")
        os.environ["TE2_EXTENSION_HOST_BUNDLE"] = str(override_bundle)
        os.environ["TE2_BUILTIN_EXTENSIONS_DIR"] = str(self.root / "override")

        installation = extension_registry.resolve_code_server_installation()

        self.assertIsNotNone(installation)
        assert installation is not None
        expected_bundle = (
            vscode_root
            / "out"
            / "vs"
            / "workbench"
            / "api"
            / "node"
            / "extensionHostProcess.js"
        )
        self.assertEqual(str(expected_bundle), extension_registry._find_ext_host_bundle())
        self.assertEqual(
            str(vscode_root / "extensions"),
            extension_registry._find_builtin_extensions_dir(),
        )
        self.assertEqual(launcher, installation.executable)

    def test_shellspec_uses_resolved_binary_and_prepends_its_bin_directory(self) -> None:
        shellspec = (
            REPO_ROOT / "app/apps/file_editor_cm6/shellspec/code_server.yaml"
        ).read_text(encoding="utf-8")
        self.assertIn('"${ctx:CODE_SERVER_BIN}"', shellspec)
        self.assertIn("      - -c\n", shellspec)
        self.assertIn("PATH: ${ctx:CODE_SERVER_BIN_DIR}:${env:PATH}", shellspec)
        self.assertIn("TE_CODE_SERVER_BIN: ${ctx:CODE_SERVER_BIN}", shellspec)


if __name__ == "__main__":
    unittest.main()
