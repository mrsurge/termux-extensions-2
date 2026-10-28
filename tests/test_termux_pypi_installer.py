"""PyPI staging tests: no network, apt installs, native builds or live activation."""
from __future__ import annotations

import importlib.util
import hashlib
import io
import json
import os
import shlex
from pathlib import Path
import subprocess
import sys
import tarfile
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
    def test_refresh_uses_installed_package_names_and_explicit_profile_policy(self) -> None:
        prefix = Path("/data/data/com.termux/files/usr")
        inventory = (
            "termux-tools\tinstalled\ntermux-exec\tinstalled\n"
            "termux-api\tinstalled\ntermux-unused\tconfig-files\n"
            "nodejs-lts\tinstalled\ntermux-invalid/name\tinstalled\n"
        )
        argv = ["install_te2.py", "--payload-root", "/path with 'quote'/payload", "--yes"]
        with patch.object(installer, "_command_output", return_value=inventory) as query, \
             patch.object(installer, "_confirm_install") as confirm, \
             patch.object(installer.subprocess, "run") as run, \
             patch.object(installer.os, "execve", side_effect=SystemExit(73)) as execute, \
             patch.object(installer.sys, "argv", argv):
            with self.assertRaises(SystemExit) as raised:
                installer._refresh_termux_runtime(prefix, assume_yes=True)
        self.assertEqual(raised.exception.code, 73)
        self.assertIn("${Package}", query.call_args.args[0][-1])
        self.assertIn("${db:Status-Status}", query.call_args.args[0][-1])
        confirm.assert_called_once()
        self.assertIn("configuration", confirm.call_args.args[0])
        self.assertIn(".dpkg-old", confirm.call_args.args[0])
        apt = str(prefix / "bin/apt-get")
        self.assertEqual(run.call_args_list[0].args[0], [apt, "update"])
        command = run.call_args_list[1].args[0]
        self.assertIn("Dpkg::Options::=--force-confnew", command)
        self.assertIn("Dpkg::Options::=--force-confask", command)
        self.assertIn("--reinstall", command)
        self.assertEqual(command[command.index("-y") + 1:],
                         ["termux-api", "termux-core", "termux-exec", "termux-tools"])
        for call in run.call_args_list:
            self.assertTrue(call.kwargs["check"])
        login, args, _env = execute.call_args.args
        self.assertEqual(login, str(prefix / "bin/login"))
        self.assertEqual(args[:2], [login, "-c"])
        handoff = shlex.split(args[2])
        self.assertEqual(handoff[:2], ["exec", str(prefix / "bin/python")])
        self.assertEqual(handoff[3:-1], argv[1:])
        self.assertEqual(handoff[-1], "--termux-runtime-prepared")

    def test_refresh_stops_on_decline_or_apt_failure_before_login(self) -> None:
        prefix = Path("/data/data/com.termux/files/usr")
        with patch.object(installer, "_command_output", return_value=""), \
             patch.object(installer, "_confirm_install", side_effect=SystemExit("cancelled")), \
             patch.object(installer.subprocess, "run") as run, \
             patch.object(installer.os, "execve") as execute:
            with self.assertRaisesRegex(SystemExit, "cancelled"):
                installer._refresh_termux_runtime(prefix, assume_yes=False)
            run.assert_not_called()
            execute.assert_not_called()
        for failed_call in (1, 2):
            with self.subTest(failed_call=failed_call), \
                 patch.object(installer, "_command_output", return_value=""), \
                 patch.object(installer, "_confirm_install"), \
                 patch.object(installer.subprocess, "run", side_effect=(
                     [subprocess.CalledProcessError(1, "apt")] if failed_call == 1 else
                     [SimpleNamespace(returncode=0), subprocess.CalledProcessError(1, "apt")]
                 )), patch.object(installer.os, "execve") as execute:
                with self.assertRaises(subprocess.CalledProcessError):
                    installer._refresh_termux_runtime(prefix, assume_yes=True)
                execute.assert_not_called()

    def test_uninstall_and_rollback_do_not_refresh_termux_packages(self) -> None:
        for action in ("uninstall", "rollback"):
            args = SimpleNamespace(desktop=False, prefix=None, uninstall=action == "uninstall",
                                   rollback="0.2.354" if action == "rollback" else None,
                                   termux_runtime_prepared=False, yes=True)
            with tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                with patch.object(installer, "_resolve_prefix", return_value=root), \
                     patch.object(installer, "_refresh_termux_runtime") as refresh, \
                     patch.object(installer, "_uninstall"), patch.object(installer, "_rollback"):
                    self.assertEqual(installer._run_termux(args, root, root), 0)
                refresh.assert_not_called()

    def test_runtime_refresh_precedes_lock_and_runtime_validation(self) -> None:
        args = SimpleNamespace(desktop=False, prefix=None, uninstall=False, rollback=None,
                               termux_runtime_prepared=False, yes=True)
        root = Path("/unused")
        with patch.object(installer, "_resolve_prefix", return_value=root), \
             patch.object(installer, "_refresh_termux_runtime", side_effect=SystemExit(73)) as refresh, \
             patch.object(installer, "_install_lock") as lock, \
             patch.object(installer, "_ensure_prerequisites") as prerequisites:
            with self.assertRaises(SystemExit):
                installer._run_termux(args, root, root)
            refresh.assert_called_once_with(root, assume_yes=True)
            lock.assert_not_called()
            prerequisites.assert_not_called()

    def test_stages_prebuilt_runtime_allowing_small_dependencies_before_activation(self) -> None:
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
            binary_options = [arg for arg in pip if arg.startswith("--only-binary=")]
            self.assertEqual(binary_options, ["--only-binary=te2,agent-log-server,framework-shells,uvloop-te2"])
            self.assertNotIn("--only-binary=:all:", pip)
            self.assertNotIn("--no-binary=:all:", pip)
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
                with self.assertRaisesRegex(SystemExit, "require compatible prebuilt wheels"):
                    installer._materialize_termux_pypi_release(root, root / "prefix", "0.2.354")
            self.assertEqual(os.readlink(current), "releases/previous")
            self.assertEqual(list((root / "releases").iterdir()), [])

    def test_pypi_route_never_reads_legacy_payload(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            args = SimpleNamespace(desktop=False, prefix=None, uninstall=False, rollback=None,
                                   release_version="0.2.354", yes=True, termux_runtime_prepared=True)
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
        self.assertTrue({"python", "python-pip", "codex", "nodejs-lts", "libarchive", "libgit2"} <= names)
        codex = next(item for item in installer.TERMUX_APT_PACKAGES if item["name"] == "codex")
        self.assertEqual(codex["executables"], ["codex"])

    def test_linux_import_smoke_does_not_require_retired_dependencies(self) -> None:
        with patch.object(installer.subprocess, "run") as run:
            installer._validate_linux_release_imports(Path("/unused/release"), "0.2.354", {})
        command = run.call_args.args[0]
        script = command[command.index("-c") + 1]
        self.assertIn("framework_shells", script)
        self.assertIn("libarchive", script)
        self.assertNotIn("fastapi", script)


class BootstrapReleaseRoutingTests(unittest.TestCase):
    """Run the real shell bootstrap against local, checksummed release fixtures."""

    def run_bootstrap(self, version, *, tag="latest", maintenance=False, unsafe=False, corrupt=False, termux=True):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payload = root / "release"
            payload.mkdir()
            manifest = {"schemaVersion": 1,
                        "release": {"version": version, "publicationEligible": True},
                        "targets": {"linux-glibc-x86_64": {"installer": "install_te2.py"},
                                    "termux-android-aarch64": {"archive": "termux.tar.gz"}}}
            (payload / "release-manifest.json").write_text(json.dumps(manifest))
            # Only record dispatch: never run pip/apt, build, or activate anything.
            (payload / "install_te2.py").write_text(
                "import json,os,sys\nfrom pathlib import Path\n"
                "p=Path(sys.argv[sys.argv.index('--payload-root')+1])\n"
                "Path(os.environ['ROUTING_RESULT']).write_text(json.dumps({"
                "'args':sys.argv[1:],'legacy':(p/'target-manifest.json').is_file()}))\n")
            if version == "0.2.353" and not maintenance:
                with tarfile.open(payload / "termux.tar.gz", "w:gz") as archive:
                    member = tarfile.TarInfo("../escape" if unsafe else "legacy/target-manifest.json")
                    member.size = 2
                    archive.addfile(member, io.BytesIO(b"{}"))
            sums = []
            for path in payload.iterdir():
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                if corrupt and path.name == "termux.tar.gz":
                    digest = "0" * 64
                sums.append(f"{digest}  {path.name}\n")
            (payload / "SHA256SUMS").write_text("".join(sums))
            result_file = root / "result.json"
            env = dict(os.environ, TE2_RELEASE_TAG=tag, TE2_RELEASE_BASE_URL=payload.as_uri(),
                       TE2_INSTALL_PYTHON=sys.executable, PREFIX="/data/data/com.termux/files/usr",
                       ROUTING_RESULT=str(result_file), TMPDIR=str(root))
            if not termux:
                env.pop("PREFIX", None)
                env.pop("ANDROID_ROOT", None)
            command = ["sh", str(ROOT / "release/installer/install-te2"), "--yes"]
            if maintenance:
                command.append("--uninstall")
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
            return result, json.loads(result_file.read_text()) if result_file.exists() else None

    def test_latest_current_release_uses_pypi_without_archive(self):
        result, body = self.run_bootstrap("0.2.354")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(body["legacy"])
        self.assertIn("--release-version", body["args"])

    def test_explicit_current_tag_uses_pypi_without_archive(self):
        result, body = self.run_bootstrap("0.2.354", tag="0.2.354")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--release-version", body["args"])

    def test_linux_previous_release_keeps_matching_installer_route(self):
        result, body = self.run_bootstrap("0.2.353", termux=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(body["legacy"])
        self.assertIn("--release-version", body["args"])

    def test_previous_tag_uses_verified_archive(self):
        result, body = self.run_bootstrap("0.2.353", tag="0.2.353")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(body["legacy"])
        self.assertNotIn("--release-version", body["args"])

    def test_latest_pointing_at_previous_release_uses_archive(self):
        result, body = self.run_bootstrap("0.2.353")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(body["legacy"])

    def test_legacy_maintenance_does_not_download_archive(self):
        result, body = self.run_bootstrap("0.2.353", maintenance=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--uninstall", body["args"])
        self.assertFalse(body["legacy"])

    def test_unsafe_archive_rejected_before_installer(self):
        result, body = self.run_bootstrap("0.2.353", unsafe=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unsafe Termux archive member", result.stderr)
        self.assertIsNone(body)

    def test_corrupt_archive_rejected_before_installer(self):
        result, body = self.run_bootstrap("0.2.353", corrupt=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum mismatch", result.stderr)
        self.assertIsNone(body)
