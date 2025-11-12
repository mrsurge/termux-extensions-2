"""Synchronous process registry for IPC server."""

from __future__ import annotations

import os
import signal
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ProcessRecord:
    """Metadata for a tracked process."""
    pid: int
    type: str  # "framework", "worker", "shell"
    label: Optional[str]
    parent_pid: Optional[int]
    registered_at: float
    metadata: Dict[str, Any] = field(default_factory=dict)
    last_ping: Optional[float] = None
    
    def to_dict(self) -> dict:
        return {
            "pid": self.pid,
            "type": self.type,
            "label": self.label,
            "parent_pid": self.parent_pid,
            "registered_at": self.registered_at,
            "metadata": self.metadata,
            "last_ping": self.last_ping,
        }


class ProcessRegistry:
    """Thread-safe process tracking."""
    
    def __init__(self):
        self._lock = threading.Lock()
        self._processes: Dict[int, ProcessRecord] = {}
        self._shutdown_in_progress = False
    
    def register(
        self,
        pid: int,
        type: str,
        label: Optional[str] = None,
        parent_pid: Optional[int] = None,
        metadata: Optional[Dict] = None,
    ) -> ProcessRecord:
        """Register a process."""
        with self._lock:
            record = ProcessRecord(
                pid=pid,
                type=type,
                label=label,
                parent_pid=parent_pid,
                registered_at=time.time(),
                metadata=metadata or {},
                last_ping=time.time(),
            )
            self._processes[pid] = record
            return record
    
    def unregister(self, pid: int) -> bool:
        """Remove a process from tracking."""
        with self._lock:
            return self._processes.pop(pid, None) is not None
    
    def get(self, pid: int) -> Optional[ProcessRecord]:
        """Get a process record."""
        with self._lock:
            return self._processes.get(pid)
    
    def list_all(self) -> List[ProcessRecord]:
        """Get all tracked processes."""
        with self._lock:
            return list(self._processes.values())
    
    def ping(self, pid: int) -> bool:
        """Update last ping time."""
        with self._lock:
            record = self._processes.get(pid)
            if record:
                record.last_ping = time.time()
                return True
            return False
    
    def count(self) -> int:
        """Get process count."""
        with self._lock:
            return len(self._processes)
    
    def shutdown_all(self, timeout: float = 5.0, logger=None) -> Dict[str, Any]:
        """Shutdown all registered processes.
        
        Returns statistics about the shutdown process.
        """
        with self._lock:
            if self._shutdown_in_progress:
                return {"already_in_progress": True}
            self._shutdown_in_progress = True
            processes = list(self._processes.values())
        
        if logger:
            logger.info(f"Shutdown initiated for {len(processes)} processes")
        
        stats = {
            "total": len(processes),
            "sigterm_sent": 0,
            "sigkill_sent": 0,
            "not_found": 0,
            "errors": [],
        }
        
        # Phase 1: Send SIGTERM to all
        for record in processes:
            try:
                os.kill(record.pid, signal.SIGTERM)
                stats["sigterm_sent"] += 1
                if logger:
                    logger.info(f"Sent SIGTERM to {record.type} pid={record.pid} label={record.label}")
            except ProcessLookupError:
                stats["not_found"] += 1
            except Exception as exc:
                stats["errors"].append(f"PID {record.pid}: {exc}")
                if logger:
                    logger.error(f"Failed to SIGTERM pid={record.pid}: {exc}")
        
        # Phase 2: Wait for graceful shutdown
        if logger:
            logger.info(f"Waiting {timeout}s for graceful shutdown...")
        time.sleep(timeout)
        
        # Phase 3: SIGKILL stragglers
        for record in processes:
            try:
                # Check if still alive
                os.kill(record.pid, 0)  # Signal 0 just checks if process exists
                # Still alive, force kill
                os.kill(record.pid, signal.SIGKILL)
                stats["sigkill_sent"] += 1
                if logger:
                    logger.warning(f"Sent SIGKILL to straggler pid={record.pid} label={record.label}")
            except ProcessLookupError:
                # Already dead, good
                pass
            except Exception as exc:
                stats["errors"].append(f"PID {record.pid} SIGKILL: {exc}")
                if logger:
                    logger.error(f"Failed to SIGKILL pid={record.pid}: {exc}")
        
        # Phase 4: Clear registry
        with self._lock:
            self._processes.clear()
            self._shutdown_in_progress = False
        
        if logger:
            logger.info(f"Shutdown complete: {stats}")
        
        return stats

