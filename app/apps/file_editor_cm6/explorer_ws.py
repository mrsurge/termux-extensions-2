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
        if websocket in self.ws_project_map:
            del self.ws_project_map[websocket]
        logger.info(f"Client disconnected from project: {project_path}")

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

# --- Dispatcher ---

class ExplorerDispatcher:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.project_root = get_project_root()
        
    async def initialize(self):
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
        res = rename_entry(payload.get("rel"), payload.get("new_name"))
        await self.broadcast("explorer:renamed", res)
        # Refresh parent
        # We need parent path. Simple string split for now.
        parent = str(res['old_rel']).rsplit('/', 1)[0] if '/' in str(res['old_rel']) else '.'
        await self.broadcast("explorer:setList", list_dir(parent))

    async def handle_explorer_delete(self, payload: dict, msg_id: str):
        res = delete_entry(payload.get("rel"))
        await self.broadcast("explorer:deleted", res)
        # Client handles UI removal or we refresh parent.

    async def handle_explorer_batchDelete(self, payload: dict, msg_id: str):
        res = batch_delete(payload.get("rels", []))
        await self.broadcast("explorer:batchDeleted", res)

    async def handle_explorer_move(self, payload: dict, msg_id: str):
        res = move_entry(payload.get("rel"), payload.get("dest_path"))
        await self.broadcast("explorer:moved", res)

    async def handle_explorer_copy(self, payload: dict, msg_id: str):
        res = copy_entry(payload.get("rel"), payload.get("dest_path"))
        await self.broadcast("explorer:copied", res)

    async def handle_explorer_copyFrom(self, payload: dict, msg_id: str):
        res = copy_entry_inbound(payload.get("source_path"), payload.get("dest_rel"))
        await self.broadcast("explorer:copied", res)

    async def handle_explorer_moveFrom(self, payload: dict, msg_id: str):
        res = move_entry_inbound(payload.get("source_path"), payload.get("dest_rel"))
        await self.broadcast("explorer:moved", res)

    # --- Git Operations (Broadcasts Status) ---

    async def handle_git_status(self, payload: dict, msg_id: str):
        await self.broadcast_git_status()

    async def handle_git_stage(self, payload: dict, msg_id: str):
        stage_paths(self.project_root, payload.get("paths", []))
        await self.broadcast_git_status()

    async def handle_git_unstage(self, payload: dict, msg_id: str):
        unstage_paths(self.project_root, payload.get("paths", []))
        await self.broadcast_git_status()

    async def handle_git_stageAll(self, payload: dict, msg_id: str):
        git_stage_all(self.project_root)
        await self.broadcast_git_status()

    async def handle_git_unstageAll(self, payload: dict, msg_id: str):
        git_unstage_all(self.project_root)
        await self.broadcast_git_status()

    async def handle_git_restore(self, payload: dict, msg_id: str):
        restore_path(self.project_root, payload.get("path"), payload.get("commit", "HEAD"))
        await self.broadcast("git:restored", {"path": payload.get("path")})
        # Restore affects content and status
        await self.broadcast_git_status()

    async def handle_git_commit(self, payload: dict, msg_id: str):
        commit_changes(self.project_root, payload.get("message"), payload.get("amend", False))
        await self.broadcast_git_status()

    async def handle_git_push(self, payload: dict, msg_id: str):
        push_changes(self.project_root, payload.get("remote"), payload.get("branch"), payload.get("force", False))
        await self.broadcast_git_status()

    async def handle_git_pull(self, payload: dict, msg_id: str):
        pull_changes(self.project_root, payload.get("remote"), payload.get("branch"), payload.get("rebase", False))
        await self.broadcast_git_status()

    async def handle_git_reset(self, payload: dict, msg_id: str):
        reset_hard(self.project_root, payload.get("commit", "HEAD"))
        await self.broadcast_git_status()

    async def handle_git_init(self, payload: dict, msg_id: str):
        init_repository(self.project_root)
        await self.broadcast_git_status()

    async def handle_git_setDiffBase(self, payload: dict, msg_id: str):
        ref = payload.get("ref", "HEAD")
        get_commit_info(self.project_root, ref) # Validate
        _history_store.set_diff_base(str(self.project_root), ref)
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