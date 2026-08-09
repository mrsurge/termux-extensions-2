from __future__ import annotations

import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from typing import override
from unittest.mock import patch

from app.apps.file_editor_cm6 import code_server_bootstrap
from app.apps.file_editor_cm6.extension_registry import CodeServerInstallation


REPO_ROOT = Path(__file__).resolve().parents[1]


def _installation(root: Path, *, source: str = "test") -> CodeServerInstallation:
    executable = root / "bin" / "code-server"
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_text("#!/usr/bin/env sh\nexit 0\n", encoding="utf-8")
    executable.chmod(0o755)
    vscode_root = root / "lib" / "vscode"
    (vscode_root / "extensions").mkdir(parents=True, exist_ok=True)
    return CodeServerInstallation(executable, vscode_root, source)


class CodeServerBootstrapTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str]
    root: Path
    cache_dir: Path
    install_prefix: Path

    @override
    def setUp(self) -> None:
        scratch_root = Path(os.environ.get("TEMPDIR") or REPO_ROOT / ".codex-scratch")
        scratch_root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = tempfile.TemporaryDirectory(dir=scratch_root)
        self.root = Path(self.temp_dir.name)
        self.cache_dir = self.root / "cache"
        self.install_prefix = self.root / "data" / "te2" / "code_server" / "4.130.0"

    @override
    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_bootstrap_download_cache_uses_explicit_te2_cache_root(self) -> None:
        cache_home = self.root / "te2-cache"
        with patch.dict(
            os.environ,
            {"TE2_CACHE_HOME": str(cache_home)},
            clear=False,
        ):
            self.assertEqual(
                code_server_bootstrap.code_server_bootstrap_cache_dir(),
                cache_home / "code_server" / "downloads",
            )

    def test_managed_installation_is_ready_without_command_version_gate(self) -> None:
        managed = _installation(self.root / "managed", source="te2-managed")
        with (
            patch.object(
                code_server_bootstrap,
                "te2_managed_code_server_installation",
                return_value=managed,
            ),
            patch.object(code_server_bootstrap, "get_code_server_version") as version,
        ):
            prerequisite = code_server_bootstrap.inspect_code_server_prerequisite()
            resolved = code_server_bootstrap.ensure_code_server_installation()

        self.assertTrue(prerequisite.compatible)
        self.assertIs(managed, resolved)
        version.assert_not_called()

    def test_missing_managed_installation_never_bootstraps_without_consent(self) -> None:
        with (
            patch.object(
                code_server_bootstrap,
                "te2_managed_code_server_installation",
                return_value=None,
            ),
            patch.object(code_server_bootstrap, "_install_official_code_server") as linux_install,
            patch.object(code_server_bootstrap, "_install_android_code_server") as android_install,
        ):
            prerequisite = code_server_bootstrap.inspect_code_server_prerequisite()
            with self.assertRaisesRegex(
                code_server_bootstrap.CodeServerBootstrapError,
                "requires user confirmation",
            ):
                code_server_bootstrap.ensure_code_server_installation()

        self.assertEqual("missing", prerequisite.state)
        linux_install.assert_not_called()
        android_install.assert_not_called()

    def test_managed_installation_requires_the_bundled_code_tree(self) -> None:
        managed = _installation(self.root / "managed", source="te2-managed")
        managed = CodeServerInstallation(managed.executable, None, managed.source)
        with (
            patch.object(
                code_server_bootstrap,
                "te2_managed_code_server_installation",
                return_value=managed,
            ),
        ):
            prerequisite = code_server_bootstrap.inspect_code_server_prerequisite()

        self.assertFalse(prerequisite.compatible)
        self.assertEqual("incompatible", prerequisite.state)
        self.assertIs(managed, prerequisite.installation)
        self.assertIn("bundled Code/extension-host tree", prerequisite.reason)

    def test_remove_managed_runtime_preserves_sibling_extension_data(self) -> None:
        self.install_prefix.mkdir(parents=True)
        (self.install_prefix / "runtime.txt").write_text("runtime", encoding="utf-8")
        extensions = self.root / "config" / "code-server" / "extensions"
        extensions.mkdir(parents=True)
        (extensions / "keep.txt").write_text("extension", encoding="utf-8")

        with (
            patch.object(
                code_server_bootstrap,
                "code_server_install_prefix",
                return_value=self.install_prefix,
            ),
            patch.object(
                code_server_bootstrap,
                "code_server_bootstrap_cache_dir",
                return_value=self.cache_dir,
            ),
        ):
            removed = code_server_bootstrap.remove_code_server_installation()

        self.assertTrue(removed)
        self.assertFalse(self.install_prefix.exists())
        self.assertEqual(
            "extension",
            (extensions / "keep.txt").read_text(encoding="utf-8"),
        )

    def test_official_installer_uses_standalone_private_prefix(self) -> None:
        script = b"#!/usr/bin/env sh\n"
        observed_command: list[str] = []
        observed_env: dict[str, str] = {}

        def run_checked(command: list[str], **kwargs: object) -> None:
            observed_command.extend(command)
            raw_env = kwargs.get("env")
            if isinstance(raw_env, dict):
                observed_env.update(
                    {
                        str(key): str(value)
                        for key, value in raw_env.items()
                    }
                )
            prefix_arg = next(part for part in command if part.startswith("--prefix="))
            stage = Path(prefix_arg.split("=", 1)[1])
            launcher = stage / "bin" / "code-server"
            launcher.parent.mkdir(parents=True)
            launcher.write_text("#!/usr/bin/env sh\n", encoding="utf-8")

        with (
            patch.object(code_server_bootstrap.shutil, "which", return_value="/bin/sh"),
            patch.object(code_server_bootstrap, "_fetch_install_script", return_value=script),
            patch.object(
                code_server_bootstrap,
                "_run_checked",
                side_effect=run_checked,
            ),
        ):
            code_server_bootstrap._install_official_code_server(
                self.install_prefix,
                self.cache_dir,
            )

        self.assertIn("--method=standalone", observed_command)
        self.assertIn("--version", observed_command)
        self.assertIn("4.130.0", observed_command)
        self.assertEqual(str(self.cache_dir), observed_env["XDG_CACHE_HOME"])
        self.assertTrue((self.install_prefix / "bin" / "code-server").is_file())

    def test_official_installer_rewrites_absolute_stage_launcher(self) -> None:
        def run_checked(command: list[str], **_kwargs: object) -> None:
            prefix_arg = next(part for part in command if part.startswith("--prefix="))
            stage = Path(prefix_arg.split("=", 1)[1])
            payload = (
                stage
                / "lib"
                / "code-server-4.130.0"
                / "bin"
                / "code-server"
            )
            payload.parent.mkdir(parents=True)
            payload.write_text("#!/usr/bin/env sh\n", encoding="utf-8")
            payload.chmod(0o755)
            launcher = stage / "bin" / "code-server"
            launcher.parent.mkdir(parents=True)
            launcher.symlink_to(payload)

        with (
            patch.object(code_server_bootstrap.shutil, "which", return_value="/bin/sh"),
            patch.object(
                code_server_bootstrap,
                "_fetch_install_script",
                return_value=b"#!/usr/bin/env sh\n",
            ),
            patch.object(
                code_server_bootstrap,
                "_run_checked",
                side_effect=run_checked,
            ),
        ):
            code_server_bootstrap._install_official_code_server(
                self.install_prefix,
                self.cache_dir,
            )

        launcher = self.install_prefix / "bin" / "code-server"
        self.assertTrue(launcher.is_file())
        self.assertTrue(launcher.is_symlink())
        self.assertEqual(
            os.readlink(launcher),
            "../lib/code-server-4.130.0/bin/code-server",
        )

    def test_existing_broken_stage_launcher_is_repaired_without_download(self) -> None:
        payload = (
            self.install_prefix
            / "lib"
            / "code-server-4.130.0"
            / "bin"
            / "code-server"
        )
        payload.parent.mkdir(parents=True)
        payload.write_text("#!/usr/bin/env sh\n", encoding="utf-8")
        payload.chmod(0o755)
        launcher = self.install_prefix / "bin" / "code-server"
        launcher.parent.mkdir(parents=True)
        stale_stage = (
            self.install_prefix.parent
            / ".4.130.0.1234.deadbeef.stage"
        )
        launcher.symlink_to(
            stale_stage / payload.relative_to(self.install_prefix)
        )

        repaired = code_server_bootstrap._repair_relocated_official_launcher(
            self.install_prefix
        )

        self.assertTrue(repaired)
        self.assertTrue(launcher.is_file())
        self.assertEqual(
            os.readlink(launcher),
            "../lib/code-server-4.130.0/bin/code-server",
        )

    def test_android_installs_only_runtime_dependencies_with_apt(self) -> None:
        with (
            patch.object(
                code_server_bootstrap,
                "_resolve_termux_command",
                return_value="/termux/bin/apt",
            ),
            patch.object(code_server_bootstrap, "_run_checked") as run_checked,
        ):
            code_server_bootstrap._install_android_dependencies()

        run_checked.assert_called_once_with(
            [
                "/termux/bin/apt",
                "install",
                "-y",
                *code_server_bootstrap.ANDROID_DEPENDENCIES,
            ],
            label="Android Code Server dependency installation",
            timeout_s=1200,
        )

    def test_android_package_is_extracted_into_private_prefix(self) -> None:
        package = self.root / "code-server.deb"
        package.write_bytes(b"package")
        observed_command: list[str] = []

        def run_checked(command: list[str], **_kwargs: object) -> None:
            observed_command.extend(command)
            extract_root = Path(command[-1])
            source = (
                extract_root
                / code_server_bootstrap.TERMUX_PACKAGE_PREFIX
                / "lib"
                / "code-server"
            )
            (source / "bin").mkdir(parents=True)
            (source / "bin" / "code-server").write_text(
                "#!/data/data/com.termux/files/usr/bin/sh\n",
                encoding="utf-8",
            )

        with (
            patch.dict(
                os.environ,
                {"PREFIX": "/data/data/com.termux/files/usr"},
                clear=False,
            ),
            patch.object(code_server_bootstrap.platform, "machine", return_value="aarch64"),
            patch.object(code_server_bootstrap, "_install_android_dependencies") as dependencies,
            patch.object(
                code_server_bootstrap,
                "_ensure_android_package",
                return_value=package,
            ),
            patch.object(
                code_server_bootstrap,
                "_resolve_termux_command",
                return_value="/termux/bin/dpkg-deb",
            ),
            patch.object(
                code_server_bootstrap,
                "_run_checked",
                side_effect=run_checked,
            ),
        ):
            code_server_bootstrap._install_android_code_server(
                self.cache_dir,
                self.install_prefix,
            )

        dependencies.assert_called_once_with()
        self.assertEqual("/termux/bin/dpkg-deb", observed_command[0])
        self.assertIn("--extract", observed_command)
        self.assertTrue((self.install_prefix / "lib" / "code-server").is_dir())
        launcher = self.install_prefix / "bin" / "code-server"
        self.assertTrue(launcher.is_file())
        self.assertIn(
            'exec "$ROOT/lib/code-server/bin/code-server" "$@"',
            launcher.read_text(encoding="utf-8"),
        )

    def test_android_checksum_failure_does_not_retain_package(self) -> None:
        def download(_url: str, destination: Path) -> None:
            destination.write_bytes(b"tampered")

        self.cache_dir.mkdir(parents=True)
        with (
            patch.object(code_server_bootstrap, "ANDROID_PACKAGE_SHA256", "0" * 64),
            patch.object(code_server_bootstrap, "_download_to_path", side_effect=download),
        ):
            with self.assertRaisesRegex(
                code_server_bootstrap.CodeServerBootstrapError,
                "failed SHA-256 verification",
            ):
                code_server_bootstrap._ensure_android_package(self.cache_dir)

        self.assertFalse(
            (self.cache_dir / code_server_bootstrap.ANDROID_PACKAGE_NAME).exists()
        )
        self.assertEqual([], list(self.cache_dir.glob("*.tmp")))

    def test_android_rejects_unsupported_architecture_before_dependencies(self) -> None:
        with (
            patch.object(code_server_bootstrap.platform, "machine", return_value="x86_64"),
            patch.object(code_server_bootstrap, "_install_android_dependencies") as dependencies,
        ):
            with self.assertRaisesRegex(
                code_server_bootstrap.CodeServerBootstrapError,
                "supports only aarch64",
            ):
                code_server_bootstrap._install_android_code_server(
                    self.cache_dir,
                    self.install_prefix,
                )

        dependencies.assert_not_called()

    def test_android_cached_package_digest_is_reused(self) -> None:
        payload = b"verified android package"
        expected_sha256 = hashlib.sha256(payload).hexdigest()
        self.cache_dir.mkdir(parents=True)
        package = self.cache_dir / code_server_bootstrap.ANDROID_PACKAGE_NAME
        package.write_bytes(payload)

        with (
            patch.object(code_server_bootstrap, "ANDROID_PACKAGE_SHA256", expected_sha256),
            patch.object(code_server_bootstrap, "_download_to_path") as download,
        ):
            resolved = code_server_bootstrap._ensure_android_package(self.cache_dir)

        self.assertEqual(package, resolved)
        download.assert_not_called()


if __name__ == "__main__":
    unittest.main()
