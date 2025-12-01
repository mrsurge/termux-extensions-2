import asyncio
import json
import logging
from typing import Dict, Any, List, Optional
from fastapi import WebSocket, WebSocketDisconnect

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
from .stores import _history_store
from .explorer import search, review

# Logger setup
logger = logging.getLogger(__name__)

# --- Connection Manager ---

class ConnectionManager:
    def __init__(self):
        # Map: project_path -> List[WebSocket]
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Map: websocket -> project_path (for cleanup)
        self.ws_project_map: Dict[WebSocket, str] = {}

    async def accept_and_register(self, websocket: WebSocket, project_path: str):
        await websocket.accept()
        self.register_existing(websocket, project_path)

    def register_existing(self, websocket: WebSocket, project_path: str):
        if project_path not in self.active_connections:
            self.active_connections[project_path] = []
        self.active_connections[project_path].append(websocket)
        self.ws_project_map[websocket] = project_path
        logger.info(f"Client registered to project: {project_path}")

    def disconnect(self, websocket: WebSocket):
        project_path = self.ws_project_map.get(websocket)
        if project_path and project_path in self.active_connections:
            if websocket in self.active_connections[project_path]:
                self.active_connections[project_path].remove(websocket)
            if not self.active_connections[project_path]:
                del self.active_connections[project_path]
                # --- WATCHER LIFECYCLE (future implementation) ---
                # When last client disconnects from a project, we could stop the
                # file watcher to save resources:
                # from .core_read import stop_watcher
                # stop_watcher()
                # ------------------------------------------------
        if websocket in self.ws_project_map:
            del self.ws_project_map[websocket]
        logger.info(f"Client disconnected from project: {project_path}")
    
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
                
                # Debounce: cancel existing timer and set a new one
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
                    
            except Exception as e:
                logger.warning(f"Failed to notify explorer of change: {e}")
            break

async def _refresh_explorer_directory(project_path: str, rel_dir: str):
    """Broadcasts an explorer:setList for the given directory."""
    try:
        dir_listing = list_dir(rel_dir)
        msg = {"type": "explorer:setList", "payload": dir_listing}
        await manager.broadcast(project_path, msg)
    except Exception as e:
        logger.warning(f"Failed to refresh explorer directory {rel_dir}: {e}")

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
        
        # Send initial state snapshots
        # 1. Project Info
        await self.emit_personal("project:setActive", {"path": str(self.project_root)})
        # 2. Git Status
        await self.broadcast_git_status()
        # 3. Explorer Tree (Root)
        await self.emit_personal("explorer:setList", list_dir('.'))
        # 4. Review List (if any)
        await self.broadcast_review_state()

    async def cleanup(self):
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

    async def handle_git_push(self, payload: dict, msg_id: str):
        push_changes(self.project_root, payload.get("remote"), payload.get("branch"), payload.get("force", False))
        await self.broadcast_git_status()

    async def handle_git_pull(self, payload: dict, msg_id: str):
        pull_changes(self.project_root, payload.get("remote"), payload.get("branch"), payload.get("rebase", False))
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_git_decorations()

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
        manager.disconnect(self.websocket) # Disconnect from old
        
        new_root = set_project_root(path)
        _history_store.touch_project(str(new_root))
        _history_store.set_active_project(str(new_root))
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
        await self.broadcast_git_status()
        await self.broadcast_review_state()

    async def handle_review_discard(self, payload: dict, msg_id: str):
        files = payload.get("files", [])
        res = await review.discard_reviews(self.project_root, files)
        await self.emit_personal("review:discarded", res, msg_id)
        await self.broadcast_review_state()


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
