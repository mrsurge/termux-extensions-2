"""Autosave manager with debouncing."""

from __future__ import annotations

from typing import Optional, Callable
from pathlib import Path
from nicegui import ui

from .core_write import write_full, BaseMismatchError


class AutosaveManager:
    """Manages autosave with debouncing and conflict handling."""
    
    def __init__(self, project_root: Path, debounce_seconds: float = 1.5):
        self.project_root = project_root
        self.debounce_seconds = debounce_seconds
        self._pending_timer: Optional[ui.timer] = None
        self._pending_save: Optional[dict] = None
        self._enabled = False
    
    def set_enabled(self, enabled: bool) -> None:
        """Enable or disable autosave."""
        self._enabled = enabled
        if not enabled and self._pending_timer:
            self._pending_timer.cancel()
            self._pending_timer = None
            self._pending_save = None
    
    def is_enabled(self) -> bool:
        """Check if autosave is enabled."""
        return self._enabled
    
    def schedule_save(
        self,
        path: str,
        content: str,
        base_sha256: Optional[str],
        client_id: str,
        op_id: str,
        on_success: Callable[[dict], None],
        on_conflict: Callable[[dict], None],
        on_error: Callable[[str], None]
    ) -> None:
        """Schedule a save with debouncing."""
        if not self._enabled:
            return
        
        # Cancel pending save
        if self._pending_timer:
            self._pending_timer.cancel()
            self._pending_timer = None
        
        # Store pending save data
        self._pending_save = {
            'path': path,
            'content': content,
            'base_sha256': base_sha256,
            'client_id': client_id,
            'op_id': op_id,
            'on_success': on_success,
            'on_conflict': on_conflict,
            'on_error': on_error,
        }
        
        # Schedule save
        self._pending_timer = ui.timer(
            self.debounce_seconds,
            self._execute_save,
            once=True
        )
    
    def cancel_pending(self) -> None:
        """Cancel any pending save."""
        if self._pending_timer:
            self._pending_timer.cancel()
            self._pending_timer = None
        self._pending_save = None
    
    def _execute_save(self) -> None:
        """Execute the pending save."""
        if not self._pending_save:
            return
        
        data = self._pending_save
        self._pending_save = None
        self._pending_timer = None
        
        try:
            meta = write_full(
                self.project_root,
                data['path'],
                data['content'],
                base_sha256=data['base_sha256']
            )
            
            # Notify via core_read to trigger save_ack
            from .core_read import push_save_ack
            push_save_ack(
                data['path'],
                data['op_id'],
                data['client_id'],
                meta
            )
            
            data['on_success'](meta)
            
        except BaseMismatchError as e:
            data['on_conflict'](e.current_meta)
        except Exception as e:
            data['on_error'](str(e))
