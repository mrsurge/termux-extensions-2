import asyncio
import json
import logging
import os
import subprocess
import urllib.request
from contextlib import suppress
from typing import Dict, Any, List, Optional
from fastapi import WebSocket, WebSocketDisconnect
from pathlib import Path

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
        self.lsp_status_task: Optional[asyncio.Task] = None
        self.diagnostics_task: Optional[asyncio.Task] = None
        self._last_lsp_status: Dict[str, dict] = {}
        self._last_diagnostics: Dict[str, dict] = {}

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
            self.start_lsp_status()
            self.start_diagnostics()
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
            self.stop_lsp_status()
            self.stop_diagnostics()
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

    def start_lsp_status(self):
        """Start LSP status broadcaster task (Socket.IO + WS clients)."""
        if self.lsp_status_task is None or self.lsp_status_task.done():
            loop = asyncio.get_event_loop()
            self.lsp_status_task = loop.create_task(self._lsp_status_loop())
            logger.info("[LSP_STATUS] Broadcaster started")

    def stop_lsp_status(self):
        """Stop the LSP status broadcaster task."""
        if self.lsp_status_task:
            self.lsp_status_task.cancel()
            self.lsp_status_task = None
            self._last_lsp_status = {}
            logger.info("[LSP_STATUS] Broadcaster stopped")

    def start_diagnostics(self):
        """Start diagnostics broadcaster task."""
        if self.diagnostics_task is None or self.diagnostics_task.done():
            loop = asyncio.get_event_loop()
            self.diagnostics_task = loop.create_task(self._diagnostics_loop())
            try:
                import sys

                print("[DIAGNOSTICS] Broadcaster started", file=sys.stderr, flush=True)
            except Exception:
                pass
        else:
            try:
                import sys

                print("[DIAGNOSTICS] Broadcaster already running", file=sys.stderr, flush=True)
            except Exception:
                pass

    def stop_diagnostics(self):
        """Stop the diagnostics broadcaster task."""
        if self.diagnostics_task:
            self.diagnostics_task.cancel()
            self.diagnostics_task = None
            self._last_diagnostics = {}
            logger.info("[DIAGNOSTICS] Broadcaster stopped")

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

    async def _lsp_status_loop(self):
        """Poll Framework Shells for LSP status and broadcast on change.

        This keeps the Language Servers modal "Start" buttons in sync without polling HTTP.
        """

        from framework_shells import get_manager

        server_groups = {
            "pyright": ["python"],
            "typescript": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
            "clangd": ["c", "cpp"],
            "kotlin": ["kotlin"],
            "kotlin-android": ["kotlin-android"],
        }

        try:
            while True:
                await asyncio.sleep(1.0)
                if not any(self.active_connections.values()):
                    break

                try:
                    mgr = await get_manager()
                except Exception:
                    continue
                try:
                    shells = await mgr.list_shells()
                except Exception:
                    shells = []

                running_labels: list[str] = []
                for rec in shells:
                    try:
                        if rec and rec.pid and rec.status == "running" and rec.label:
                            running_labels.append(rec.label)
                    except Exception:
                        continue

                def _is_running_label(language_id: str) -> bool:
                    prefix = f"lsp:{language_id}"
                    return any(lbl == prefix or lbl.startswith(prefix + ":") for lbl in running_labels)

                # Build a per-project status object. LSP shells are scoped per project root in Code CM6,
                # but the label naming is per-language; as a pragmatic approximation, we broadcast a
                # single status snapshot to each project that currently has connections.
                snapshot = {"servers": {}}
                for server_id, langs in server_groups.items():
                    running = False
                    for lang in langs:
                        if _is_running_label(lang):
                            running = True
                            break
                    snapshot["servers"][server_id] = {"running": running}

                # Broadcast to all connected projects, but only when the payload changes.
                for project_path in list(self.active_connections.keys()):
                    last = self._last_lsp_status.get(project_path)
                    if last == snapshot:
                        continue
                    self._last_lsp_status[project_path] = snapshot
                    await self.broadcast(project_path, {"type": "lsp:status", "payload": snapshot})
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"[LSP_STATUS] loop error: {e}")

    async def _diagnostics_loop(self):
        """Poll LSP diagnostics and broadcast summary to explorer clients.

        This provides explorer UI hints (red/yellow dots) for files with errors/warnings.
        """

        from .lsp_ws import get_diagnostics_summary_for_project

        try:
            while True:
                await asyncio.sleep(1.0)
                if not any(self.active_connections.values()):
                    break

                for project_path in list(self.active_connections.keys()):
                    try:
                        summary = get_diagnostics_summary_for_project(project_root=project_path)
                    except Exception as e:
                        try:
                            import sys

                            print(
                                f"[DIAGNOSTICS] summary compute failed project={project_path}: {e}",
                                file=sys.stderr,
                                flush=True,
                            )
                        except Exception:
                            pass
                        continue

                    # Only broadcast if changed
                    last = self._last_diagnostics.get(project_path)
                    if last == summary:
                        continue
                    self._last_diagnostics[project_path] = summary

                    try:
                        import sys

                        count = len(summary) if isinstance(summary, dict) else -1
                        conn_n = len(self.active_connections.get(project_path, []) or [])
                        print(
                            f"[DIAGNOSTICS] broadcast project={project_path} connections={conn_n} entries={count}",
                            file=sys.stderr,
                            flush=True,
                        )
                    except Exception:
                        pass

                    await self.broadcast(
                        project_path,
                        {"type": "explorer:updateDiagnostics", "payload": {"diagnostics": summary}},
                    )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"[DIAGNOSTICS] loop error: {e}")
    
    def get_connection_count(self, project_path: str) -> int:
        """Returns the number of active connections for a project."""
        return len(self.active_connections.get(project_path, []))
    
    def has_connections(self, project_path: str) -> bool:
        """Returns True if there are any active connections for a project."""
        return self.get_connection_count(project_path) > 0

    async def broadcast(self, project_path: str, message: Dict[str, Any]):
        """Send message to all clients connected to a specific project."""
        if _is_worker_process() and not self.has_connections(project_path):
            _schedule_forward_broadcast(project_path, message)
            return
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


