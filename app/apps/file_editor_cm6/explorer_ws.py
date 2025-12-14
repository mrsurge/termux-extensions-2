import asyncio
import json
import logging
from contextlib import suppress
from typing import Dict, Any, List, Optional
from fastapi import WebSocket, WebSocketDisconnect

from queue import Queue, Empty

# Import git_service to register job handlers in worker process
import app.libs.git_service  # noqa: F401 - registers git_push, git_pull, git_clone handlers

from .explorer_helper import (
    list_dir,
    create_directory,
    create_file,
    rename_entry,
    delete_entry,
    batch_delete,
    copy_entry,
    move_entry,
    batch_copy,
    batch_move,
    copy_entry_inbound,
    move_entry_inbound,
    create_project,
    get_project_root,
    set_project_root,
    mark_git_cache_dirty,
    get_all_git_statuses,
)
from .git_helper import (
    get_status as git_get_status,
    stage_paths,
    unstage_paths,
    stage_all as git_stage_all,
    unstage_all as git_unstage_all,
    commit_changes,
    push_changes,
    pull_changes,
    reset_hard,
    init_repository,
    restore_path,
    get_commit_info,
    list_branches as git_list_branches,
    get_commits as git_get_commits,
    GitError,
)
from .stores import _history_store, _preferences_store
from .project_sidecar import ProjectSidecar
from .explorer import search, review

# Logger setup
logger = logging.getLogger(__name__)


class SocketIOSocketShim:
    """Lightweight shim to let ExplorerDispatcher use Socket.IO sessions.

    Provides accept() and send_text() to satisfy ConnectionManager.
    """

    def __init__(self, namespace, sid):
        self.namespace = namespace
        self.sid = sid

    async def accept(self):
        # Socket.IO is already connected; nothing to do
        return

    async def send_text(self, text: str):
        await self.namespace.emit('explorer:event', text, room=self.sid)

# --- Connection Manager ---

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
    
    def get_connection_count(self, project_path: str) -> int:
        """Returns the number of active connections for a project."""
        return len(self.active_connections.get(project_path, []))
    
    def has_connections(self, project_path: str) -> bool:
        """Returns True if there are any active connections for a project."""
        return self.get_connection_count(project_path) > 0

    async def broadcast(self, project_path: str, message: Dict[str, Any]):
        """Send message to all clients connected to a specific project."""
        if project_path in self.active_connections:
            # Create text message once
            text = json.dumps(message)
            for connection in self.active_connections[project_path]:
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

# --- Watcher -> Explorer Bridge ---
# This allows the file watcher (running in a background thread) to trigger
# explorer tree refreshes when files are created/deleted/moved externally.

import asyncio
from threading import Timer

_explorer_event_loop: Optional[asyncio.AbstractEventLoop] = None


async def reset_project_session(new_project_path: str) -> None:
    """Set the active project on explicit project switch.

    This is called from explorer flows (open/create/clone) whenever the user
    selects a new project root.

    IMPORTANT (Phase 6 change):
    - We NO LONGER clear session_cache (drafts) or tracked_jobs here.
    - Drafts persist per-project and are only cleared via explicit user actions:
      - Review tab "Discard"
      - Projects modal soft reset (for active project)
      - Projects modal hard delete (for non-active projects)
    - This allows multi-project draft retention: switching away from a project
      and back again preserves any unsaved changes in that project's sidecar.

    NOTE:
    - We intentionally do NOT manipulate session_count here. The counter is
      strictly informational (number of boots).
    """
    from pathlib import Path

    normalized_path = str(Path(new_project_path).expanduser().resolve())
    # Update active project in the history store (SSOT for active project)
    _history_store.set_active_project(normalized_path)

    # Ensure sidecar exists for the project (lazy create)
    sidecar = ProjectSidecar.load_or_create(normalized_path)
    # NOTE: We intentionally do NOT clear session_cache or tracked_jobs here.
    # Drafts and jobs persist across project switches.
    sidecar.save()

    # Force any live terminal drawers to reconnect so they bind to the
    # new active project's shell. Frontend stays project-agnostic.
    try:
        from .terminal_backend import close_active_terminal_sockets
        await close_active_terminal_sockets()
    except Exception:
        pass

# Debounce explorer refreshes to avoid flooding
_explorer_refresh_timers: Dict[str, Timer] = {}
_explorer_refresh_lock = __import__('threading').Lock()
EXPLORER_REFRESH_DEBOUNCE = 0.25  # 250ms

def set_explorer_event_loop(loop: asyncio.AbstractEventLoop):
    """Called during app startup to set the event loop for watcher callbacks."""
    global _explorer_event_loop
    _explorer_event_loop = loop

