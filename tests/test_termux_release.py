from __future__ import annotations

import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = _load("te2_termux_builder", ROOT / "release" / "termux" / "build_release.py")
installer = _load("te2_installer", ROOT / "release" / "installer" / "install_te2.py")
public_builder = _load(
    "te2_public_release_builder",
    ROOT / "release" / "build_public_release.py",
)


def _digest(payload: bytes) -> str:
    encoded = base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).rstrip(b"=")
    return f"sha256={encoded.decode()}"


def _wheel(path: Path, *, name: str = "example", version: str = "1.0", tag: str) -> Path:
    dist = name.replace("-", "_")
    info = f"{dist}-{version}.dist-info"
    files = {
        f"{dist}/__init__.py": b"",
        f"{info}/METADATA": f"Metadata-Version: 2.4\nName: {name}\nVersion: {version}\n".encode(),
        f"{info}/WHEEL": f"Wheel-Version: 1.0\nRoot-Is-Purelib: false\nTag: {tag}\n".encode(),
    }
    rows = [f"{member},{_digest(payload)},{len(payload)}" for member, payload in files.items()]
    record = f"{info}/RECORD"
    files[record] = ("\n".join([*rows, f"{record},,"]) + "\n").encode()
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        for member, payload in files.items():
            archive.writestr(member, payload)
    return path


def _termux_archive(
    path: Path,
    *,
    version: str = "0.2.338",
    source_commit: str = "a" * 40,
    publication_eligible: bool = True,
) -> Path:
    manifest = {
        "distribution": {
            "agentLogServerVersion": "0.2.119",
            "frameworkShellsVersion": "0.0.63",
            "name": "te2",
            "version": version,
        },
        "releaseProvenance": {
            "dirtyFirstParty": [] if publication_eligible else ["agent-log-server"],
            "publicationEligible": publication_eligible,
        },
        "schemaVersion": 1,
        "sources": {"te2Commit": source_commit},
    }
    payload = (json.dumps(manifest, sort_keys=True) + "\n").encode()
    with tarfile.open(path, "w:gz") as archive:
        info = tarfile.TarInfo(f"te2-{version}-termux-aarch64/target-manifest.json")
        info.size = len(payload)
        archive.addfile(info, io.BytesIO(payload))
    return path


