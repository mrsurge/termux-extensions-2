"""Overlap process initialization without moving runtime ownership out of Python."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from app.libs.runtime_startup_trace import StartupTrace

from .code_server_shell_manager import (
    ShellRecord,
    code_server_connection_target,
    ensure_code_server_shell,
)
from .workbench_adapter_shell_manager import ensure_workbench_adapter_shell


@dataclass
class _Preparation:
    task: asyncio.Task[object] | None = None


async def prime_intelligence_runtime(project_root: str) -> None:
    trace = StartupTrace("code_te2.intelligence")
    trace.mark("parallel_start.begin")
    # The future carries failure/cancellation as well as readiness. It never
    # launches a second code-server or mistakes a UDS path for readiness.
    dependency: asyncio.Future[None] = asyncio.get_running_loop().create_future()
    preparation = _Preparation()

    async def wait_for_code_server() -> None:
        await asyncio.shield(dependency)

    def prepare_adapter(record: ShellRecord) -> None:
        trace.mark("code_server.spawned_or_adopted")
        http, socket_path = code_server_connection_target(record)
        preparation.task = asyncio.create_task(
            ensure_workbench_adapter_shell(
                project_root, http, socket_path,
                wait_for_dependency=wait_for_code_server,
            ),
            name="code_te2_prepare_wba",
        )

    try:
        _ = await ensure_code_server_shell(project_root, on_spawned=prepare_adapter)
        trace.mark("code_server.startup_complete")
        dependency.set_result(None)
        if preparation.task is not None:
            _ = await preparation.task
        trace.mark("parallel_start.end")
    finally:
        # Stop only this orchestration task, never the shared shell processes.
        # Cancellation must not leave a hidden connect running after teardown.
        if not dependency.done():
            _ = dependency.cancel()
        if preparation.task is not None:
            if not preparation.task.done():
                _ = preparation.task.cancel()
            _ = await asyncio.gather(preparation.task, return_exceptions=True)
