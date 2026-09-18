# pyright: strict
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from ..adapter_lifecycle_events import register_adapter_lifecycle_event_bus_handlers
from ..code_inspector_events import register_code_inspector_event_bus_handlers
from ..explorer.services.runtime_notifications import set_explorer_event_loop
from ..explorer.services.render_state import register_explorer_render_state_bus_handlers
from ..file_tabs_projection import register_file_tabs_projection_handlers
from ..logical_document_reconciler import register_logical_document_reconciler_handlers
from ..open_state_events import register_open_state_event_bus_handlers
from ..project_switch_events import register_project_switch_event_bus_handlers
from ..run_profile_events import register_run_profile_event_bus_handlers
from ..run_profile_surfaces import register_run_profile_surface_event_handlers
from ..search_highlight_events import register_search_highlight_event_bus_handlers
from ..sidebar_window_events import register_sidebar_window_event_bus_handlers
from ..workspace_events import register_workspace_event_bus_handlers
from .event_bus import set_worker_event_loop, stop_worker_event_loop
from .run_profile_fws_bridge import start_run_profile_fws_bridge, stop_run_profile_fws_bridge

logger = logging.getLogger(__name__)

_registered_loop: asyncio.AbstractEventLoop | None = None
_startup_task: asyncio.Task[None] | None = None
_started = False


def _observe_intelligence_startup(task: asyncio.Task[None]) -> None:
    if not task.cancelled():
        error = task.exception()
        if error is not None:
            logger.error("[code_te2] intelligence startup failed", exc_info=error)


async def start_worker_runtime(
    initialize_project: Callable[[], None],
    start_intelligence: Callable[[], Awaitable[None]],
) -> None:
    """Application readiness does not await the independent intelligence task."""
    global _startup_task, _started
    if _started:
        return
    # Keep initialization on the owning loop for now: moving mutable stores to
    # another thread requires a separate ownership audit, not just to_thread.
    initialize_project()
    bootstrap_worker_runtime()
    async def run_intelligence() -> None:
        await start_intelligence()

    _startup_task = asyncio.create_task(run_intelligence(), name="code_te2_intelligence_startup")
    _startup_task.add_done_callback(_observe_intelligence_startup)
    _started = True


async def stop_worker_runtime() -> None:
    """Stop producers before draining the fact bus; do not terminate child shells."""
    global _registered_loop, _startup_task, _started
    task, _startup_task = _startup_task, None
    _started = False
    if task is not None:
        _ = task.cancel()
        _ = await asyncio.gather(task, return_exceptions=True)
    try:
        await stop_run_profile_fws_bridge()
    finally:
        try:
            await stop_worker_event_loop()
        finally:
            set_explorer_event_loop(None)
            _registered_loop = None


def bootstrap_worker_runtime(loop: asyncio.AbstractEventLoop | None = None) -> None:
    """Register the app-worker loop as the central Code TE2 runtime loop."""
    global _registered_loop

    runtime_loop = loop or asyncio.get_running_loop()
    if _registered_loop is runtime_loop:
        return

    set_worker_event_loop(runtime_loop)
    # Compatibility for callers that still post work through the Explorer loop seam.
    set_explorer_event_loop(runtime_loop)
    register_adapter_lifecycle_event_bus_handlers()
    register_code_inspector_event_bus_handlers()
    register_file_tabs_projection_handlers()
    register_logical_document_reconciler_handlers()
    register_open_state_event_bus_handlers()
    register_project_switch_event_bus_handlers()
    register_run_profile_event_bus_handlers()
    register_run_profile_surface_event_handlers()
    register_search_highlight_event_bus_handlers()
    register_sidebar_window_event_bus_handlers()
    register_workspace_event_bus_handlers()
    register_explorer_render_state_bus_handlers()
    start_run_profile_fws_bridge()
    _registered_loop = runtime_loop
    logger.info("[code_te2] worker runtime loop registered")
