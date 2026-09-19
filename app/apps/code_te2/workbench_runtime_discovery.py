"""Best-effort runtime discovery, never on the WBA launch critical path."""
# pyright: strict
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
import shutil
import sys
from collections.abc import Mapping

log = logging.getLogger(__name__)


def discover_runtime(environ: Mapping[str, str]) -> str:
    """Filesystem-only checks: do not fork shells or execute version probes."""
    override = environ.get("TE2_WORKBENCH_ADAPTER_NODE_BIN", "").strip()
    if override:
        return override
    bun = shutil.which("bun", path=environ.get("PATH", os.defpath))
    if bun:
        return bun
    # Desktop installations can ship Node alongside the Python interpreter.
    bundled_node = Path(sys.executable).parent / "node"
    if bundled_node.is_file() and os.access(bundled_node, os.X_OK):
        return str(bundled_node)
    return shutil.which("node", path=environ.get("PATH", os.defpath)) or "node"


class WorkbenchRuntimeDiscovery:
    def __init__(self) -> None:
        self._task: asyncio.Task[str] | None = None

    def start(self) -> None:
        if self._task is not None:
            return
        environ = dict(os.environ)

        async def discover() -> str:
            try:
                return await asyncio.to_thread(discover_runtime, environ)
            except Exception:
                log.exception("WBA runtime discovery failed; retaining Node default")
                return "node"

        self._task = asyncio.create_task(discover(), name="code_te2_wba_runtime_discovery")

    def selected(self) -> str:
        # Launch takes a snapshot, never awaits discovery or changes a live shell.
        override = os.environ.get("TE2_WORKBENCH_ADAPTER_NODE_BIN", "").strip()
        if override:
            return override
        task = self._task
        if task is not None and task.done() and not task.cancelled():
            return task.result()
        return "node"

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            _ = task.cancel()
            _ = await asyncio.gather(task, return_exceptions=True)


workbench_runtime_discovery = WorkbenchRuntimeDiscovery()