def _write_public_download_fixture(root: Path, installer_payload: bytes) -> None:
    installer_name = "install_te2.py"
    (root / installer_name).write_bytes(installer_payload)
    manifest = {
        "release": {
            "publicationEligible": True,
            "sourceCommit": "a" * 40,
            "tag": "0.2.338",
            "version": "0.2.338",
        },
        "schemaVersion": 1,
        "targets": {
            "linux-glibc-x86_64": {"installer": installer_name},
            "termux-android-aarch64": {
                "archive": "te2-0.2.338-termux-aarch64.tar.gz"
            },
        },
    }
    (root / "release-manifest.json").write_text(
        json.dumps(manifest, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    lines = [
        f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}"
        for path in sorted(root.iterdir())
        if path.is_file()
    ]
    (root / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")


class TermuxReleaseBuilderTests(unittest.TestCase):
    def test_lock_is_complete_and_excludes_apt_owned_crypto_inputs(self) -> None:
        locked = builder._load_lock(ROOT / "release" / "termux" / "requirements.lock")
        self.assertEqual(len(locked), 93)
        self.assertNotIn("cryptography", locked)
        self.assertNotIn("cffi", locked)
        self.assertNotIn("pycparser", locked)
        self.assertEqual(locked["pydantic-core"], "2.46.4")

    def test_accepts_android_24_and_rejects_linux_native_wheel(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            valid = _wheel(
                root / "example-1.0-cp314-cp314-android_24_arm64_v8a.whl",
                tag="cp314-cp314-android_24_arm64_v8a",
            )
            record = builder._audit_wheel(valid)
            self.assertTrue(record["native"])
            invalid = _wheel(
                root / "example-1.0-cp314-cp314-manylinux_2_28_aarch64.whl",
                tag="cp314-cp314-manylinux_2_28_aarch64",
            )
            with self.assertRaisesRegex(RuntimeError, "unsupported platform tag"):
                builder._audit_wheel(invalid)

    def test_deterministic_archive_has_no_links(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            stage = root / "payload"
            stage.mkdir()
            (stage / "file.txt").write_text("payload\n", encoding="utf-8")
            first = root / "first.tar.gz"
            second = root / "second.tar.gz"
            builder._create_archive(stage, first, 1_700_000_000)
            builder._create_archive(stage, second, 1_700_000_000)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with tarfile.open(first, "r:gz") as archive:
                self.assertTrue(all(member.isreg() or member.isdir() for member in archive.getmembers()))

    def test_dirty_first_party_requires_explicit_validation_candidate_flag(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            wheel = root / "agent_log_server.whl"
            provenance = {
                "package_version": "0.2.119",
                "platform_tag": builder.TARGET_PLATFORM,
                "source_commit": "a" * 40,
                "source_dirty": True,
                "target": builder.TARGET_TRIPLE,
            }
            with ZipFile(wheel, "w") as archive:
                archive.writestr(
                    "agent_log_server_rs/bin/als-server.manifest.json",
                    json.dumps(provenance),
                )
            records = [{"name": "agent-log-server", "sourcePath": str(wheel)}]
            args = SimpleNamespace(
                agent_log_server_commit="a" * 40,
                agent_log_server_version="0.2.119",
                allow_dirty_first_party=False,
            )
            with self.assertRaisesRegex(RuntimeError, "dirty first-party"):
                builder._audit_first_party_provenance(records, args)
            args.allow_dirty_first_party = True
            self.assertEqual(
                builder._audit_first_party_provenance(records, args),
                ["agent-log-server"],
            )

    def test_manifest_installs_tur_before_runtime_packages(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            server = Path(raw) / "te2-server"
            server.write_bytes(b"server")
            args = SimpleNamespace(
                agent_log_server_commit="a" * 40,
                agent_log_server_version="0.2.119",
                ferrous_framework_commit="b" * 40,
                framework_shells_commit="c" * 40,
                framework_shells_version="0.0.63",
                source_commit="d" * 40,
                version="0.2.338",
            )

            manifest = builder._manifest(args, [], server, [])
            packages = manifest["aptPackages"]

            self.assertIsInstance(packages, list)
            self.assertEqual(packages[0]["name"], "tur-repo")
            self.assertEqual(packages[0]["minimumVersion"], "1.0.1")
            git = next(package for package in packages if package["name"] == "git")
            self.assertEqual(git["executables"], ["git"])


class LinuxInstallerTests(unittest.TestCase):
    def test_target_detection_checks_termux_before_generic_linux(self) -> None:
        with patch.object(installer.sys, "platform", "android"), patch.dict(
            os.environ,
            {"PREFIX": "/data/data/com.termux/files/usr"},
            clear=False,
        ):
            self.assertEqual(installer._detect_target(), installer.TERMUX_TARGET)

    def test_libarchive_selection_prefers_installed_supported_package(self) -> None:
        def installed(package: str) -> str | None:
            return "3.7.4" if package == "libarchive13" else None

        with patch.object(installer, "_dpkg_version", side_effect=installed), patch.object(
            installer.subprocess,
            "run",
        ) as run:
            self.assertEqual(installer._select_linux_libarchive_package(), "libarchive13")
            run.assert_not_called()

    def test_linux_activation_uses_current_venv_wrappers(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            install = root / "data" / "install"
            releases = install / "releases"
            releases.mkdir(parents=True)
            stage = releases / ".0.2.338.stage-test"
            (stage / "venv" / "bin").mkdir(parents=True)
            for command in installer.MANAGED_COMMANDS:
                executable = stage / "venv" / "bin" / command
                executable.write_text("#!/bin/sh\n", encoding="utf-8")
                executable.chmod(0o755)
            (stage / "install-receipt.json").write_text("{}\n", encoding="utf-8")
            bin_dir = root / "home" / ".local" / "bin"

            with patch.object(installer, "_validate_linux_release"):
                installer._activate_linux_release(install, bin_dir, stage, "0.2.338")

            self.assertEqual(os.readlink(install / "current"), "releases/0.2.338")
            for command in installer.MANAGED_COMMANDS:
                wrapper = bin_dir / command
                body = wrapper.read_text(encoding="utf-8")
                self.assertIn(installer.MANAGED_MARKER, body)
                self.assertIn(f'executable="$venv/bin/{command}"', body)

    def test_venv_relocation_rewrites_generated_absolute_paths(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            source = root / "releases" / ".stage" / "venv"
            target = root / "releases" / "0.2.338" / "venv"
            (source / "bin").mkdir(parents=True)
            script = source / "bin" / "te2"
            script.write_text(f"#!{source}/bin/python\n", encoding="utf-8")
            script.chmod(0o755)
            (source / "pyvenv.cfg").write_text(
                f"command = /usr/bin/python3 -m venv {source}\n",
                encoding="utf-8",
            )

            installer._relocate_linux_venv(source, target)

            self.assertEqual(script.read_text(encoding="utf-8"), f"#!{target}/bin/python\n")
            self.assertIn(str(target), (source / "pyvenv.cfg").read_text(encoding="utf-8"))

    def test_desktop_config_seeds_stable_managed_venv_and_command(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            home = root / "home"
            install = root / "data" / "install"
            bin_dir = home / ".local" / "bin"
            config_root = root / "config"
            with patch.dict(
                os.environ,
                {"TE2_CONFIG_HOME": str(config_root)},
                clear=False,
            ):
                path = installer._seed_desktop_local_framework_config(
                    install_root=install,
                    bin_dir=bin_dir,
                    home=home,
                )

            config = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(config["command"], str(bin_dir / "te2"))
            self.assertEqual(config["venvPath"], str(install / "current" / "venv"))
            self.assertEqual(config["broadcast"], [])
            self.assertEqual(config["port"], 8089)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_desktop_install_delegates_to_installed_te2_command(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            home = root / "home"
            data_home = root / "data"
            install = data_home / "install"
            release = install / "releases" / "0.2.338"
            te2 = release / "venv" / "bin" / "te2"
            te2.parent.mkdir(parents=True)
            te2.write_text("#!/bin/sh\n", encoding="utf-8")
            te2.chmod(0o755)
            bin_dir = home / ".local" / "bin"
            config_root = root / "config"
            with patch.dict(
                os.environ,
                {"TE2_CONFIG_HOME": str(config_root)},
                clear=False,
            ), patch.object(installer.subprocess, "run") as run:
                installer._install_linux_desktop(
                    release,
                    install_root=install,
                    bin_dir=bin_dir,
                    data_home=data_home,
                    home=home,
                )

            command = run.call_args.args[0]
            environment = run.call_args.kwargs["env"]
            self.assertEqual(command, [str(te2), "desktop", "install"])
            self.assertEqual(environment["VIRTUAL_ENV"], str(release / "venv"))
            self.assertEqual(environment["TE2_DATA_HOME"], str(data_home))
            self.assertTrue((config_root / "desktop-local-framework.json").is_file())

    def test_desktop_config_preserves_user_policy_while_filling_empty_paths(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            home = root / "home"
            install = root / "data" / "install"
            bin_dir = home / ".local" / "bin"
            config_root = root / "config"
            config_root.mkdir()
            path = config_root / "desktop-local-framework.json"
            path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "command": "",
                        "venvPath": "",
                        "broadcast": ["tailscale0"],
                        "port": 9010,
                        "env": {"EXAMPLE": "value"},
                    }
                ),
                encoding="utf-8",
            )
            with patch.dict(
                os.environ,
                {"TE2_CONFIG_HOME": str(config_root)},
                clear=False,
            ):
                installer._seed_desktop_local_framework_config(
                    install_root=install,
                    bin_dir=bin_dir,
                    home=home,
                )

            config = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(config["command"], str(bin_dir / "te2"))
            self.assertEqual(config["venvPath"], str(install / "current" / "venv"))
            self.assertEqual(config["broadcast"], ["tailscale0"])
            self.assertEqual(config["port"], 9010)
            self.assertEqual(config["env"], {"EXAMPLE": "value"})

    def test_release_version_can_drive_linux_without_target_payload(self) -> None:
        self.assertEqual(installer._release_version("0.2.338"), "0.2.338")
        with self.assertRaisesRegex(SystemExit, "Invalid TE2 release version"):
            installer._release_version("latest")


class PublicReleaseTests(unittest.TestCase):
    def test_builder_emits_curl_manifest_and_checksums(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = _termux_archive(root / "te2-0.2.338-termux-aarch64.tar.gz")
            output = root / "public"
            argv = [
                "build_public_release.py",
                "--output",
                str(output),
                "--version",
                "0.2.338",
                "--source-commit",
                "a" * 40,
                "--termux-archive",
                str(archive),
            ]
            with patch.object(sys, "argv", argv), patch.object(
                public_builder,
                "_git_output",
                side_effect=["a" * 40, ""],
            ):
                self.assertEqual(public_builder.main(), 0)

            manifest = json.loads(
                (output / "release-manifest.json").read_text(encoding="utf-8")
            )
            self.assertTrue(manifest["release"]["publicationEligible"])
            self.assertEqual(
                manifest["targets"]["termux-android-aarch64"]["archive"],
                archive.name,
            )
            sums = (output / "SHA256SUMS").read_text(encoding="utf-8")
            for name in (
                "install-te2",
                "install_te2.py",
                "release-manifest.json",
                archive.name,
            ):
                self.assertIn(f"  {name}\n", sums)

    def test_builder_rejects_ineligible_termux_archive(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            archive = _termux_archive(
                Path(raw) / "te2-0.2.338-termux-aarch64.tar.gz",
                publication_eligible=False,
            )
            manifest = public_builder._read_termux_manifest(archive)
            with self.assertRaisesRegex(SystemExit, "not publication eligible"):
                public_builder._validate_termux_manifest(
                    manifest,
                    version="0.2.338",
                    source_commit="a" * 40,
                    allow_ineligible=False,
                )

    def test_standalone_shell_runs_from_stdin_and_arbitrary_cwd(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            release = root / "release"
            release.mkdir()
            report = root / "report.json"
            fake_installer = (
                b"from pathlib import Path\n"
                b"import json, os, sys\n"
                b"Path(os.environ['TE2_TEST_REPORT']).write_text(json.dumps(sys.argv[1:]))\n"
            )
            _write_public_download_fixture(release, fake_installer)
            unrelated_cwd = root / "unrelated" / "cwd"
            unrelated_cwd.mkdir(parents=True)
            environment = os.environ.copy()
            environment.update(
                {
                    "TE2_INSTALL_PYTHON": sys.executable,
                    "TE2_RELEASE_BASE_URL": release.as_uri(),
                    "TE2_TEST_REPORT": str(report),
                }
            )
            result = subprocess.run(
                ["sh", "-s", "--", "--uninstall"],
                cwd=unrelated_cwd,
                env=environment,
                input=(ROOT / "release" / "installer" / "install-te2").read_bytes(),
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            arguments = json.loads(report.read_text(encoding="utf-8"))
            self.assertIn("--release-version", arguments)
            self.assertIn("0.2.338", arguments)
            self.assertIn("--uninstall", arguments)

    def test_standalone_shell_rejects_download_checksum_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            release = root / "release"
            release.mkdir()
            report = root / "report.json"
            _write_public_download_fixture(release, b"raise SystemExit('must not run')\n")
            (release / "install_te2.py").write_text("tampered\n", encoding="utf-8")
            environment = os.environ.copy()
            environment.update(
                {
                    "TE2_INSTALL_PYTHON": sys.executable,
                    "TE2_RELEASE_BASE_URL": release.as_uri(),
                    "TE2_TEST_REPORT": str(report),
                }
            )
            result = subprocess.run(
                ["sh", "-s"],
                cwd=root,
                env=environment,
                input=(ROOT / "release" / "installer" / "install-te2").read_bytes(),
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"checksum mismatch", result.stderr.lower())
            self.assertFalse(report.exists())


class TermuxInstallerTransactionTests(unittest.TestCase):
    def test_activation_replaces_same_version_and_preserves_other_release(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            prefix = root / "prefix"
            (prefix / "bin").mkdir(parents=True)
            install = root / "data" / "install"
            releases = install / "releases"
            releases.mkdir(parents=True)
            other = releases / "0.2.337"
            other.mkdir()
            (other / "install-receipt.json").write_text("{}\n", encoding="utf-8")
            old = releases / "0.2.338"
            old.mkdir()
            (old / "old").write_text("old", encoding="utf-8")
            staged = releases / ".0.2.338.stage-test"
            (staged / "python").mkdir(parents=True)
            (staged / "libexec").mkdir()
            server = staged / "libexec" / "te2-server"
            server.write_text("server", encoding="utf-8")
            server.chmod(0o755)

            installer._activate_release(install, prefix, staged, "0.2.338")

            self.assertEqual(os.readlink(install / "current"), "releases/0.2.338")
            self.assertFalse((releases / "0.2.338" / "old").exists())
            self.assertTrue(other.exists())
            wrapper = prefix / "bin" / "te2"
            self.assertIn(installer.MANAGED_MARKER, wrapper.read_text(encoding="utf-8"))
            for command in installer.MANAGED_COMMANDS:
                managed = prefix / "bin" / command
                self.assertTrue(managed.is_file())
                self.assertIn(installer.MANAGED_MARKER, managed.read_text(encoding="utf-8"))

    def test_uninstall_removes_only_receipted_install_subtree(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            prefix = root / "prefix"
            (prefix / "bin").mkdir(parents=True)
            data = root / "data"
            install = data / "install"
            install.mkdir(parents=True)
            state = data / "app_state" / "code_te2"
            state.mkdir(parents=True)
            (state / "keep.json").write_text("{}\n", encoding="utf-8")
            wrapper = prefix / "bin" / "te2"
            wrapper.write_text(f"#!/bin/sh\n{installer.MANAGED_MARKER}\n", encoding="utf-8")
            wrapper.chmod(0o755)
            for command in installer.MANAGED_COMMANDS:
                managed = prefix / "bin" / command
                managed.write_text(
                    f"#!/bin/sh\n{installer.MANAGED_MARKER}\n",
                    encoding="utf-8",
                )
                managed.chmod(0o755)

            installer._uninstall(install, prefix)

            self.assertFalse(install.exists())
            self.assertFalse(wrapper.exists())
            self.assertTrue(
                all(not (prefix / "bin" / command).exists() for command in installer.MANAGED_COMMANDS)
            )
            self.assertTrue((state / "keep.json").is_file())

    def test_uninstall_refuses_any_unmanaged_wrapper_before_removing_managed_files(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            prefix = root / "prefix"
            (prefix / "bin").mkdir(parents=True)
            install = root / "install"
            install.mkdir()
            te2 = prefix / "bin" / "te2"
            te2.write_text(f"#!/bin/sh\n{installer.MANAGED_MARKER}\n", encoding="utf-8")
            fws = prefix / "bin" / "fws"
            fws.write_text("#!/bin/sh\n", encoding="utf-8")

            with self.assertRaisesRegex(SystemExit, "unmanaged"):
                installer._uninstall(install, prefix)

            self.assertTrue(te2.exists())
            self.assertTrue(install.exists())

    def test_uninstall_refuses_unmanaged_wrapper(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            prefix = root / "prefix"
            (prefix / "bin").mkdir(parents=True)
            install = root / "install"
            install.mkdir()
            wrapper = prefix / "bin" / "te2"
            wrapper.write_text("#!/bin/sh\n", encoding="utf-8")
            with self.assertRaisesRegex(SystemExit, "unmanaged"):
                installer._uninstall(install, prefix)


if __name__ == "__main__":
    unittest.main()
