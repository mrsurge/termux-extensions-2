from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.apps.file_editor_cm6 import extension_registry


REPO_ROOT = Path(__file__).resolve().parents[1]
RESOLUTION_ENV_KEYS = (
    "NVM_BIN",
    "NVM_DIR",
    "PREFIX",
    "TE2_BUILTIN_EXTENSIONS_DIR",
    "TE2_CODE_SERVER_BIN",
    "TE2_CODE_SERVER_ROOT",
    "TE2_EXTENSION_HOST_BUNDLE",
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
    bundle = vscode_root / "out" / "vs" / "workbench" / "api" / "node" / "extensionHostProcess.js"
    bundle.parent.mkdir(parents=True)
    bundle.write_text("var x={MainThreadA:n(\"MainThreadA\")};", encoding="utf-8")
    return vscode_root


class CodeServerResolutionTests(unittest.TestCase):
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
        extension_registry.resolve_code_server_installation.cache_clear()

    def tearDown(self) -> None:
        extension_registry.resolve_code_server_installation.cache_clear()
        extension_registry.select_code_server_runtime_installation(None)
        for key, value in self.saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.temp_dir.cleanup()

    def test_nvm_default_version_resolves_launcher_and_vscode_root(self) -> None:
        nvm_root = self.root / "home" / "droid" / ".nvm"
        old_launcher = _make_executable(
            nvm_root / "versions" / "node" / "v20.18.0" / "bin" / "code-server"
        )
        self.assertTrue(old_launcher.is_file())

        version_root = nvm_root / "versions" / "node" / "v22.23.1"
        package_root = version_root / "lib" / "node_modules" / "code-server"
        entry = _make_executable(package_root / "out" / "node" / "entry.js", "#!/usr/bin/env node\n")
        launcher = version_root / "bin" / "code-server"
        launcher.parent.mkdir(parents=True)
        launcher.symlink_to(entry)
        _make_executable(
            version_root / "bin" / "node",
            "#!/usr/bin/env sh\nprintf '4.109.2 abc123 with Code 1.109.2\\n'\n",
        )
        vscode_root = _make_vscode_root(package_root)
        alias_path = nvm_root / "alias" / "default"
        alias_path.parent.mkdir(parents=True)
        alias_path.write_text("22\n", encoding="utf-8")
        os.environ["NVM_DIR"] = str(nvm_root)

        with (
            patch.object(extension_registry.shutil, "which", return_value=None),
            patch.object(extension_registry, "_login_shell_code_server", return_value=None),
        ):
            installation = extension_registry.resolve_code_server_installation()

        self.assertIsNotNone(installation)
        assert installation is not None
        self.assertEqual(launcher, installation.executable)
        self.assertEqual(vscode_root, installation.vscode_root)
        self.assertEqual("nvm", installation.source)
        subprocess_path = extension_registry._code_server_subprocess_env(installation)["PATH"]
        self.assertEqual(str(launcher.parent), subprocess_path.split(os.pathsep)[0])
        self.assertEqual(
            {
                "version": "4.109.2",
                "commit": "abc123",
                "code_version": "1.109.2",
            },
            extension_registry._get_code_server_version(installation),
        )

    def test_explicit_wrapper_override_finds_exec_target_layout(self) -> None:
        install_root = self.root / "opt" / "code-server"
        real_launcher = _make_executable(install_root / "bin" / "code-server")
        vscode_root = _make_vscode_root(install_root)
        wrapper = _make_executable(
            self.root / "custom-bin" / "code-server",
            f'#!/usr/bin/env sh\nexec "{real_launcher}" "$@"\n',
        )
        os.environ["TE2_CODE_SERVER_BIN"] = str(wrapper)

        installation = extension_registry.resolve_code_server_installation()

        self.assertIsNotNone(installation)
        assert installation is not None
        self.assertEqual(wrapper, installation.executable)
        self.assertEqual(vscode_root, installation.vscode_root)
        self.assertEqual("TE2_CODE_SERVER_BIN", installation.source)

    def test_login_shell_is_used_when_worker_path_has_no_code_server(self) -> None:
        install_root = self.root / "login-code-server"
        launcher = _make_executable(install_root / "bin" / "code-server")
        vscode_root = _make_vscode_root(install_root)

        with (
            patch.object(extension_registry.shutil, "which", return_value=None),
            patch.object(extension_registry, "_login_shell_code_server", return_value=launcher),
        ):
            installation = extension_registry.resolve_code_server_installation()

        self.assertIsNotNone(installation)
        assert installation is not None
        self.assertEqual(launcher, installation.executable)
        self.assertEqual(vscode_root, installation.vscode_root)
        self.assertEqual("login-shell", installation.source)

    def test_shellspec_uses_resolved_binary_and_prepends_its_bin_directory(self) -> None:
        shellspec = (REPO_ROOT / "app/apps/file_editor_cm6/shellspec/code_server.yaml").read_text(
            encoding="utf-8"
        )
        self.assertIn('"${ctx:CODE_SERVER_BIN}"', shellspec)
        self.assertIn("      - -c\n", shellspec)
        self.assertIn("PATH: ${ctx:CODE_SERVER_BIN_DIR}:${env:PATH}", shellspec)
        self.assertIn("TE_CODE_SERVER_BIN: ${ctx:CODE_SERVER_BIN}", shellspec)


if __name__ == "__main__":
    unittest.main()
