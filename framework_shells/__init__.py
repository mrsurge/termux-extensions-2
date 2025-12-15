"""Framework Shells - Standalone process orchestration library."""

from .manager import FrameworkShellManager
from .record import ShellRecord
from .pty import PTYState, PipeState
from .events import get_event_bus, EventBus, ShellEvent, EventType
from .store import RuntimeStore
from .auth import get_secret, derive_api_token, derive_runtime_id

import asyncio
from typing import Optional

# Singleton manager instance
_manager_instance: Optional[FrameworkShellManager] = None
_manager_lock: Optional[asyncio.Lock] = None

def _get_lock() -> asyncio.Lock:
    global _manager_lock
    if _manager_lock is None:
        _manager_lock = asyncio.Lock()
    return _manager_lock

async def get_manager() -> FrameworkShellManager:
    """Get or create the singleton FrameworkShellManager instance."""
    global _manager_instance
    if _manager_instance is not None:
        return _manager_instance
    
    async with _get_lock():
        if _manager_instance is None:
            _manager_instance = FrameworkShellManager()
            await _manager_instance._adopt_orphaned_shells()
    
    return _manager_instance

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