def notify_explorer_of_change(abs_path: str, event_type: str):
    """
    Called by the file watcher when a file/directory is created, deleted, or modified.
    Schedules an explorer refresh for the affected directory (debounced).
    Also triggers git status update for the whole project.
    """
    if not _explorer_event_loop or not manager.active_connections:
        return
    
    # Find which project this path belongs to
    for project_path in manager.active_connections.keys():
        if abs_path.startswith(project_path):
            try:
                # Get the parent directory relative to project
                rel_path = _get_rel_from_abs(abs_path, project_path)
                parent_rel = _get_parent_rel(rel_path)
                
                # Debounce directory refresh
                debounce_key = f"{project_path}:{parent_rel}"
                with _explorer_refresh_lock:
                    existing_timer = _explorer_refresh_timers.get(debounce_key)
                    if existing_timer:
                        existing_timer.cancel()
                    
                    def do_refresh():
                        with _explorer_refresh_lock:
                            _explorer_refresh_timers.pop(debounce_key, None)
                        asyncio.run_coroutine_threadsafe(
                            _refresh_explorer_directory(project_path, parent_rel),
                            _explorer_event_loop
                        )
                    
                    timer = Timer(EXPLORER_REFRESH_DEBOUNCE, do_refresh)
                    _explorer_refresh_timers[debounce_key] = timer
                    timer.start()
                
                # Also trigger git status update (debounced separately)
                # This ensures parent directories get updated even when collapsed
                _schedule_git_status_broadcast(project_path)
                    
            except Exception as e:
                logger.warning(f"Failed to notify explorer of change: {e}")
            break


def _schedule_git_status_broadcast(project_path: str):
    """Schedule a debounced git status broadcast for the project."""
    debounce_key = f"git:{project_path}"
    with _explorer_refresh_lock:
        existing_timer = _explorer_refresh_timers.get(debounce_key)
        if existing_timer:
            existing_timer.cancel()
        
        def do_broadcast():
            with _explorer_refresh_lock:
                _explorer_refresh_timers.pop(debounce_key, None)
            asyncio.run_coroutine_threadsafe(
                _broadcast_git_status_update(project_path),
                _explorer_event_loop
            )
        
        # Use slightly longer debounce for git status (500ms)
        timer = Timer(0.5, do_broadcast)
        _explorer_refresh_timers[debounce_key] = timer
        timer.start()


async def _broadcast_git_status_update(project_path: str):
    """Broadcast git status decorations and summary for a project."""
    try:
        from pathlib import Path
        mark_git_cache_dirty(Path(project_path))
        
        # 1. Broadcast tree decorations (explorer:updateGitStatus)
        statuses = get_all_git_statuses()
        msg = {"type": "explorer:updateGitStatus", "payload": {"statuses": statuses}}
        await manager.broadcast(project_path, msg)
        
        # 2. Broadcast summary bar (git:status)
        status = git_get_status(Path(project_path))
        logger.info(f"[GIT_STATUS_DEBUG] staged={status.staged}, unstaged={status.unstaged}, untracked={status.untracked}")
        summary_msg = {
            "type": "git:status",
            "payload": {
                "branch": status.branch,
                "detached": status.detached,
                "ahead": status.ahead,
                "behind": status.behind,
                "staged": status.staged,
                "unstaged": status.unstaged,
                "untracked": status.untracked,
            }
        }
        await manager.broadcast(project_path, summary_msg)
    except Exception as e:
        logger.warning(f"Failed to broadcast git status update: {e}")

async def _refresh_explorer_directory(project_path: str, rel_dir: str):
    """Broadcasts an explorer:setList for the given directory."""
    try:
        dir_listing = list_dir(rel_dir)
        msg = {"type": "explorer:setList", "payload": dir_listing}
        await manager.broadcast(project_path, msg)
    except Exception as e:
        logger.warning(f"Failed to refresh explorer directory {rel_dir}: {e}")


async def _broadcast_draft_decorations(project_path: str):
    """Broadcasts explorer:updateDecorations with current draft state."""
    try:
        from pathlib import Path
        # Normalize to absolute path to match how connections are registered
        normalized_path = str(Path(project_path).resolve())
        reviews = await review.list_reviews(Path(project_path), lightweight=True)
        draft_decorations = {r["rel"]: {"hasDraft": True} for r in reviews if r.get("has_draft")}
        msg = {"type": "explorer:updateDecorations", "payload": {"drafts": draft_decorations}}
        await manager.broadcast(normalized_path, msg)
    except Exception as e:
        logger.warning(f"Failed to broadcast draft decorations: {e}")


def notify_draft_state_changed(project_path: str):
    """
    Called when draft state changes (file edited, saved, or discarded).
    Schedules a broadcast of updated draft decorations to all explorer clients.
    Debounced to avoid flooding during rapid edits.
    """
    from .explorer_helper import mark_draft_cache_dirty
    from pathlib import Path
    
    if not _explorer_event_loop:
        return
    
    # Normalize to absolute path to match how connections are registered
    normalized_path = str(Path(project_path).resolve())
    
    # Check if there are any connections for this project
    if not manager.has_connections(normalized_path):
        return
    
    # Invalidate the draft cache so next list_dir picks up fresh data
    mark_draft_cache_dirty(Path(project_path))
    
    # Debounce draft decoration broadcasts
    debounce_key = f"drafts:{normalized_path}"
    with _explorer_refresh_lock:
        existing_timer = _explorer_refresh_timers.get(debounce_key)
        if existing_timer:
            existing_timer.cancel()
        
        def do_broadcast():
            with _explorer_refresh_lock:
                _explorer_refresh_timers.pop(debounce_key, None)
            asyncio.run_coroutine_threadsafe(
                _broadcast_draft_decorations(normalized_path),
                _explorer_event_loop
            )
        
        # Use a slightly longer debounce for drafts (500ms) since autosave is frequent
        timer = Timer(0.5, do_broadcast)
        _explorer_refresh_timers[debounce_key] = timer
        timer.start()


