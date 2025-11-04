"""NiceGUI adapter for file watching and live updates."""

from __future__ import annotations

from typing import Optional, Callable
from pathlib import Path
from nicegui import ui

from .core_read import subscribe, unsubscribe, init_watcher


class FileSubscription:
    """Manages a file subscription with NiceGUI timer polling."""
    
    def __init__(self, path: str, client_id: str, on_update: Callable[[dict], None]):
        self.path = path
        self.client_id = client_id
        self.on_update = on_update
        self.token: Optional[str] = None
        self.timer: Optional[ui.timer] = None
        self._event_queue: list[dict] = []
        self._active = False
    
    def start(self) -> None:
        """Start watching the file."""
        if self._active:
            return
        
        # Subscribe to file system events
        self.token = subscribe(
            self.path,
            self.client_id,
            self._queue_event
        )
        
        # Poll event queue with NiceGUI timer (100ms interval)
        self.timer = ui.timer(0.1, self._process_events)
        self._active = True
    
    def stop(self) -> None:
        """Stop watching the file."""
        if not self._active:
            return
        
        self._active = False
        
        if self.timer:
            self.timer.cancel()
            self.timer = None
        
        if self.token:
            unsubscribe(self.token)
            self.token = None
        
        self._event_queue.clear()
    
    def _queue_event(self, event: dict) -> None:
        """Called from watcher thread - queue event for main thread."""
        if self._active:
            self._event_queue.append(event)
    
    def _process_events(self) -> None:
        """Called from NiceGUI event loop - process queued events."""
        while self._event_queue and self._active:
            event = self._event_queue.pop(0)
            try:
                self.on_update(event)
            except Exception as e:
                print(f"[FileSubscription] Error processing event: {e}")
