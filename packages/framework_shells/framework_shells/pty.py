from dataclasses import dataclass, field
import asyncio
from typing import Optional, List
from asyncio import Queue as AsyncQueue

@dataclass
class PTYState:
    master_fd: int
    label: Optional[str] = None
    shell_id: Optional[str] = None
    subscribers: List[AsyncQueue[str]] = field(default_factory=list)
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    reader: Optional[asyncio.Task] = None
    proxy_pid: Optional[int] = None


@dataclass
class PipeState:
    """State for shells with live stdin/stdout pipes (for LSP, etc.)."""
    process: asyncio.subprocess.Process
    label: Optional[str] = None
    shell_id: Optional[str] = None
    stop: asyncio.Event = field(default_factory=asyncio.Event)