# --- Helpers ---

def _get_parent_rel(rel_path: str) -> str:
    """Get the parent directory rel path. Returns '.' for root-level items."""
    if not rel_path or rel_path == '.':
        return '.'
    parts = rel_path.replace('\\', '/').split('/')
    if len(parts) <= 1:
        return '.'
    return '/'.join(parts[:-1])

def _get_rel_from_abs(abs_path: str, project_root) -> str:
    """Convert absolute path to project-relative path, or '.' if outside project."""
    from pathlib import Path
    try:
        abs_p = Path(abs_path).resolve()
        root_p = Path(project_root).resolve()
        if str(abs_p).startswith(str(root_p)):
            rel = abs_p.relative_to(root_p)
            return str(rel) if str(rel) != '.' else '.'
    except Exception:
        pass
    return '.'

# --- Dispatcher ---

class ExplorerDispatcher:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.project_root = get_project_root()
        self._job_queue: Optional[Queue] = None
        self._job_listener = None
        self._job_pump_task: Optional[asyncio.Task] = None
        self._tracked_job_ids: set = set()  # Jobs we started from this dispatcher
        
    async def initialize(self):
        # Set the event loop for watcher -> explorer bridge
        # This allows the file watcher thread to schedule async refreshes
        global _explorer_event_loop
        if _explorer_event_loop is None:
            _explorer_event_loop = asyncio.get_event_loop()
        
        # --- WATCHER LIFECYCLE (future implementation) ---
        # When first client connects, we could start the file watcher:
        # if not manager.has_connections(str(self.project_root)):
        #     from .core_read import init_watcher
        #     init_watcher(self.project_root)
        # ------------------------------------------------
        
        # Register connection with current project
        await manager.accept_and_register(self.websocket, str(self.project_root))
        
        # --- Job Registry Listener ---
        # Subscribe to job updates and forward relevant ones to this client
        try:
            from app.libs.jobs import manager as job_manager
            self._job_queue = Queue()
            self._job_listener = job_manager.add_listener(self._job_queue, job_ids=None)
            self._job_pump_task = asyncio.create_task(self._pump_job_events())
        except Exception as e:
            logger.warning(f"Failed to register job listener: {e}")
        
        # Send initial state snapshots
        # 1. Project Info
        await self.emit_personal("project:setActive", {"path": str(self.project_root)})
        # 1.5 UI Preferences (PreferenceStore-backed)
        try:
            prefs = _preferences_store.get_preferences()
            ui_prefs = prefs.get("ui") or {}
            await self.emit_personal("prefs:setUi", {"ui": ui_prefs})
        except Exception as e:
            logger.warning(f"Failed to load UI preferences: {e}")
        # 2. Git Status
        await self.broadcast_git_status()
        # 3. Explorer Tree (Root)
        await self.emit_personal("explorer:setList", list_dir('.'))
        # 4. Review List (if any)
        await self.broadcast_review_state()
        # 5. Open Directories (for restoring tree state)
        try:
            sidecar = ProjectSidecar.load_or_create(str(self.project_root))
            open_dirs = sidecar.get_open_directories()
            await self.emit_personal("explorer:setOpenDirs", {"dirs": open_dirs})
        except Exception as e:
            logger.warning(f"Failed to load open directories: {e}")
    
    async def _pump_job_events(self):
        """Background task to forward job updates to this client."""
        logger.debug("[JOB_PUMP] Started job pump task")
        while True:
            try:
                # Non-blocking check with short timeout
                payload = await asyncio.to_thread(self._job_queue.get, timeout=0.5)
                
                for job_data in payload.get("jobs", []):
                    job_id = job_data.get("id", "")
                    job_type = job_data.get("type", "")
                    job_status = job_data.get("status", "")
                    
                    # Only forward jobs we're tracking (ones we started)
                    if job_id in self._tracked_job_ids:
                        await self.emit_personal("job:progress", job_data)
                        
                        # Clean up tracking when job completes
                        if job_status in ("succeeded", "failed", "cancelled"):
                            self._tracked_job_ids.discard(job_id)
                            try:
                                sidecar = ProjectSidecar.load_or_create(str(self.project_root))
                                sidecar.remove_tracked_job(job_id)
                                sidecar.save()
                            except Exception:
                                pass
                            
                            # On clone success, refresh to pick up git status
                            if job_type == "git_clone" and job_status == "succeeded":
                                logger.info(f"[JOB_PUMP] Clone succeeded, refreshing explorer")
                                await self.broadcast_git_status()
                                await self.handle_explorer_refresh({}, None)
                    else:
                        # Race condition: job emitted before we tracked it
                        logger.warning(f"[JOB_PUMP] Missed event for untracked job {job_id} ({job_type})")
                        
            except Empty:
                continue
            except asyncio.CancelledError:
                logger.debug("[JOB_PUMP] Task cancelled")
                break
            except Exception as e:
                logger.warning(f"[JOB_PUMP] Error: {e}")
                await asyncio.sleep(0.5)

    async def cleanup(self):
        # Stop job pump task
        if self._job_pump_task:
            self._job_pump_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._job_pump_task
        
        # Unregister job listener
        if self._job_listener:
            try:
                from app.libs.jobs import manager as job_manager
                job_manager.remove_listener(self._job_listener)
            except Exception:
                pass
        
        manager.disconnect(self.websocket)

    # --- Helpers ---

    async def emit_personal(self, type: str, payload: Dict[str, Any], reply_to: Optional[str] = None):
        msg = {"type": type, "payload": payload}
        if reply_to:
            msg["id"] = reply_to
        await manager.send_personal(self.websocket, msg)

    async def broadcast(self, type: str, payload: Dict[str, Any]):
        msg = {"type": type, "payload": payload}
        await manager.broadcast(str(self.project_root), msg)

    async def send_error(self, message: str, reply_to: Optional[str] = None):
        payload = {"error": message}
        await self.emit_personal("error", payload, reply_to)

    async def broadcast_git_status(self):
        try:
            status = git_get_status(self.project_root)
            logger.info(f"[GIT_STATUS_DEBUG] broadcast_git_status: staged={status.staged}, unstaged={status.unstaged}, untracked={status.untracked}")
            data = {
                "branch": status.branch,
                "detached": status.detached,
                "ahead": status.ahead,
                "behind": status.behind,
                "staged": status.staged,
                "unstaged": status.unstaged,
                "untracked": status.untracked,
            }
            await self.broadcast("git:status", data)
        except Exception:
            # Not a git repo or error, maybe broadcast null or empty status?
            pass

    async def broadcast_git_decorations(self):
        """Broadcast git status decorations for all files and directories.
        
        This allows the frontend to update gitStatus classes on existing DOM nodes
        without replacing the tree structure (preserves expanded state).
        """
        try:
            statuses = get_all_git_statuses()
            await self.broadcast("explorer:updateGitStatus", {"statuses": statuses})
        except Exception:
            pass

    async def broadcast_review_state(self):
        """Broadcast updated review entries and decoration updates."""
        # 1. Review List
        reviews = await review.list_reviews(self.project_root, lightweight=True)
        await self.broadcast("review:setEntries", {"entries": reviews})
        
        # 2. Decorations (Drafts)
        # We need to map the reviews to a decoration map { "rel": { "hasDraft": true } }
        draft_decorations = { r["rel"]: {"hasDraft": True} for r in reviews if r.get("has_draft") }
        await self.broadcast("explorer:updateDecorations", {"drafts": draft_decorations})

    # --- Message Loop ---

    async def handle_message(self, raw_msg: str):
        try:
            data = json.loads(raw_msg)
        except json.JSONDecodeError:
            return await self.send_error("Invalid JSON")

        msg_type = data.get("type")
        payload = data.get("payload", {})
        msg_id = data.get("id")

        if not msg_type:
            return await self.send_error("Missing message type", msg_id)

        # Normalize handler name: explorer:list -> handle_explorer_list
        handler_name = f"handle_{msg_type.replace(':', '_')}"
        handler = getattr(self, handler_name, None)

        if not handler:
            logger.warning(f"Unknown message type: {msg_type}")
            return await self.send_error(f"Unknown command: {msg_type}", msg_id)

        try:
            # Refresh context (in case it changed globally, though we track per-socket)
            # Actually, per-socket tracking is safer for multi-project support later.
            # For now, self.project_root is authoritative for THIS socket.
            await handler(payload, msg_id)
        except Exception as e:
            logger.exception(f"Error handling {msg_type}")
            await self.send_error(str(e), msg_id)

    async def handle_message_json(self, data: dict):
        msg_type = data.get("type") if isinstance(data, dict) else None
        payload = data.get("payload", {}) if isinstance(data, dict) else {}
        msg_id = data.get("id") if isinstance(data, dict) else None

        if not msg_type:
            return await self.send_error("Missing message type", msg_id)

        handler_name = f"handle_{msg_type.replace(':', '_')}"
        handler = getattr(self, handler_name, None)

        if not handler:
            logger.warning(f"Unknown message type: {msg_type}")
            return await self.send_error(f"Unknown command: {msg_type}", msg_id)

        try:
            await handler(payload, msg_id)
        except Exception as e:
            logger.exception(f"Error handling {msg_type}")
            await self.send_error(str(e), msg_id)

    # --- Handlers ---

    async def handle_explorer_list(self, payload: dict, msg_id: str):
        rel = payload.get("rel", ".")
        try:
            data = list_dir(rel)
            # This is a personal response (lazy load), not a broadcast
            await self.emit_personal("explorer:setList", data, msg_id)
        except Exception as e:
            await self.send_error(str(e), msg_id)

    async def handle_explorer_refresh(self, payload: dict, msg_id: str):
        # Refresh everything
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_review_state()
        # For tree, we typically just refresh the view from client, or broadcast root?
        # Let's broadcast root to be safe.
        data = list_dir('.')
        await self.broadcast("explorer:setList", data)

    async def handle_explorer_setOpenDirs(self, payload: dict, msg_id: str):
        """Persist the list of open directories in explorer tree."""
        dirs = payload.get("dirs", [])
        if not isinstance(dirs, list):
            dirs = []
        try:
            sidecar = ProjectSidecar.load_or_create(str(self.project_root))
            sidecar.set_open_directories(dirs)
            sidecar.save()
        except Exception as e:
            logger.warning(f"Failed to save open directories: {e}")

    async def handle_prefs_updateUi(self, payload: dict, msg_id: str):
        """Update a single UI preference key via PreferenceStore (backend owns defaults)."""
        key = payload.get("key")
        value = payload.get("value")

        if not isinstance(key, str) or not key.strip():
            return await self.send_error("prefs:updateUi requires 'key' (string)", msg_id)

        if not isinstance(value, bool):
            # Accept a few common serializations to be resilient.
            if isinstance(value, (int, float)) and value in (0, 1):
                value = bool(value)
            elif isinstance(value, str):
                lowered = value.strip().lower()
                if lowered in ("true", "1", "yes", "on"):
                    value = True
                elif lowered in ("false", "0", "no", "off"):
                    value = False
                else:
                    return await self.send_error(
                        "prefs:updateUi requires 'value' (boolean)",
                        msg_id,
                    )
            else:
                return await self.send_error(
                    "prefs:updateUi requires 'value' (boolean)",
                    msg_id,
                )

        try:
            updated = _preferences_store.update_preferences(ui={key: value})
        except Exception as e:
            logger.warning(f"Failed to update UI preference {key}: {e}")
            return await self.send_error(str(e), msg_id)

        ui_prefs = updated.get("ui") or {}
        await self.broadcast("prefs:setUi", {"ui": ui_prefs})

    # --- File Operations (Broadcasts updates) ---

    async def handle_explorer_createFile(self, payload: dict, msg_id: str):
        res = create_file(payload.get("parent_rel", "."), payload.get("name"))
        await self.broadcast("explorer:created", res)
        # Implicitly refresh parent dir? Client should request or we push?
        # Ideally we push the updated list of the parent.
        parent_list = list_dir(payload.get("parent_rel", "."))
        await self.broadcast("explorer:setList", parent_list)

    async def handle_explorer_createDir(self, payload: dict, msg_id: str):
        res = create_directory(payload.get("parent_rel", "."), payload.get("name"))
        await self.broadcast("explorer:created", res)
        parent_list = list_dir(payload.get("parent_rel", "."))
        await self.broadcast("explorer:setList", parent_list)

    async def handle_explorer_rename(self, payload: dict, msg_id: str):
        rel = payload.get("rel")
        parent_rel = _get_parent_rel(rel)
        res = rename_entry(rel, payload.get("new_name"))
        await self.broadcast("explorer:renamed", res)
        # Refresh parent directory
        await self.broadcast("explorer:setList", list_dir(parent_rel))

    async def handle_explorer_delete(self, payload: dict, msg_id: str):
        rel = payload.get("rel")
        parent_rel = _get_parent_rel(rel)
        res = delete_entry(rel)
        await self.broadcast("explorer:deleted", res)
        # Refresh the parent directory to reflect deletion
        await self.broadcast("explorer:setList", list_dir(parent_rel))
        # Update git status
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_git_decorations()

    async def handle_explorer_batchDelete(self, payload: dict, msg_id: str):
        rels = payload.get("rels", [])
        res = batch_delete(rels)
        await self.broadcast("explorer:batchDeleted", res)
        # Collect unique parent directories and refresh each
        parent_rels = set(_get_parent_rel(r) for r in rels)
        for parent_rel in parent_rels:
            try:
                await self.broadcast("explorer:setList", list_dir(parent_rel))
            except Exception:
                pass  # Directory may no longer exist
        # Update git status
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_git_decorations()

    async def handle_explorer_batchCopy(self, payload: dict, msg_id: str):
        rels = payload.get("rels", [])
        dest_path = payload.get("dest_path")
        res = batch_copy(rels, dest_path)
        await self.broadcast("explorer:batchCopied", res)
        # Refresh destination directory (source unchanged for copy)
        dest_rel = _get_rel_from_abs(dest_path, self.project_root)
        try:
            await self.broadcast("explorer:setList", list_dir(dest_rel))
        except Exception:
            pass

    async def handle_explorer_batchMove(self, payload: dict, msg_id: str):
        rels = payload.get("rels", [])
        dest_path = payload.get("dest_path")
        res = batch_move(rels, dest_path)
        await self.broadcast("explorer:batchMoved", res)
        # Refresh source parent directories and destination
        parent_rels = set(_get_parent_rel(r) for r in rels)
        dest_rel = _get_rel_from_abs(dest_path, self.project_root)
        parent_rels.add(dest_rel)
        for parent_rel in parent_rels:
            try:
                await self.broadcast("explorer:setList", list_dir(parent_rel))
            except Exception:
                pass

    async def handle_explorer_move(self, payload: dict, msg_id: str):
        rel = payload.get("rel")
        dest_path = payload.get("dest_path")
        source_parent = _get_parent_rel(rel)
        res = move_entry(rel, dest_path)
        await self.broadcast("explorer:moved", res)
        # Refresh source parent and destination
        dest_rel = _get_rel_from_abs(dest_path, self.project_root)
        for parent_rel in set([source_parent, dest_rel]):
            try:
                await self.broadcast("explorer:setList", list_dir(parent_rel))
            except Exception:
                pass

    async def handle_explorer_copy(self, payload: dict, msg_id: str):
        rel = payload.get("rel")
        dest_path = payload.get("dest_path")
        res = copy_entry(rel, dest_path)
        await self.broadcast("explorer:copied", res)
        # Refresh destination directory only (source unchanged)
        dest_rel = _get_rel_from_abs(dest_path, self.project_root)
        try:
            await self.broadcast("explorer:setList", list_dir(dest_rel))
        except Exception:
            pass

    async def handle_explorer_copyFrom(self, payload: dict, msg_id: str):
        dest_rel = payload.get("dest_rel")
        res = copy_entry_inbound(payload.get("source_path"), dest_rel)
        await self.broadcast("explorer:copied", res)
        # Refresh destination directory
        try:
            await self.broadcast("explorer:setList", list_dir(dest_rel))
        except Exception:
            pass

    async def handle_explorer_moveFrom(self, payload: dict, msg_id: str):
        dest_rel = payload.get("dest_rel")
        res = move_entry_inbound(payload.get("source_path"), dest_rel)
        await self.broadcast("explorer:moved", res)
        # Refresh destination directory
        try:
            await self.broadcast("explorer:setList", list_dir(dest_rel))
        except Exception:
            pass

    # --- Git Operations (Broadcasts Status) ---

    async def handle_git_status(self, payload: dict, msg_id: str):
        await self.broadcast_git_status()

    async def handle_git_stage(self, payload: dict, msg_id: str):
        stage_paths(self.project_root, payload.get("paths", []))
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_git_decorations()

    async def handle_git_unstage(self, payload: dict, msg_id: str):
        unstage_paths(self.project_root, payload.get("paths", []))
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_git_decorations()

    async def handle_git_stageAll(self, payload: dict, msg_id: str):
        git_stage_all(self.project_root)
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_git_decorations()

    async def handle_git_unstageAll(self, payload: dict, msg_id: str):
        git_unstage_all(self.project_root)
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_git_decorations()

    async def handle_git_restore(self, payload: dict, msg_id: str):
        restore_path(self.project_root, payload.get("path"), payload.get("commit", "HEAD"))
        mark_git_cache_dirty(self.project_root)
        await self.broadcast("git:restored", {"path": payload.get("path")})
        await self.broadcast_git_status()
        await self.broadcast_git_decorations()

    async def handle_git_commit(self, payload: dict, msg_id: str):
        commit_changes(self.project_root, payload.get("message"), payload.get("amend", False))
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_git_decorations()
        # After commit, HEAD has moved - notify clients to refresh their diff base display
        await self.broadcast("git:diffBaseSet", {"ref": "HEAD", "refresh": True})

    async def handle_git_push(self, payload: dict, msg_id: str):
        """Create a git_push job for progress tracking."""
        logger.info(f"[GIT_PUSH] Starting push job for {self.project_root}")
        try:
            from app.libs.jobs import manager as job_manager
            job = job_manager.create_job("git_push", {
                "repo_path": str(self.project_root),
                "remote": payload.get("remote", "origin"),
                "branch": payload.get("branch"),
                "force": payload.get("force", False),
            })
            logger.info(f"[GIT_PUSH] Created job {job.id}, tracking it")
            # Track this job so we forward its progress events
            self._tracked_job_ids.add(job.id)
            try:
                sidecar = ProjectSidecar.load_or_create(str(self.project_root))
                sidecar.add_tracked_job(job.id)
                sidecar.save()
            except Exception:
                pass
            # Acknowledge job creation - progress will come via job:progress events
            await self.emit_personal("git:pushStarted", {"job_id": job.id}, msg_id)
        except Exception as e:
            logger.exception(f"[GIT_PUSH] Failed to create job: {e}")
            await self.send_error(f"Failed to start push: {e}", msg_id)

    async def handle_git_pull(self, payload: dict, msg_id: str):
        """Create a git_pull job for progress tracking."""
        try:
            from app.libs.jobs import manager as job_manager
            job = job_manager.create_job("git_pull", {
                "repo_path": str(self.project_root),
                "remote": payload.get("remote", "origin"),
                "branch": payload.get("branch"),
                "rebase": payload.get("rebase", False),
            })
            # Track this job so we forward its progress events
            self._tracked_job_ids.add(job.id)
            try:
                sidecar = ProjectSidecar.load_or_create(str(self.project_root))
                sidecar.add_tracked_job(job.id)
                sidecar.save()
            except Exception:
                pass
            # Acknowledge job creation - progress will come via job:progress events
            await self.emit_personal("git:pullStarted", {"job_id": job.id}, msg_id)
        except Exception as e:
            await self.send_error(f"Failed to start pull: {e}", msg_id)

    async def handle_git_reset(self, payload: dict, msg_id: str):
        reset_hard(self.project_root, payload.get("commit", "HEAD"))
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_git_decorations()

    async def handle_git_init(self, payload: dict, msg_id: str):
        init_repository(self.project_root)
        await self.broadcast_git_status()

    async def handle_git_setDiffBase(self, payload: dict, msg_id: str):
        ref = payload.get("ref", "HEAD")
        # Validate and persist via HistoryStore (SSOT)
        get_commit_info(self.project_root, ref)  # Validate
        _history_store.set_diff_base(str(self.project_root), ref)
        # Inform all clients that the diff base ref changed; full payload
        # (including commit metadata) is fetched on demand via /git/diff_base
        await self.broadcast("git:diffBaseSet", {"ref": ref})
        # Changing base affects status calculation often
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()

    async def handle_git_listBranches(self, payload: dict, msg_id: str):
        res = git_list_branches(self.project_root)
        await self.emit_personal("git:branches", {"current": res.current, "branches": res.branches}, msg_id)

    async def handle_git_listCommits(self, payload: dict, msg_id: str):
        limit = payload.get("limit", 50)
        commits = git_get_commits(self.project_root, limit)
        data = [{"hash": c.hash, "short_hash": c.short_hash, "summary": c.summary} for c in commits]
        await self.emit_personal("git:commits", {"commits": data}, msg_id)

    # --- Project Operations ---

    async def handle_project_open(self, payload: dict, msg_id: str):
        path = payload.get("path")
        if not path:
            return await self.send_error("Path required", msg_id)
        
        # Switch project for this dispatcher
        # Note: This logic is tricky with the ConnectionManager if we switch projects.
        # We need to unregister from old project and register to new one.
        
        old_project = str(self.project_root)
        manager.disconnect(self.websocket)  # Disconnect from old

        new_root = set_project_root(path)
        # Persist active project + reset per-project session state
        await reset_project_session(str(new_root))
        self.project_root = new_root
        
        # Register to new
        manager.register_existing(self.websocket, str(new_root))
        
        await self.emit_personal("project:opened", {"path": str(new_root)}, msg_id)
        # Trigger full refresh for this client
        await self.handle_explorer_refresh({}, msg_id)

    async def handle_project_create(self, payload: dict, msg_id: str):
        res = create_project(payload.get("parent_path"), payload.get("name"))
        # Auto open
        await self.handle_project_open({"path": res["path"]}, msg_id)

    async def handle_project_list(self, payload: dict, msg_id: str):
        projects = _history_store.list_projects()
        await self.emit_personal("project:list", {"projects": projects}, msg_id)

    async def handle_git_clone(self, payload: dict, msg_id: str):
        """
        Clone a repository into a new directory.
        
        Flow:
        1. Create empty target directory
        2. Switch project root to that directory (watcher starts)
        3. Start clone job (clones into the now-current directory)
        4. Files appear live as checkout happens
        """
        url = payload.get("url")
        target_path = payload.get("target_path")
        
        if not url:
            return await self.send_error("URL is required", msg_id)
        if not target_path:
            return await self.send_error("target_path is required", msg_id)
        
        try:
            from pathlib import Path
            from app.libs.jobs import manager as job_manager
            
            # Expand ~ and resolve to absolute path
            target = Path(target_path).expanduser().resolve()
            logger.info(f"[GIT_CLONE] Target: {target}")
            
            # Step 1: Create the empty directory
            if target.exists():
                if any(target.iterdir()):
                    return await self.send_error(f"Directory '{target}' already exists and is not empty", msg_id)
                # Empty dir exists, that's fine
            else:
                target.mkdir(parents=True, exist_ok=True)
            
            # Step 2: Switch project root directly (without full project_open which emits)
            from .explorer_helper import set_project_root
            from .core_read import init_watcher
            
            manager.disconnect(self.websocket)  # Disconnect from old project
            
            new_root = set_project_root(str(target))
            init_watcher(new_root)  # Start watching the new directory
            # Persist active project + reset per-project session state
            await reset_project_session(str(new_root))
            self.project_root = new_root
            
            manager.register_existing(self.websocket, str(new_root))
            
            # Emit project opened so frontend knows
            await self.emit_personal("project:opened", {"path": str(new_root)}, None)
            
            # Step 3: Start the clone job
            job_params = {
                "url": url,
                "target_path": str(target),
                "branch": payload.get("branch"),
                "depth": payload.get("depth"),
            }
            
            job = job_manager.create_job("git_clone", job_params)
            
            # Track this job so we forward its progress events
            # NOTE: Race condition possible - job may emit before we track
            self._tracked_job_ids.add(job.id)
            try:
                sidecar = ProjectSidecar.load_or_create(str(self.project_root))
                sidecar.add_tracked_job(job.id)
                sidecar.save()
            except Exception:
                pass
            
            # Acknowledge job creation - progress will come via job:progress events
            await self.emit_personal("git:cloneStarted", {"job_id": job.id, "target_path": str(target)}, msg_id)
            
        except Exception as e:
            logger.exception(f"[GIT_CLONE] Failed to start clone: {e}")
            await self.send_error(f"Failed to start clone: {e}", msg_id)

    # --- Search & Review (State Events) ---

    async def handle_search_run(self, payload: dict, msg_id: str):
        mode = payload.get("mode", "name")
        query = payload.get("query", "")
        
        if mode == "name":
            res = await search.search_by_name(self.project_root, query)
        elif mode == "content":
            res = await search.search_by_content(self.project_root, query)
        elif mode == "changes":
            res = search.search_by_changes(self.project_root)
        else:
            return await self.send_error("Invalid search mode", msg_id)
            
        await self.emit_personal("search:setResults", res, msg_id)

    async def handle_review_list(self, payload: dict, msg_id: str):
        lightweight = payload.get("lightweight", False)
        res = await review.list_reviews(self.project_root, lightweight)
        # This might be personal or broadcast? Usually review list is personal viewing,
        # but the *state* of drafts is global.
        # We emitted "review:setEntries" in broadcast_review_state.
        # Let's match that.
        await self.emit_personal("review:setEntries", {"entries": res}, msg_id)

    async def handle_review_save(self, payload: dict, msg_id: str):
        files = payload.get("files", [])
        res = await review.save_reviews(self.project_root, files)
        # Save changes disk -> affects git status and draft state
        await self.emit_personal("review:saved", res, msg_id) # Ack to sender
        mark_git_cache_dirty(self.project_root)
        from .explorer_helper import mark_draft_cache_dirty
        mark_draft_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_review_state()

    async def handle_review_discard(self, payload: dict, msg_id: str):
        files = payload.get("files", [])
        res = await review.discard_reviews(self.project_root, files)
        await self.emit_personal("review:discarded", res, msg_id)
        from .explorer_helper import mark_draft_cache_dirty
        mark_draft_cache_dirty(self.project_root)
        await self.broadcast_review_state()

    async def handle_pulse_alive(self, payload: dict, msg_id: str):
        """Handle client heartbeat response (silently)."""
        pass