async def reset_project_session(new_project_path: str) -> bool:
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

    # Ensure sidecar exists for the project (lazy create) and report whether it was new.
    was_new_sidecar = not ProjectSidecar.sidecar_exists(normalized_path)
    sidecar = ProjectSidecar.load_or_create(normalized_path)
    sidecar.get_or_create_lsp_project_id()
    removed_clean = sidecar.prune_clean_drafts()
    # NOTE: We intentionally do NOT clear session_cache or tracked_jobs here.
    # Drafts and jobs persist across project switches.
    sidecar.save()
    if removed_clean:
        try:
            from .explorer_helper import mark_draft_cache_dirty
            mark_draft_cache_dirty(Path(normalized_path))
        except Exception:
            pass
        try:
            notify_draft_state_changed(normalized_path)
        except Exception:
            pass

    # Force any live terminal drawers to reconnect so they bind to the
    # new active project's shell. Frontend stays project-agnostic.
    try:
        from .terminal_backend import close_active_terminal_sockets
        await close_active_terminal_sockets()
    except Exception:
        pass

    return was_new_sidecar

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
                        loop = _explorer_event_loop
                        if not loop:
                            return
                        asyncio.run_coroutine_threadsafe(
                            _refresh_explorer_directory(project_path, parent_rel),
                            loop
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
            loop = _explorer_event_loop
            if not loop:
                return
            asyncio.run_coroutine_threadsafe(
                _broadcast_git_status_update(project_path),
                loop
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
        statuses = await asyncio.to_thread(get_all_git_statuses)
        msg = {"type": "explorer:updateGitStatus", "payload": {"statuses": statuses}}
        await manager.broadcast(project_path, msg)
        
        # 2. Broadcast summary bar (git:status)
        status = await asyncio.to_thread(git_get_status, Path(project_path))
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
        dir_listing = await asyncio.to_thread(list_dir, rel_dir)
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
        # Fast path: use disk-backed DraftIndexSidecar (avoid parsing ProjectSidecar.session_cache content).
        from .draft_index_sidecar import DraftIndexSidecar

        def _load_snapshot() -> set[str]:
            try:
                idx = DraftIndexSidecar.load_or_create(str(Path(project_path).resolve()))
                idx.reload()
                files, _dirs = idx.snapshot()
                return files
            except Exception:
                return set()

        draft_files = await asyncio.to_thread(_load_snapshot)
        draft_decorations = {rel: {"hasDraft": True} for rel in draft_files}
        msg = {"type": "explorer:updateDecorations", "payload": {"drafts": draft_decorations}}
        await manager.broadcast(normalized_path, msg)
    except Exception as e:
        logger.warning(f"Failed to broadcast draft decorations: {e}")


def _is_worker_process() -> bool:
    return bool(os.getenv("TE_APP_ID") or os.getenv("TE_APP_WORKER_PORT"))


def _framework_url() -> str:
    return os.environ.get("TE_FRAMEWORK_URL", "http://127.0.0.1:8089").rstrip("/")


def _forward_draft_notification(project_path: str) -> None:
    url = f"{_framework_url()}/api/apps/file_editor_cm6/explorer/notify_drafts"
    payload = {"project": project_path}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            resp.read()
    except Exception as exc:
        logger.debug(f"Failed to forward draft notify to main: {exc}")


def _schedule_forward_draft_refresh(project_path: str) -> None:
    debounce_key = f"drafts-forward:{project_path}"
    with _explorer_refresh_lock:
        existing_timer = _explorer_refresh_timers.get(debounce_key)
        if existing_timer:
            existing_timer.cancel()

        def do_forward():
            with _explorer_refresh_lock:
                _explorer_refresh_timers.pop(debounce_key, None)
            _forward_draft_notification(project_path)

        timer = Timer(0.5, do_forward)
        _explorer_refresh_timers[debounce_key] = timer
        timer.start()


def _forward_explorer_broadcast(project_path: str, message: Dict[str, Any]) -> None:
    url = f"{_framework_url()}/api/apps/file_editor_cm6/explorer/broadcast"
    payload = {"project": project_path, "message": message}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            resp.read()
    except Exception as exc:
        logger.debug(f"Failed to forward explorer broadcast to main: {exc}")


def _schedule_forward_broadcast(project_path: str, message: Dict[str, Any]) -> None:
    # Avoid flooding the main server with redundant pulses.
    if message.get("type") == "pulse":
        return
    Timer(0, lambda: _forward_explorer_broadcast(project_path, message)).start()


def notify_draft_state_changed(project_path: str):
    """
    Called when draft state changes (file edited, saved, or discarded).
    Schedules a broadcast of updated draft decorations to all explorer clients.
    Debounced to avoid flooding during rapid edits.
    """
    from .explorer_helper import mark_draft_cache_dirty
    from pathlib import Path
    
    # Normalize to absolute path to match how connections are registered
    normalized_path = str(Path(project_path).resolve())
    
    if _is_worker_process() and not manager.has_connections(normalized_path):
        _schedule_forward_draft_refresh(normalized_path)
        return

    if not _explorer_event_loop:
        return

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

        # On full framework restart, explorer_helper defaults to ~ until
        # we rehydrate from HistoryStore. Do that before sending snapshots.
        try:
            active_project = _history_store.get_active_project()
            if isinstance(active_project, str) and active_project.strip():
                self.project_root = set_project_root(active_project)
        except Exception:
            pass
        
        # --- WATCHER LIFECYCLE (future implementation) ---
        # When first client connects, we could start the file watcher:
        # if not manager.has_connections(str(self.project_root)):
        #     from .core_read import init_watcher
        #     init_watcher(self.project_root)
        # ------------------------------------------------
        
        was_new_sidecar = not ProjectSidecar.sidecar_exists(str(self.project_root))

        # Register connection with current project
        await manager.accept_and_register(self.websocket, str(self.project_root))
        
        # --- Job Registry Listener ---
        # Subscribe to job updates and forward relevant ones to this client
        try:
            from app.libs.jobs import manager as job_manager
            # Seed job tracking from the project sidecar (jobs started in previous client sessions).
            try:
                sidecar = ProjectSidecar.load_or_create(str(self.project_root))
                self._tracked_job_ids.update(sidecar.list_tracked_jobs())
            except Exception:
                pass
            self._job_queue = Queue()
            self._job_listener = job_manager.add_listener(self._job_queue, job_ids=None)
            self._job_pump_task = asyncio.create_task(self._pump_job_events())
        except Exception as e:
            logger.warning(f"Failed to register job listener: {e}")
        
        # Send initial state snapshots
        # 1. Project Info
        await self.emit_personal("project:setActive", {"path": str(self.project_root), "new_sidecar": was_new_sidecar})
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
        await self.emit_personal("explorer:setList", await asyncio.to_thread(list_dir, '.'))
        # 4. Review List (if any)
        await self.broadcast_review_state()
        # 5. Open Directories (for restoring tree state)
        try:
            sidecar = ProjectSidecar.load_or_create(str(self.project_root))
            open_dirs = sidecar.get_open_directories()
            await self.emit_personal("explorer:setOpenDirs", {"dirs": open_dirs})
        except Exception as e:
            logger.warning(f"Failed to load open directories: {e}")

        # 6. Active file — NOT set here. The worker process (editor_ws.py) is the
        #    authority for which file is open. It broadcasts explorer:activeFile
        #    via the explorer forward-broadcast endpoint on editor connect.
    
    async def _pump_job_events(self):
        """Background task to forward job updates to this client."""
        logger.debug("[JOB_PUMP] Started job pump task")
        while True:
            try:
                # Non-blocking check with short timeout
                payload = await asyncio.to_thread(self._job_queue.get, timeout=0.5)
                if not isinstance(payload, dict):
                    continue
                
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
                        # Unrelated job updates are expected because the job registry is global.
                        # Only log when the job looks like one we should be tracking (sidecar / session mismatch).
                        if job_id and isinstance(job_id, str):
                            try:
                                sidecar = ProjectSidecar.load_or_create(str(self.project_root))
                                tracked = set(sidecar.list_tracked_jobs())
                            except Exception:
                                tracked = set()

                            if job_id in tracked:
                                # Track it now (e.g. app restarted between job creation and listener init).
                                self._tracked_job_ids.add(job_id)
                                await self.emit_personal("job:progress", job_data)
                            else:
                                logger.debug(f"[JOB_PUMP] Ignoring untracked job {job_id} ({job_type})")
                        
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
            status = await asyncio.to_thread(git_get_status, self.project_root)
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
            statuses = await asyncio.to_thread(get_all_git_statuses)
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
            data = await asyncio.to_thread(list_dir, rel)
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
        data = await asyncio.to_thread(list_dir, '.')
        await self.broadcast("explorer:setList", data)

    async def handle_explorer_getDiagnostics(self, payload: dict, msg_id: str):
        """Return a point-in-time diagnostics summary snapshot.

        This is used by the explorer frontend to proactively fetch the current
        diagnostics state after it installs its dispatch hook, preventing races
        where the periodic broadcast arrives before the UI is ready.
        """

        try:
            from .lsp_ws import get_diagnostics_summary_for_project

            summary = get_diagnostics_summary_for_project(project_root=str(self.project_root))
        except Exception:
            summary = {}

        await self.emit_personal(
            "explorer:updateDiagnostics",
            {"diagnostics": summary},
            msg_id,
        )

    async def handle_cm6_mirror(self, payload: dict, msg_id: str):
        """Relay live CM6 buffer mirroring payloads to connected clients."""
        if not isinstance(payload, dict):
            return await self.send_error("Invalid payload", msg_id)

        path = payload.get("path")
        content = payload.get("content")
        if not isinstance(path, str) or not path:
            return await self.send_error("Missing path", msg_id)
        if not isinstance(content, str):
            return await self.send_error("Missing content", msg_id)

        # Broadcast to all clients; receivers self-filter via source_client.
        await self.broadcast("cm6:mirror", payload)

        if msg_id:
            await self.emit_personal("cm6:mirror:ack", {"ok": True}, msg_id)

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

    async def handle_lsp_status(self, payload: dict, msg_id: str):
        """Return a point-in-time LSP status snapshot (via Framework Shells labels).

        The Language Servers modal calls this when opened so buttons reflect the real
        running state immediately, without relying on periodic broadcasts.
        """

        from framework_shells import get_manager

        server_groups = {
            "pyright": ["python"],
            "typescript": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
            "clangd": ["c", "cpp"],
            "kotlin": ["kotlin"],
            "kotlin-android": ["kotlin-android"],
        }

        try:
            mgr = await get_manager()
        except Exception as e:
            return await self.send_error(f"Failed to query shell manager: {e}", msg_id)

        try:
            shells = await mgr.list_shells()
        except Exception:
            shells = []

        running_labels: list[str] = []
        for rec in shells:
            try:
                if rec and rec.pid and rec.status == "running" and rec.label:
                    running_labels.append(rec.label)
            except Exception:
                continue

        def _is_running_label(language_id: str) -> bool:
            prefix = f"lsp:{language_id}"
            return any(lbl == prefix or lbl.startswith(prefix + ":") for lbl in running_labels)

        snapshot = {"servers": {}}
        for server_id, langs in server_groups.items():
            running = False
            for lang in langs:
                if _is_running_label(lang):
                    running = True
                    break
            snapshot["servers"][server_id] = {"running": running}

        # Prime last snapshot for this project so background broadcasts won't lag.
        try:
            manager._last_lsp_status[str(self.project_root)] = snapshot
        except Exception:
            pass

        await self.emit_personal("lsp:status", snapshot, msg_id)

    async def handle_watcher_raiseLimit(self, payload: dict, msg_id: str):
        limit = payload.get("limit", 524288)
        password = payload.get("password", "")
        try:
            limit_int = int(limit)
        except Exception:
            limit_int = 524288

        cmd = ["sudo", "-S", "sysctl", "-w", f"fs.inotify.max_user_watches={limit_int}"]

        def _run():
            return subprocess.run(
                cmd,
                input=(password + "\n") if isinstance(password, str) else "\n",
                text=True,
                capture_output=True,
                timeout=15,
            )

        try:
            result = await asyncio.to_thread(_run)
            ok = result.returncode == 0
            out_payload = {
                "ok": ok,
                "code": result.returncode,
                "stdout": (result.stdout or "").strip(),
                "stderr": (result.stderr or "").strip(),
            }
        except Exception as e:
            out_payload = {
                "ok": False,
                "code": -1,
                "stdout": "",
                "stderr": str(e),
            }

        await self.emit_personal("watcher:raiseResult", out_payload, msg_id)

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
        parent_list = await asyncio.to_thread(list_dir, payload.get("parent_rel", "."))
        await self.broadcast("explorer:setList", parent_list)

    async def handle_explorer_createDir(self, payload: dict, msg_id: str):
        res = create_directory(payload.get("parent_rel", "."), payload.get("name"))
        await self.broadcast("explorer:created", res)
        parent_list = await asyncio.to_thread(list_dir, payload.get("parent_rel", "."))
        await self.broadcast("explorer:setList", parent_list)

    async def handle_explorer_rename(self, payload: dict, msg_id: str):
        rel = payload.get("rel")
        parent_rel = _get_parent_rel(rel)
        res = rename_entry(rel, payload.get("new_name"))
        await self.broadcast("explorer:renamed", res)
        # Refresh parent directory
        await self.broadcast("explorer:setList", await asyncio.to_thread(list_dir, parent_rel))

    async def handle_explorer_delete(self, payload: dict, msg_id: str):
        rel = payload.get("rel")
        parent_rel = _get_parent_rel(rel)
        res = delete_entry(rel)
        await self.broadcast("explorer:deleted", res)
        # Refresh the parent directory to reflect deletion
        await self.broadcast("explorer:setList", await asyncio.to_thread(list_dir, parent_rel))
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
                await self.broadcast("explorer:setList", await asyncio.to_thread(list_dir, parent_rel))
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
            await self.broadcast("explorer:setList", await asyncio.to_thread(list_dir, dest_rel))
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
                await self.broadcast("explorer:setList", await asyncio.to_thread(list_dir, parent_rel))
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
                await self.broadcast("explorer:setList", await asyncio.to_thread(list_dir, parent_rel))
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
            await self.broadcast("explorer:setList", await asyncio.to_thread(list_dir, dest_rel))
        except Exception:
            pass

    async def handle_explorer_copyFrom(self, payload: dict, msg_id: str):
        dest_rel = payload.get("dest_rel")
        res = copy_entry_inbound(payload.get("source_path"), dest_rel)
        await self.broadcast("explorer:copied", res)
        # Refresh destination directory
        try:
            await self.broadcast("explorer:setList", await asyncio.to_thread(list_dir, dest_rel))
        except Exception:
            pass

    async def handle_explorer_moveFrom(self, payload: dict, msg_id: str):
        dest_rel = payload.get("dest_rel")
        res = move_entry_inbound(payload.get("source_path"), dest_rel)
        await self.broadcast("explorer:moved", res)
        # Refresh destination directory
        try:
            await self.broadcast("explorer:setList", await asyncio.to_thread(list_dir, dest_rel))
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
        was_new_sidecar = await reset_project_session(str(new_root))
        self.project_root = new_root
        
        # Register to new
        manager.register_existing(self.websocket, str(new_root))
        
        await self.emit_personal("project:opened", {"path": str(new_root), "new_sidecar": was_new_sidecar}, msg_id)
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
            was_new_sidecar = await reset_project_session(str(new_root))
            self.project_root = new_root
            
            manager.register_existing(self.websocket, str(new_root))
            
            # Emit project opened so frontend knows
            await self.emit_personal("project:opened", {"path": str(new_root), "new_sidecar": was_new_sidecar}, None)
            
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
