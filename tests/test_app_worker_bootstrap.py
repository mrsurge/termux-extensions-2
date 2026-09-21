# pyright: strict
from __future__ import annotations

import asyncio
from http.client import HTTPResponse
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from typing import cast
from urllib.request import urlopen

from app.libs.app_worker_bootstrap import assemble_off_loop, bootstrap_context

ROOT = Path(__file__).resolve().parents[1]


class AssemblyTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_joins_import_thread_before_returning(self) -> None:
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()

        def assemble() -> int:
            entered.set()
            assert release.wait(3)
            finished.set()
            return 42

        task = asyncio.create_task(assemble_off_loop(assemble))
        self.assertTrue(await asyncio.to_thread(entered.wait, 2))
        _ = task.cancel()
        await asyncio.sleep(0)
        self.assertFalse(task.done())
        release.set()
        with self.assertRaises(asyncio.CancelledError):
            _ = await asyncio.wait_for(task, 3)
        self.assertTrue(finished.is_set())

    async def test_import_failure_propagates(self) -> None:
        def fail() -> None:
            raise ValueError("broken import")
        with self.assertRaisesRegex(ValueError, "broken import"):
            await assemble_off_loop(fail)

    def test_missing_bootstrap_contract_fails_explicitly(self) -> None:
        with self.assertRaisesRegex(TypeError, "must export"):
            _ = bootstrap_context("app.libs.app_worker_bootstrap")


class WorkerBootstrapTests(unittest.TestCase):
    def test_real_uvicorn_loop_import_overlap_and_signal_cleanup(self) -> None:
        self._exercise(False)

    def test_import_failure_unwinds_bootstrap_without_serving(self) -> None:
        self._exercise(True)

    def _exercise(self, fail: bool) -> None:
        with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as directory:
            root = Path(directory)
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = cast(tuple[str, int], sock.getsockname())[1]
            env = dict(os.environ)
            env["PYTHONPATH"] = str(ROOT)
            env["TE_FRAMEWORK_URL"] = "http://127.0.0.1:9"
            env["TE2_TEST_BOOT_EVENTS"] = str(root / "events")
            if fail:
                env["TE2_TEST_IMPORT_FAILURE"] = "1"
            for kind in ("CONFIG", "DATA", "CACHE", "RUNTIME"):
                env[f"TE2_{kind}_HOME"] = str(root / kind.lower())
            with (root / "log").open("w+") as log:
                proc = subprocess.Popen([
                    sys.executable, "-m", "app.libs.app_worker", "--app-id", "bootstrap_test",
                    "--port", str(port), "--backend-module", str(ROOT / "tests/fixtures/async_worker_backend.py"),
                    "--bootstrap-module", "tests.fixtures.async_worker_bootstrap",
                ], cwd=ROOT, env=env, stdout=log, stderr=log)
                try:
                    if fail:
                        self.assertNotEqual(proc.wait(timeout=10), 0)
                    else:
                        deadline = time.monotonic() + 10
                        while time.monotonic() < deadline:
                            try:
                                with cast(HTTPResponse, urlopen(f"http://127.0.0.1:{port}/status", timeout=0.3)) as response:
                                    self.assertEqual(response.read(), b'{"ok":true}')
                                break
                            except OSError:
                                if proc.poll() is not None:
                                    break
                                time.sleep(0.03)
                        else:
                            self.fail("fixture worker did not become ready")
                        self.assertIsNone(proc.poll())
                finally:
                    if proc.poll() is None:
                        proc.terminate()
                    try:
                        _ = proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        _ = proc.wait(timeout=5)
                _ = log.seek(0)
                self.assertEqual((root / "events").read_text().splitlines(), [
                    "bootstrap", "progress-during-import", "import-complete",
                    *([] if fail else ["start", "stop"]), "bootstrap-stop",
                ], log.read())
