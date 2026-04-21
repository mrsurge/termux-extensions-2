"""Deprecated compatibility shim for Explorer backend imports.

Do not add feature logic here. This file exists only to preserve older import
paths while the Explorer backend is decomposed. Use:
- `explorer_runtime.py` for runtime/session composition
- `explorer/services/*` for state-management and notification services
- `explorer/handlers/*` for feature handlers
- `explorer/contracts/*` for typed payload/result definitions
"""

from .explorer_runtime import ExplorerDispatcher, ExplorerSocketIONamespace, abs_to_rel, explorer_websocket
from .explorer.services.project_session import reset_project_session
from .explorer.services.runtime_notifications import (
    notify_draft_state_changed,
    notify_explorer_of_change,
    set_explorer_event_loop,
)

__all__ = [
    "ExplorerDispatcher",
    "ExplorerSocketIONamespace",
    "abs_to_rel",
    "explorer_websocket",
    "notify_draft_state_changed",
    "notify_explorer_of_change",
    "reset_project_session",
    "set_explorer_event_loop",
]
