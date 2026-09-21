"""Opt-in early process preparation; application attachment remains lifecycle-owned."""
# pyright: strict
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import json
import logging
from pathlib import Path
from typing import cast

from app.libs.runtime_startup_trace import StartupTrace
from .code_te2_paths import code_te2_paths
from .intelligence_state import IntelligenceStateStore
from . import intelligence_bootstrap_gate as gate

log = logging.getLogger(__name__)
_task: asyncio.Task[None] | None = None
_project: str | None = None
_active = False


def _startup_project() -> str:
    # A read-only boot hint, not a second HistoryStore. Lifecycle rechecks it
    # against the initialized project's authority before accepting the handoff.
    path = code_te2_paths().history_path
    if path.exists():
        decoded = cast(object, json.loads(path.read_text(encoding="utf-8")))
        if not isinstance(decoded, dict):
            raise ValueError("History state must be an object")
        project = cast(dict[str, object], decoded).get("active_project")
        if isinstance(project, str) and project:
            return project
    return str(Path.home())


def _observe(task: asyncio.Task[None]) -> None:
    if not task.cancelled() and (error := task.exception()) is not None:
        log.error("Early intelligence preparation failed: %s", error)


@asynccontextmanager
async def te2_worker_bootstrap() -> AsyncIterator[None]:
    global _active, _task, _project
    if _active:
        raise RuntimeError("Code TE2 bootstrap is already active")
    _active = True
    gate.hold_application()
    trace = StartupTrace("code_te2.bootstrap")
    try:
        if not IntelligenceStateStore().read().web_workers_enabled:
            # Preload shared preparation dependencies before importing main in
            # another thread. Neither path can see partially imported managers.
            from . import code_server_bootstrap, project_sidecar
            from .intelligence_startup import prime_intelligence_runtime
            from .workbench_runtime_discovery import workbench_runtime_discovery

            del code_server_bootstrap, project_sidecar
            _project = _startup_project()
            workbench_runtime_discovery.start()
            _task = asyncio.create_task(prime_intelligence_runtime(_project), name="code_te2_early_intelligence")
            _task.add_done_callback(_observe)
            trace.mark("preparation.scheduled")
        else:
            trace.mark("preparation.skipped_web_workers")
        yield
    finally:
        try:
            await stop_early_intelligence()
        finally:
            gate.reset_application()
            _active = False
            trace.mark("bootstrap.closed")


async def attach_application(project_root: str) -> None:
    if not _active:
        return
    # Called only after project initialization and fact-handler registration.
    # Reject a stale boot hint BEFORE releasing pushes/connect for that project.
    if _task is not None and not _matches_project(project_root):
        await stop_early_intelligence()
        from .workbench_runtime_discovery import workbench_runtime_discovery
        workbench_runtime_discovery.start()
    gate.release_application()
    if _task is not None:
        from .workbench_adapter_shell_manager import publish_current_adapter_state
        await publish_current_adapter_state()
    StartupTrace("code_te2.bootstrap").mark("application.attached")


def _matches_project(project_root: str) -> bool:
    return _project is not None and Path(_project).resolve() == Path(project_root).resolve()


async def await_early_intelligence(project_root: str) -> bool:
    task = _task
    if task is None:
        return False
    if not _matches_project(project_root):
        await stop_early_intelligence()
        return False
    # Startup and the eager caller share the same result, including failure.
    # Do not silently restart the chain if early preparation failed.
    await asyncio.shield(task)
    return True


async def stop_early_intelligence() -> None:
    global _task, _project
    task, _task = _task, None
    _project = None
    if task is not None:
        if not task.done():
            _ = task.cancel()
        _ = await asyncio.gather(task, return_exceptions=True)
        from .workbench_adapter_shell_manager import stop_adapter_io
        from .workbench_runtime_discovery import workbench_runtime_discovery
        try:
            await stop_adapter_io()
        finally:
            await workbench_runtime_discovery.stop()
