from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import ModuleType
from urllib import request as urllib_request

from app.libs.app_worker import (
    _backend_module_name,
)
from app.libs.app_worker_asgi import explicit_asgi_application

REPO_ROOT = Path(__file__).resolve().parents[1]
RENAMED_BACKEND_FIXTURE = (
    REPO_ROOT / "tests/fixtures/app_worker_package/code_te2/main.py"
)


def _free_loopback_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_json(url: str, *, timeout_seconds: float = 8.0) -> dict[str, object]:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib_request.urlopen(url, timeout=0.3) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - retry until the bounded deadline.
            last_error = exc
            time.sleep(0.1)
    raise AssertionError(f"app worker did not serve {url}") from last_error


class AppWorkerLoadingTests(unittest.TestCase):
    def test_builtin_module_name_comes_from_backend_package_path(self) -> None:
        package_root = Path("/opt/te2-package")
        backend = package_root / "app/apps/code_te2/main.py"

        self.assertEqual(
            _backend_module_name("code_te2", str(backend), package_root),
            "app.apps.code_te2.main",
        )

    def test_external_backend_retains_existing_public_id_module_contract(self) -> None:
        self.assertEqual(
            _backend_module_name(
                "third_party_app",
                "/home/user/.local/share/te2/apps/custom/main.py",
                Path("/opt/te2-package"),
            ),
            "app.apps.third_party_app.main",
        )

    def test_explicit_asgi_is_independent_of_public_app_id(self) -> None:
        module = ModuleType("app.apps.code_te2.main")
        async def app(scope, receive, send):
            pass
        module.__dict__["TE2_ASGI_APP"] = app
        self.assertIs(explicit_asgi_application(module, "code_te2"), app)

    def test_invalid_explicit_asgi_fails_without_router_fallback(self) -> None:
        module = ModuleType("app.apps.code_te2.main")
        module.__dict__["TE2_ASGI_APP"] = None
        module.__dict__["code_te2_bp"] = object()
        with self.assertRaisesRegex(RuntimeError, "not callable"):
            explicit_asgi_application(module, "code_te2")

    def test_legacy_router_does_not_satisfy_asgi_export(self) -> None:
        module = ModuleType("app.apps.file_editor.main")
        module.__dict__["TE2_APP_ROUTER"] = object()
        self.assertIsNone(explicit_asgi_application(module, "file_editor"))

    def test_worker_serves_explicit_asgi_when_public_id_differs_from_package(self) -> None:
        port = _free_loopback_port()
        env = os.environ.copy()
        env["PYTHONPATH"] = os.pathsep.join(
            value for value in [str(REPO_ROOT), env.get("PYTHONPATH", "")] if value
        )
        env["TE_FRAMEWORK_URL"] = "http://127.0.0.1:9"
        scratch = tempfile.TemporaryDirectory(prefix="te2-lifecycle-")
        self.addCleanup(scratch.cleanup)
        stopped_file = Path(scratch.name) / "stopped"
        env["TE2_TEST_LIFECYCLE_STOP_FILE"] = str(stopped_file)
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "app.libs.app_worker",
                "--app-id",
                "code_te2",
                "--port",
                str(port),
                "--backend-module",
                str(RENAMED_BACKEND_FIXTURE),
            ],
            cwd=REPO_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            payload = _wait_for_json(f"http://127.0.0.1:{port}/identity")
            self.assertEqual(
                payload,
                {
                    "app_id": "code_te2",
                    "module": "tests.fixtures.app_worker_package.code_te2.main",
                },
            )
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)
            _ = proc.communicate(timeout=3)
        self.assertEqual(stopped_file.read_text(encoding="utf-8"), "stopped")


if __name__ == "__main__":
    unittest.main()
