from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app import release_runtime


class ReleaseRuntimeTests(unittest.TestCase):
    def test_source_build_provenance_has_no_packaged_server(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp)
            _write_manifest(
                root,
                {
                    "distributionMode": "source-build",
                    "schemaVersion": 1,
                },
            )

            with mock.patch.object(release_runtime, "__file__", str(root / "__init__.py")):
                self.assertIsNone(release_runtime.packaged_server_path())

    def test_valid_binary_release_returns_verified_executable(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp)
            server = _write_server(root)
            _write_manifest(root, _binary_manifest(server))

            with _release_runtime_environment(root):
                selected = release_runtime.packaged_server_path()

            self.assertEqual(selected, server)

    def test_binary_release_rejects_symlinked_server(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp)
            real_server = _write_server(root, name="real-server")
            server = root / "bin" / "te2-server"
            server.symlink_to(real_server.name)
            _write_manifest(root, _binary_manifest(real_server, relative="bin/te2-server"))

            with _release_runtime_environment(root):
                with self.assertRaisesRegex(
                    release_runtime.ReleaseRuntimeError,
                    "may not be a symlink",
                ):
                    release_runtime.packaged_server_path()

    def test_binary_release_rejects_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp) / "package"
            root.mkdir()
            outside = _write_server(Path(raw_tmp), name="outside-server")
            _write_manifest(root, _binary_manifest(outside, relative="../outside-server"))

            with _release_runtime_environment(root):
                with self.assertRaisesRegex(
                    release_runtime.ReleaseRuntimeError,
                    "escapes the installed release payload",
                ):
                    release_runtime.packaged_server_path()

    def test_binary_release_digest_failure_is_actionable(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp)
            server = _write_server(root)
            manifest = _binary_manifest(server)
            manifest["serverSha256"] = "0" * 64
            _write_manifest(root, manifest)

            with _release_runtime_environment(root):
                with self.assertRaises(release_runtime.ReleaseRuntimeError) as raised:
                    release_runtime.packaged_server_path()

            message = str(raised.exception)
            self.assertIn("digest mismatch", message)
            self.assertIn("te2==0.2.338", message)
            self.assertIn("--force-reinstall", message)

    def test_binary_release_rejects_inconsistent_platform_tag(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp)
            server = _write_server(root)
            manifest = _binary_manifest(server)
            manifest["platformTag"] = "manylinux_2_39_x86_64"
            _write_manifest(root, manifest)

            with _release_runtime_environment(root):
                with self.assertRaisesRegex(
                    release_runtime.ReleaseRuntimeError,
                    "does not match 'manylinux_2_28_x86_64'",
                ):
                    release_runtime.packaged_server_path()


def _write_server(root: Path, *, name: str = "te2-server") -> Path:
    server = root / "bin" / name
    server.parent.mkdir(parents=True, exist_ok=True)
    server.write_bytes(b"test server payload\n")
    server.chmod(0o755)
    return server.resolve()


def _binary_manifest(server: Path, *, relative: str | None = None) -> dict[str, object]:
    return {
        "architecture": "x86_64",
        "commit": "a" * 40,
        "distributionMode": "binary-release",
        "libc": "glibc",
        "minimumGlibc": "2.28",
        "packageVersion": "0.2.338",
        "platform": "linux",
        "platformTag": "manylinux_2_28_x86_64",
        "releaseTag": "v0.2.338",
        "schemaVersion": 1,
        "serverRelativePath": relative or "bin/te2-server",
        "serverSha256": hashlib.sha256(server.read_bytes()).hexdigest(),
    }


def _write_manifest(root: Path, value: dict[str, object]) -> None:
    (root / "provenance.json").write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


@contextmanager
def _release_runtime_environment(root: Path) -> Iterator[None]:
    with ExitStack() as stack:
        stack.enter_context(
            mock.patch.object(release_runtime, "__file__", str(root / "__init__.py"))
        )
        stack.enter_context(
            mock.patch.object(
                release_runtime,
                "_installed_package_version",
                return_value="0.2.338",
            )
        )
        stack.enter_context(
            mock.patch.object(release_runtime, "_glibc_version", return_value=(2, 41))
        )
        stack.enter_context(
            mock.patch.object(
                release_runtime.os,
                "uname",
                return_value=SimpleNamespace(machine="x86_64"),
            )
        )
        yield


if __name__ == "__main__":
    unittest.main()
