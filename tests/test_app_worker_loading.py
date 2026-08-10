from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path
from types import ModuleType
from urllib import request as urllib_request

from fastapi import APIRouter

from app.libs.app_worker import (
    EXPLICIT_APP_ROUTER_EXPORT,
    _backend_module_name,
    _main_router_from_module,
)

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

    def test_explicit_router_is_independent_of_public_app_id(self) -> None:
        module = ModuleType("app.apps.code_te2.main")
        router = APIRouter()
        module.__dict__[EXPLICIT_APP_ROUTER_EXPORT] = router

        name, resolved = _main_router_from_module(module, "code_te2")

        self.assertEqual(name, EXPLICIT_APP_ROUTER_EXPORT)
        self.assertIs(resolved, router)

    def test_invalid_explicit_router_fails_without_legacy_fallback(self) -> None:
        module = ModuleType("app.apps.code_te2.main")
        module.__dict__[EXPLICIT_APP_ROUTER_EXPORT] = None
        module.__dict__["code_te2_bp"] = APIRouter()

        with self.assertRaisesRegex(RuntimeError, "is not a FastAPI APIRouter"):
            _main_router_from_module(module, "code_te2")

    def test_legacy_named_router_remains_supported_for_existing_apps(self) -> None:
        module = ModuleType("app.apps.file_editor.main")
        router = APIRouter()
        module.__dict__["file_editor_bp"] = router

        name, resolved = _main_router_from_module(module, "file_editor")

        self.assertEqual(name, "file_editor_bp")
        self.assertIs(resolved, router)

    def test_worker_serves_explicit_router_when_public_id_differs_from_package(self) -> None:
        port = _free_loopback_port()
        env = os.environ.copy()
        env["PYTHONPATH"] = os.pathsep.join(
            value for value in [str(REPO_ROOT), env.get("PYTHONPATH", "")] if value
        )
        env["TE_FRAMEWORK_URL"] = "http://127.0.0.1:9"
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


if __name__ == "__main__":
    unittest.main()
