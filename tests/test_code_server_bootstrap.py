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

    def test_supported_code_version_range_is_1_127_through_1_130(self) -> None:
        self.assertFalse(code_server_bootstrap.is_supported_code_version("1.126.9"))
        self.assertTrue(code_server_bootstrap.is_supported_code_version("1.127.0"))
        self.assertTrue(code_server_bootstrap.is_supported_code_version("1.130.99"))
        self.assertFalse(code_server_bootstrap.is_supported_code_version("1.131.0"))
        self.assertFalse(code_server_bootstrap.is_supported_code_version("unknown"))

    def test_compatible_existing_installation_is_used_without_installing(self) -> None:
        existing = _installation(self.root / "existing")
        with (
            patch.object(
                code_server_bootstrap,
                "resolve_code_server_installation",
                return_value=existing,
            ),
            patch.object(
                code_server_bootstrap,
                "get_code_server_version",
                return_value={
                    "version": "4.127.0",
                    "commit": "abc1234",
                    "code_version": "1.127.0",
                },
            ),
            patch.object(
                code_server_bootstrap,
                "te2_managed_code_server_installation",
            ) as managed,
        ):
            prerequisite = code_server_bootstrap.inspect_code_server_prerequisite()
            resolved = code_server_bootstrap.ensure_code_server_installation()

        self.assertTrue(prerequisite.compatible)
        self.assertIs(existing, resolved)
        managed.assert_not_called()

    def test_incompatible_installation_never_bootstraps_without_consent(self) -> None:
        existing = _installation(self.root / "old")
        with (
            patch.object(
                code_server_bootstrap,
                "resolve_code_server_installation",
                return_value=existing,
            ),
            patch.object(
                code_server_bootstrap,
                "get_code_server_version",
                return_value={
                    "version": "4.126.0",
                    "commit": "abc1234",
                    "code_version": "1.126.0",
                },
            ),
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

        self.assertEqual("incompatible", prerequisite.state)
        linux_install.assert_not_called()
        android_install.assert_not_called()

    def test_verified_private_installation_replaces_incompatible_external_selection(self) -> None:
        external = _installation(self.root / "external", source="PATH")
        managed = _installation(self.root / "managed", source="te2-managed")

        def version(installation: CodeServerInstallation) -> dict[str, object]:
            if installation is managed:
                return {
                    "version": "4.130.0",
                    "commit": "managed1",
                    "code_version": "1.130.0",
                }
            return {
                "version": "4.126.0",
                "commit": "external1",
                "code_version": "1.126.0",
            }

        with (
            patch.object(
                code_server_bootstrap,
                "resolve_code_server_installation",
                return_value=external,
            ),
            patch.object(
                code_server_bootstrap,
                "te2_managed_code_server_installation",
                return_value=managed,
            ),
            patch.object(
                code_server_bootstrap,
                "get_code_server_version",
                side_effect=version,
            ),
            patch.object(
                code_server_bootstrap,
                "select_code_server_runtime_installation",
            ) as select,
        ):
            prerequisite = code_server_bootstrap.inspect_code_server_prerequisite()

        self.assertTrue(prerequisite.compatible)
        self.assertIs(managed, prerequisite.installation)
        select.assert_called_once_with(managed)

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
