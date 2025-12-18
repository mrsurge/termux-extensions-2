"""Framework Shells - Standalone process orchestration library."""

from .manager import FrameworkShellManager
from .record import ShellRecord
from .pty import PTYState, PipeState
from .events import get_event_bus, EventBus, ShellEvent, EventType
from .store import RuntimeStore
from .auth import get_secret, derive_api_token, derive_runtime_id
from .hooks import ShellLifecycleHooks
from .process_snapshot import ProcessRecord, ProcessSnapshot, ExternalProcessProvider, ProcfsProcessProvider
from .shutdown import ShutdownPolicy, plan_shutdown, shutdown_snapshot
from .shellspec import ShellSpec, ReadinessProbe, RestartPolicy, load_shellspec, render_shellspec

import asyncio
from typing import Optional

# Singleton manager instance
_manager_instance: Optional[FrameworkShellManager] = None
_manager_lock: Optional[asyncio.Lock] = None
_manager_kwargs: Optional[dict] = None

def _get_lock() -> asyncio.Lock:
    global _manager_lock
    if _manager_lock is None:
        _manager_lock = asyncio.Lock()
    return _manager_lock

async def get_manager(**kwargs) -> FrameworkShellManager:
    """Get or create the singleton FrameworkShellManager instance.

    This is a process-wide singleton. If kwargs are provided after the manager
    is created, they must match the original creation kwargs.
    """
    global _manager_instance
    global _manager_kwargs
    if _manager_instance is not None:
        if kwargs and _manager_kwargs is not None and kwargs != _manager_kwargs:
            raise ValueError("FrameworkShellManager singleton already created with different configuration")
        return _manager_instance
    
    async with _get_lock():
        if _manager_instance is None:
            _manager_kwargs = dict(kwargs)
            _manager_instance = FrameworkShellManager(**kwargs)
            async with _manager_instance._get_lock():
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
    "ShellLifecycleHooks",
    "ProcessRecord",
    "ProcessSnapshot",
    "ExternalProcessProvider",
    "ProcfsProcessProvider",
    "ShutdownPolicy",
    "plan_shutdown",
    "shutdown_snapshot",
    "ShellSpec",
    "ReadinessProbe",
    "RestartPolicy",
    "load_shellspec",
    "render_shellspec",
    "get_manager",
]
