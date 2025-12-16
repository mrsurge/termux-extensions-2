"""Synchronous process registry for IPC server."""

from __future__ import annotations

import os
import signal
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import asyncio


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
            "force_killed_shells": [],
            "framework_shells": {
                "attempted": 0,
                "terminated": 0,
                "errors": [],
            },
        }

        # Phase 0: terminate framework_shells-managed shells.
        # IMPORTANT: these are NOT necessarily registered in IPC, and they are spawned
        # with start_new_session=True (so killing the framework PID does NOT kill them).
        try:
            from framework_shells import FrameworkShellManager

            async def _terminate_framework_shells() -> None:
                mgr = FrameworkShellManager(enable_dtach_proxy=False)
                shells = await mgr.list_shells()
                for shell in shells:
                    if getattr(shell, "status", None) != "running":
                        continue
                    stats["framework_shells"]["attempted"] += 1
                    try:
                        await mgr.terminate_shell(shell.id, force=True)
                        stats["framework_shells"]["terminated"] += 1
                    except Exception as exc:
                        stats["framework_shells"]["errors"].append(f"{shell.id}: {exc}")

            if logger:
                logger.info("IPC shutdown: terminating framework_shells shells")
            asyncio.run(_terminate_framework_shells())
            if logger:
                logger.info(
                    "IPC shutdown: framework_shells terminated %d/%d",
                    stats["framework_shells"]["terminated"],
                    stats["framework_shells"]["attempted"],
                )
        except Exception as exc:
            # Best effort: IPC should still try to kill registered processes.
            stats["framework_shells"]["errors"].append(str(exc))
            if logger:
                logger.warning(f"IPC shutdown: failed to terminate framework_shells shells: {exc}")
        
        # Sort: workers and shells before framework (children before parent)
        sorted_processes = sorted(processes, key=lambda p: 0 if p.type != "framework" else 1)
        
        # Terminate each process sequentially
        for record in sorted_processes:
            if logger:
                logger.info(f"Terminating {record.type} pid={record.pid} label={record.label}")
            
            # Attempt termination
            try:
                # Standard kill for registered processes.
                os.kill(record.pid, signal.SIGTERM)
            except ProcessLookupError:
                # Already gone
                pass
            except Exception as exc:
                stats["errors"].append(f"PID {record.pid}: {exc}")
                if logger:
                    logger.error(f"Failed to terminate pid={record.pid}: {exc}")
                # Continue to verification loop anyway
            
            # Wait for process to exit (poll with timeout)
            max_wait = 2.0
            poll_interval = 0.1
            elapsed = 0.0
            process_exited = False
            
            while elapsed < max_wait:
                time.sleep(poll_interval)
                elapsed += poll_interval
                
                try:
                    # Check if process is gone from /proc
                    # Note: We rely on os.kill(0) or /proc check
                    os.kill(record.pid, 0)
                    
                    # If os.kill succeeds, process exists. Check for zombie.
                    with open(f"/proc/{record.pid}/stat", 'r') as f:
                        stat = f.read()
                    state = stat.split()[2]
                    if state == 'Z':
                        process_exited = True
                        break
                except (ProcessLookupError, FileNotFoundError, IndexError, ValueError):
                    process_exited = True
                    break
                except Exception:
                    pass
            
            # Check final status
            if process_exited:
                if logger:
                    logger.info(f"Process {record.pid} terminated cleanly")
                stats["clean_exits"] += 1
            else:
                # Force kill if still alive
                if logger:
                    logger.warning(f"Process {record.pid} didn't exit, sending SIGKILL")
                try:
                    os.kill(record.pid, signal.SIGKILL)
                    stats["force_killed"] += 1
                except ProcessLookupError:
                    stats["clean_exits"] += 1
            
            # Remove from registry
            with self._lock:
                self._processes.pop(record.pid, None)
            stats["terminated"] += 1
        
        # Mark shutdown complete
        with self._lock:
            self._shutdown_in_progress = False
        
        if logger:
            logger.info(f"IPC shutdown complete: {stats['terminated']} total")
        
        return stats