# --- WebSocket Endpoint ---

async def explorer_websocket(websocket: WebSocket):
    # Dispatcher init now handles accept/connect logic partially, but we need to accept first
    # to read cookies/headers if needed, or just let dispatcher do it.
    # The dispatcher needs an accepted socket.
    # The dispatcher.initialize() is async.
    
    # Wait, dispatcher.__init__ is sync.
    # We should accept here.
    dispatcher = ExplorerDispatcher(websocket)
    # Connect logic in initialize() calls accept(), so we should NOT accept twice or ensure order.
    # Actually manager.connect calls accept().
    # Let's clean this up: standard pattern is endpoint accepts, then registers.
    
    # Correction: manager.connect calls accept(). 
    # But dispatcher is created with websocket.
    
    await dispatcher.initialize()
    
    try:
        while True:
            data = await websocket.receive_text()
            await dispatcher.handle_message(data)
    except WebSocketDisconnect:
        await dispatcher.cleanup()
    except Exception as e:
        logger.error(f"Explorer WebSocket error: {e}")
        await dispatcher.cleanup()


# --- Socket.IO Namespace Adapter ---

import socketio


class ExplorerSocketIONamespace(socketio.AsyncNamespace):
    def __init__(self, namespace='/explorer'):
        super().__init__(namespace)
        self.dispatchers: Dict[str, ExplorerDispatcher] = {}

    async def on_connect(self, sid, environ):
        # Create dispatcher with Socket.IO shim
        ws = SocketIOSocketShim(self, sid)
        dispatcher = ExplorerDispatcher(ws)
        await dispatcher.initialize()
        self.dispatchers[sid] = dispatcher
        logger.info(f"[ExplorerSIO] client connected sid={sid}")

    async def on_disconnect(self, sid):
        disp = self.dispatchers.pop(sid, None)
        if disp:
            await disp.cleanup()
        logger.info(f"[ExplorerSIO] client disconnected sid={sid}")

    async def on_explorer_send(self, sid, data):
        disp = self.dispatchers.get(sid)
        if not disp:
            return
        logger.info(f"[ExplorerSIO] recv sid={sid} data={data}")
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = None
        if not isinstance(data, dict):
            return
        await disp.handle_message_json(data)
