"""Framework shells - REDIRECTED TO NEW PACKAGE.

This file is a compatibility shim. All functionality has moved to the
standalone `framework_shells` package. This shim re-exports symbols
so any straggler imports don't break, but the router is disabled.

DO NOT ADD NEW CODE HERE. Use `from framework_shells import ...` directly.
"""

# Re-export everything from the new package
from framework_shells import (
    FrameworkShellManager,
    ShellRecord,
    PTYState,
    PipeState,
    get_event_bus,
    EventBus,
    ShellEvent,
    EventType,
    RuntimeStore,
    get_secret,
    derive_api_token,
    derive_runtime_id,
    get_manager,
)

# NO ROUTER HERE - the new router is mounted separately in app/main.py
# framework_shells_bp is intentionally not defined

__all__ = [
    "FrameworkShellManager",
    "ShellRecord",
    "PTYState",
    "PipeState",
    "get_event_bus",
    "EventBus",
    "ShellEvent",
    "EventType",
    "RuntimeStore",
    "get_secret",
    "derive_api_token",
    "derive_runtime_id",
    "get_manager",
]
