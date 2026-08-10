from __future__ import annotations

import json
import os
import selectors
import socket
import subprocess
import sys
import time
import unittest
import urllib.request
from pathlib import Path
from typing import TextIO


REPO_ROOT = Path(__file__).resolve().parents[2]
FILE_EXPLORER_BACKEND = REPO_ROOT / "app/apps/file_explorer/file_explorer.py"


def _free_loopback_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_http_loop_probe(port: int, *, timeout_seconds: float = 8.0) -> dict:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/__te2/runtime/loop",
                timeout=0.3,
            ) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - test keeps retrying until deadline.
            last_error = exc
            time.sleep(0.1)
    raise AssertionError("HTTP app worker did not become reachable") from last_error


def _readline_with_timeout(stream: TextIO, *, timeout_seconds: float = 5.0) -> str:
    selector = selectors.DefaultSelector()
    selector.register(stream, selectors.EVENT_READ)
    try:
        ready = selector.select(timeout_seconds)
        if not ready:
            raise AssertionError("pipe worker returned no response line")
        return stream.readline().strip()
    finally:
        selector.close()


class PipeBackedAppWorkerTests(unittest.TestCase):
    def test_file_explorer_pipe_worker_also_serves_http(self) -> None:
        port = _free_loopback_port()
        cmd = [
            sys.executable,
            "-m",
            "app.libs.app_worker",
            "--app-id",
            "file_explorer",
            "--port",
            str(port),
            "--backend-module",
            str(FILE_EXPLORER_BACKEND.resolve()),
            "--pipe",
        ]
        env = os.environ.copy()
        env["PYTHONPATH"] = os.pathsep.join(
            value for value in [str(REPO_ROOT), env.get("PYTHONPATH", "")] if value
        )
        env["TE_FRAMEWORK_URL"] = "http://127.0.0.1:9"
        env["TE_PIPE_NAME"] = "service.fs"
        env["TE_PIPE_NID"] = "2100"

        proc = subprocess.Popen(
            cmd,
            cwd=REPO_ROOT,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            self.assertIsNone(proc.poll(), "app_worker exited before HTTP probe")
            payload = _wait_for_http_loop_probe(port)
            self.assertTrue(payload.get("ok"))
            self.assertEqual(payload.get("data", {}).get("app_id"), "file_explorer")

            frame = {
                "jsonrpc": "2.0",
                "protocolVersion": 1,
                "kind": "request",
                "id": "probe-1",
                "method": "fs.listDirectory",
                "originNid": 1,
                "originName": "framework.rust.test",
                "targetNid": 2100,
                "targetName": "service.fs",
                "workspaceRoot": "/",
                "params": {
                    "root": "/",
                    "path": str(REPO_ROOT / "app/apps/file_explorer"),
                    "hidden": False,
                },
            }
            self.assertIsNotNone(proc.stdin)
            self.assertIsNotNone(proc.stdout)
            assert proc.stdin is not None
            assert proc.stdout is not None

            proc.stdin.write(json.dumps(frame, separators=(",", ":")) + "\n")
            proc.stdin.flush()
            line = _readline_with_timeout(proc.stdout)
            self.assertTrue(line)

            response = json.loads(line)
            self.assertEqual(response.get("kind"), "response", response)
            self.assertEqual(response.get("id"), "probe-1", response)
            result = response.get("result") or {}
            self.assertIsInstance(result.get("entries"), list, response)
            self.assertGreater(len(result["entries"]), 0, response)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)


if __name__ == "__main__":
    unittest.main()
