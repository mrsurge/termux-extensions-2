# pyright: strict
from __future__ import annotations

import asyncio
import logging

from ..adapter_lifecycle_events import register_adapter_lifecycle_event_bus_handlers
from ..code_inspector_events import register_code_inspector_event_bus_handlers
from ..explorer.services.runtime_notifications import set_explorer_event_loop
from ..explorer.services.render_state import register_explorer_render_state_bus_handlers
from ..file_tabs_projection import register_file_tabs_projection_handlers
from ..open_state_events import register_open_state_event_bus_handlers
from ..project_switch_events import register_project_switch_event_bus_handlers
from ..search_highlight_events import register_search_highlight_event_bus_handlers
from ..sidebar_window_events import register_sidebar_window_event_bus_handlers
from ..workspace_events import register_workspace_event_bus_handlers
from .event_bus import set_worker_event_loop

logger = logging.getLogger(__name__)

_registered_loop: asyncio.AbstractEventLoop | None = None


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
    register_open_state_event_bus_handlers()
    register_project_switch_event_bus_handlers()
    register_search_highlight_event_bus_handlers()
    register_sidebar_window_event_bus_handlers()
    register_workspace_event_bus_handlers()
    register_explorer_render_state_bus_handlers()
    _registered_loop = runtime_loop
    logger.info("[file_editor_cm6] worker runtime loop registered")
