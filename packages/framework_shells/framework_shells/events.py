from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional, Callable, Set, List
from asyncio import Queue as AsyncQueue
import asyncio
import time

class EventType(Enum):
    SHELL_CREATED = "shell.created"
    SHELL_SPAWNED = "shell.spawned"
    SHELL_READY = "shell.ready"
    SHELL_UPDATED = "shell.updated"
    SHELL_EXITED = "shell.exited"
    SHELL_REMOVED = "shell.removed"
    PTY_CHUNK = "shell.pty_chunk"
    LOG_CHUNK = "shell.log_chunk"

@dataclass
class ShellEvent:
    type: EventType
    shell_id: str
    timestamp: float = field(default_factory=time.time)
    data: Dict[str, Any] = field(default_factory=dict)
    
    # App context (derived from record)
    app_id: Optional[str] = None
    parent_shell_id: Optional[str] = None
    is_app_worker: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "shell_id": self.shell_id,
            "timestamp": self.timestamp,
            "data": self.data,
            "app_id": self.app_id,
            "parent_shell_id": self.parent_shell_id,
            "is_app_worker": self.is_app_worker,
        }

class EventBus:
    """In-process event bus with subscription support.
    
    NOTE: This bus is local to a single Python process. TE2 uses a
    single control-plane manager model — only the framework process
    instantiates a manager. App workers call the framework via HTTP.
    """
    
    def __init__(self):
        self._subscribers: Set[AsyncQueue[ShellEvent]] = set()
    
    def subscribe(self) -> AsyncQueue[ShellEvent]:
        q: AsyncQueue[ShellEvent] = AsyncQueue()
        self._subscribers.add(q)
        return q
    
    def unsubscribe(self, q: AsyncQueue[ShellEvent]) -> None:
        self._subscribers.discard(q)
    
    async def publish(self, event: ShellEvent) -> None:
        for q in list(self._subscribers):
            try:
                await q.put(event)
            except Exception:
                self._subscribers.discard(q)

# Singleton
_bus: Optional[EventBus] = None

def get_event_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus
