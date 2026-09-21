# pyright: strict, reportPrivateUsage=false
from __future__ import annotations

import asyncio
from collections.abc import Callable
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from typing import cast, override
from framework_shells.record import ShellRecord

from app.apps.code_te2 import code_server_shell_manager as code_server
from app.apps.code_te2 import code_server_install_state
from app.apps.code_te2 import workbench_adapter_shell_manager as adapter
from app.apps.code_te2.node_compile_cache import node_compile_cache


class CompileCacheTests(unittest.TestCase):
    def test_private_absolute_service_directories(self) -> None:
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"TE2_CACHE_HOME": root}):
            code = Path(node_compile_cache("code-server"))
            workbench = Path(node_compile_cache("workbench-adapter"))
            self.assertTrue(code.is_absolute())
            self.assertNotEqual(code, workbench)
            self.assertEqual(code, Path(root).resolve() / "node_compile" / "code-server")
            self.assertEqual(stat.S_IMODE(code.stat().st_mode), 0o700)
            self.assertEqual(str(code), node_compile_cache("code-server"))

    def test_unusable_cache_is_optional(self) -> None:
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"TE2_CACHE_HOME": root}):
            parent = Path(root) / "node_compile"
            parent.mkdir()
            _ = (parent / "code-server").write_text("not a directory")
            with self.assertLogs("app.apps.code_te2.node_compile_cache", level="WARNING"):
                self.assertEqual(node_compile_cache("code-server"), "")

    def test_shellspecs_pass_cache_as_environment_not_cli_flag(self) -> None:
        for name in ("code_server", "workbench_adapter"):
            spec = (Path(code_server.__file__).parent / "shellspec" / f"{name}.yaml").read_text()
            self.assertIn("NODE_COMPILE_CACHE: ${ctx:NODE_COMPILE_CACHE}", spec)
            self.assertNotIn("--NODE_COMPILE_CACHE", spec)


class LaunchSerializationTests(unittest.IsolatedAsyncioTestCase):
    @override
    async def asyncSetUp(self) -> None:
        # Launch fixtures must not inspect or persist the user's installed runtime.
        selected = patch.object(code_server_install_state, "selected_installation", return_value=None)
        _ = selected.start()
        self.addCleanup(selected.stop)

    async def test_code_server_launches_do_not_overlap(self) -> None:
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = 0

        async def launch(_root: str, *, on_spawned: Callable[[ShellRecord], None]) -> code_server.ShellRecord:
            del on_spawned
            nonlocal calls
            calls += 1
            entered.set()
            _ = await release.wait()
            return cast(code_server.ShellRecord, object())

        with patch.object(code_server, "_spawn_lock", asyncio.Lock()), patch.object(code_server, "_ensure_code_server_shell", launch):
            first = asyncio.create_task(code_server.ensure_code_server_shell("/project"))
            # Bound synchronization so a mock signature regression fails, not hangs.
            _ = await asyncio.wait_for(entered.wait(), 2)
            second = asyncio.create_task(code_server.ensure_code_server_shell("/project"))
            await asyncio.sleep(0)
            self.assertEqual(calls, 1)
            release.set()
            _ = await asyncio.wait_for(asyncio.gather(first, second), 2)
            self.assertEqual(calls, 2)

    async def test_adapter_launch_cancellation_releases_ownership(self) -> None:
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = 0

        async def launch(_root: str, _http: str, _socket: str | None) -> ShellRecord:
            nonlocal calls
            calls += 1
            entered.set()
            _ = await release.wait()
            return cast(ShellRecord, object())

        with patch.object(adapter, "_spawn_lock", asyncio.Lock()), patch.object(adapter, "_ensure_workbench_adapter_shell", launch):
            first = asyncio.create_task(adapter.ensure_workbench_adapter_shell("/project", "http://localhost"))
            _ = await asyncio.wait_for(entered.wait(), 2)
            second = asyncio.create_task(adapter.ensure_workbench_adapter_shell("/project", "http://localhost"))
            await asyncio.sleep(0)
            self.assertEqual(calls, 1)
            _ = first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                _ = await first
            release.set()
            _ = await asyncio.wait_for(second, 2)
            self.assertEqual(calls, 2)
