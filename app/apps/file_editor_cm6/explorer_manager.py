"""Extracted ConnectionManager and shared utilities from explorer_ws.

This module exists to break circular import chains. Previously, many modules
needed the ``manager`` singleton or ``abs_to_rel`` helper and had to import
from ``explorer_ws``, which transitively pulled in the entire explorer
dispatcher and its deep dependency tree. Extracting the connection manager
here lets lightweight consumers (sidebar_ws, editor_backend, etc.) import
just the manager without triggering the cycle.
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pure utility
# ---------------------------------------------------------------------------

def abs_to_rel(abs_path: str, project_root: str) -> Optional[str]:
    """Convert an absolute path into a project-root-relative path (best-effort)."""
    if not isinstance(abs_path, str) or not abs_path.strip():
        return None
    if not isinstance(project_root, str) or not project_root.strip():
        return None
    try:
        abs_p = Path(abs_path).expanduser().resolve(strict=False)
        root_p = Path(project_root).expanduser().resolve(strict=False)
        if abs_p == root_p:
            return "."
        rel = abs_p.relative_to(root_p)
        return str(rel)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        # Map: project_path -> List[WebSocket]
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Map: websocket -> project_path (for cleanup)
        self.ws_project_map: Dict[WebSocket, str] = {}
        self.pulse_task: Optional[asyncio.Task] = None

    async def accept_and_register(self, websocket: WebSocket, project_path: str):
        # Some shims (Socket.IO) don't need accept; provide no-op if missing
        if hasattr(websocket, 'accept'):
            try:
                await websocket.accept()
            except Exception:
                pass
        self.register_existing(websocket, project_path)

    def register_existing(self, websocket: WebSocket, project_path: str):
        # Check if this is the very first connection globally
        was_empty = not any(self.active_connections.values())
        
        if project_path not in self.active_connections:
            self.active_connections[project_path] = []
        self.active_connections[project_path].append(websocket)
        self.ws_project_map[websocket] = project_path
        logger.info(f"Client registered to project: {project_path}")
        
        if was_empty:
            self.start_pulse()
            # Start watcher for the project (using SSOT active project)
            try:
                from .core_read import init_watcher
                init_watcher()
            except Exception as e:
                logger.warning(f"Failed to start watcher on connect: {e}")

    def disconnect(self, websocket: WebSocket):
        project_path = self.ws_project_map.get(websocket)
        if project_path and project_path in self.active_connections:
            if websocket in self.active_connections[project_path]:
                self.active_connections[project_path].remove(websocket)
            if not self.active_connections[project_path]:
                del self.active_connections[project_path]
        
        if websocket in self.ws_project_map:
            del self.ws_project_map[websocket]
        
        logger.info(f"Client disconnected from project: {project_path}")
        
        # Check if no connections remain globally
        if not any(self.active_connections.values()):
            self.stop_pulse()
            # Stop watcher to save resources
            try:
                from .core_read import stop_watcher
                stop_watcher()
            except Exception as e:
                logger.warning(f"Failed to stop watcher on disconnect: {e}")

    def start_pulse(self):
        """Start the heartbeat pulse task."""
        if self.pulse_task is None or self.pulse_task.done():
            loop = asyncio.get_event_loop()
            self.pulse_task = loop.create_task(self._pulse_loop())
            logger.info("[PULSE] Heart monitor started")

    def stop_pulse(self):
        """Stop the heartbeat pulse task."""
        if self.pulse_task:
            self.pulse_task.cancel()
            self.pulse_task = None
            logger.info("[PULSE] Heart monitor stopped")

    async def _pulse_loop(self):
        """Periodically ping clients to ensure they are alive and keep connection active."""
        try:
            while True:
                await asyncio.sleep(30)
                if not any(self.active_connections.values()):
                    break
                
                # Broadcast pulse to all projects
                for project_path in list(self.active_connections.keys()):
                    await self.broadcast(project_path, {"type": "pulse"})
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[PULSE] Error in pulse loop: {e}")

    def _resolve_project_key(self, project_path: str) -> Optional[str]:
        """Find the connection key that matches this project path."""
        if project_path in self.active_connections:
            return project_path
        try:
            resolved = str(Path(project_path).expanduser().resolve(strict=False))
            if resolved in self.active_connections:
                return resolved
            for key in list(self.active_connections.keys()):
                if str(Path(key).expanduser().resolve(strict=False)) == resolved:
                    return key
        except Exception:
            pass
        return None

    def get_connection_count(self, project_path: str) -> int:
        """Returns the number of active connections for a project."""
        key = self._resolve_project_key(project_path)
        return len(self.active_connections.get(key, [])) if key else 0

    def has_connections(self, project_path: str) -> bool:
        """Returns True if there are any active connections for a project."""
        return self.get_connection_count(project_path) > 0

    async def broadcast(self, project_path: str, message: Dict[str, Any]):
        """Send message to all clients connected to a specific project."""
        try:
            msg_type = message.get("type") if isinstance(message, dict) else None
            if msg_type == "agent:open":
                payload = message.get("payload") if isinstance(message, dict) else {}
                logger.info(
                    "[explorer_broadcast] type=agent:open project=%s conn=%s payload=%s",
                    project_path,
                    self.get_connection_count(project_path),
                    {
                        "path": payload.get("path") if isinstance(payload, dict) else None,
                        "rel": payload.get("rel") if isinstance(payload, dict) else None,
                        "line": payload.get("line") if isinstance(payload, dict) else None,
                        "column": payload.get("column") if isinstance(payload, dict) else None,
                        "source": payload.get("source") if isinstance(payload, dict) else None,
                        "conversation_id": payload.get("conversation_id") if isinstance(payload, dict) else None,
                    },
                )
        except Exception:
            pass
        resolved_key = self._resolve_project_key(project_path)
        if not resolved_key:
            logger.debug(
                "[explorer_broadcast] no connections for project=%s (keys=%s)",
                project_path, list(self.active_connections.keys()),
            )
            return
        if resolved_key in self.active_connections:
            text = json.dumps(message)
            for connection in self.active_connections[resolved_key]:
                try:
                    await connection.send_text(text)
                except Exception as e:
                    logger.warning(f"Failed to send broadcast: {e}")

    async def send_personal(self, websocket: WebSocket, message: Dict[str, Any]):
        """Send message to a single client."""
        try:
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.warning(f"Failed to send personal message: {e}")


manager = ConnectionManager()
