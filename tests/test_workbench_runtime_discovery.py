# pyright: strict
from __future__ import annotations

import asyncio
import os
from pathlib import Path
import shutil
import sys
import threading
import unittest
from unittest.mock import patch

from app.apps.code_te2 import workbench_runtime_discovery as runtime


class RuntimeDiscoveryTests(unittest.IsolatedAsyncioTestCase):
    def test_bun_preferred_without_probing_processes(self) -> None:
        with patch.object(shutil, "which", return_value="/tools/bun") as which:
            self.assertEqual(runtime.discover_runtime({"PATH": "/tools"}), "/tools/bun")
            which.assert_called_once_with("bun", path="/tools")

    def test_node_without_bun_or_npm(self) -> None:
        with patch.object(shutil, "which", side_effect=[None, "/tools/node"]), patch.object(Path, "is_file", return_value=False):
            self.assertEqual(runtime.discover_runtime({"PATH": "/tools"}), "/tools/node")

    def test_packaged_node_is_preserved(self) -> None:
        with patch.object(shutil, "which", return_value=None), patch.object(Path, "is_file", return_value=True), patch.object(os, "access", return_value=True):
            self.assertEqual(runtime.discover_runtime({}), str(Path(sys.executable).parent / "node"))

    def test_explicit_override_is_preserved(self) -> None:
        with patch.object(shutil, "which") as which:
            self.assertEqual(runtime.discover_runtime({"TE2_WORKBENCH_ADAPTER_NODE_BIN": "/custom/node"}), "/custom/node")
            which.assert_not_called()

    async def test_pending_discovery_does_not_block_launch(self) -> None:
        release = threading.Event()
        entered = threading.Event()

        def slow_discovery(_env: object) -> str:
            entered.set()
            _ = release.wait(timeout=5)
            return "/tools/bun"

        discovery = runtime.WorkbenchRuntimeDiscovery()
        with patch.dict(os.environ, {"TE2_WORKBENCH_ADAPTER_NODE_BIN": ""}), patch.object(runtime, "discover_runtime", slow_discovery):
            try:
                discovery.start()
                self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                self.assertEqual(discovery.selected(), "node")
                release.set()
                async with asyncio.timeout(2):
                    while discovery.selected() == "node":
                        await asyncio.sleep(0.001)
                self.assertEqual(discovery.selected(), "/tools/bun")
            finally:
                release.set()
                await discovery.stop()
            self.assertEqual(discovery.selected(), "node")

    async def test_discovery_error_retains_node(self) -> None:
        discovery = runtime.WorkbenchRuntimeDiscovery()
        with patch.dict(os.environ, {"TE2_WORKBENCH_ADAPTER_NODE_BIN": ""}), patch.object(runtime, "discover_runtime", side_effect=OSError("unavailable")), self.assertLogs(runtime.log, level="ERROR"):
            discovery.start()
            await asyncio.sleep(0.05)
            self.assertEqual(discovery.selected(), "node")
            await discovery.stop()
