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
    
    def shutdown_all(self, logger=None) -> Dict[str, Any]:
        """Shutdown all registered processes SEQUENTIALLY.
        
        Processes are killed one at a time in dependency order:
        - Workers and shells first (children)
        - Framework last (parent)
        
        No timeouts, no waiting - just SIGTERM → verify death → next process.
        
        Shell logs are preserved for force-killed processes (diagnostic purposes).
        
        Returns statistics about the shutdown process.
        """
        with self._lock:
            if self._shutdown_in_progress:
                return {"already_in_progress": True}
            self._shutdown_in_progress = True
            processes = list(self._processes.values())
        
        if logger:
            logger.info(f"IPC shutdown: {len(processes)} processes to terminate")
        
        stats = {
            "total": len(processes),
            "terminated": 0,
            "clean_exits": 0,
            "force_killed": 0,
            "errors": [],
            "force_killed_shells": [],  # Shell IDs that were force-killed (preserve logs)
        }
        
        # Sort: workers and shells before framework (children before parent)
        sorted_processes = sorted(processes, key=lambda p: 0 if p.type != "framework" else 1)
        
        # Terminate each process sequentially
        for record in sorted_processes:
            if logger:
                logger.info(f"Terminating {record.type} pid={record.pid} label={record.label}")
            
            # Send SIGTERM
            try:
                os.kill(record.pid, signal.SIGTERM)
            except ProcessLookupError:
                if logger:
                    logger.info(f"Process {record.pid} already gone")
                with self._lock:
                    self._processes.pop(record.pid, None)
                continue
            except Exception as exc:
                stats["errors"].append(f"PID {record.pid}: {exc}")
                if logger:
                    logger.error(f"Failed to SIGTERM pid={record.pid}: {exc}")
                continue
            
            # Wait for process to exit (poll with timeout)
            # Note: Process may become a zombie before being reaped - that's still "exited"
            max_wait = 2.0  # Maximum 2 seconds
            poll_interval = 0.1
            elapsed = 0.0
            process_exited = False
            
            while elapsed < max_wait:
                time.sleep(poll_interval)
                elapsed += poll_interval
                
                # Check if process is gone OR is a zombie (effectively exited)
                try:
                    # Read process state from /proc
                    stat_file = f"/proc/{record.pid}/stat"
                    with open(stat_file, 'r') as f:
                        stat = f.read()
                    # State is 3rd field: R=running, S=sleeping, Z=zombie, etc.
                    state = stat.split()[2]
                    
                    if state == 'Z':
                        # Process is zombie - it has exited, parent just hasn't reaped it yet
                        process_exited = True
                        if logger:
                            logger.debug(f"Process {record.pid} is zombie (clean exit)")
                        break
                    # else: still actually running, keep waiting
                    
                except (FileNotFoundError, IndexError, ValueError):
                    # /proc entry gone = process fully reaped
                    process_exited = True
                    break
                except Exception as exc:
                    # Unexpected error - assume still running to be safe
                    if logger:
                        logger.warning(f"Failed to check state for {record.pid}: {exc}")
            
            # Check final status
            if process_exited:
                # Exited cleanly
                if logger:
                    logger.info(f"Process {record.pid} terminated cleanly (after {elapsed:.2f}s)")
                stats["clean_exits"] += 1
                
                # Note: Shell logs are left alone during shutdown
                # Startup cycle will handle all log housekeeping
            else:
                # Still alive after max_wait - force kill
                if logger:
                    logger.warning(f"Process {record.pid} didn't exit after {max_wait}s, sending SIGKILL")
                try:
                    os.kill(record.pid, signal.SIGKILL)
                    stats["force_killed"] += 1
                    
                    # Track shell_id for log preservation
                    if "shell_id" in record.metadata:
                        stats["force_killed_shells"].append(record.metadata["shell_id"])
                        if logger:
                            logger.info(f"Marked shell {record.metadata['shell_id']} for log preservation")
                except ProcessLookupError:
                    # Exited between our check and SIGKILL
                    if logger:
                        logger.info(f"Process {record.pid} exited just before SIGKILL")
                    stats["clean_exits"] += 1
            
            # Remove from registry
            with self._lock:
                self._processes.pop(record.pid, None)
            stats["terminated"] += 1
        
        # Mark shutdown complete
        with self._lock:
            self._shutdown_in_progress = False
        
        if logger:
            logger.info(f"IPC shutdown complete: {stats['terminated']} total ({stats['clean_exits']} clean, {stats['force_killed']} killed)")
            if stats["force_killed_shells"]:
                logger.info(f"Preserved logs for force-killed shells: {stats['force_killed_shells']}")
        
        return stats

