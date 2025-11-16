
# /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/main.py

import sys
from pathlib import Path

# CRITICAL: Setup vendor path BEFORE any imports that might use nicegui
vendor_dir = Path(__file__).parent.parent.parent / 'static' / 'vendor'
sys.path.insert(0, str(vendor_dir))

import os
import json
from pathlib import Path
from fastapi import APIRouter, Request, HTTPException, WebSocket, Body, Query
from fastapi.responses import JSONResponse, FileResponse
import asyncio
import anyio
from .agent_ws import agent_websocket
from .history_store import HistoryStore
from .preferences_store import PreferencesStore
from .explorer_helper import get_project_root, set_project_root, mark_git_cache_dirty, list_dir, _normalize_rel_path
from .git_helper import (
    GitError,
    list_branches as git_list_branches,
    checkout_branch as git_checkout_branch,
    create_branch as git_create_branch_helper,
    get_status as git_get_status,
    stage_all as git_stage_all,
    unstage_all as git_unstage_all,
    commit_changes as git_commit_changes,
    push_changes as git_push_changes,
    pull_changes as git_pull_changes,
    stage_paths,
    unstage_paths,
)
from . import edit_tracker
from .diff_helper import invalidate_diff_cache, collect_diff
from .core_read import init_watcher, push_save_ack, emit_diff_changed, subscribe, unsubscribe
from .core_write import write_full, BaseMismatchError, _get_file_meta

file_editor_cm6_bp = APIRouter()
# sock = Sock()

# # Register terminal routes and WebSocket handler
# register_terminal_routes(file_editor_cm6_bp, sock)

# # Register agent routes and WebSocket handler
from .agent_routes import bp as agent_routes_bp
file_editor_cm6_bp.include_router(agent_routes_bp)

# Serve static files (JS, CSS, etc.)
@file_editor_cm6_bp.get("/static/{file_path:path}")
async def serve_static(file_path: str):
    """Serve static files from the app's static directory"""
    static_dir = Path(__file__).parent / "static"
    file = static_dir / file_path
    if not file.exists() or not file.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file)

# Register terminal routes
from .terminal_backend import terminal_router
file_editor_cm6_bp.include_router(terminal_router)
file_editor_cm6_bp.add_api_websocket_route("/ws/agent", agent_websocket)

# Include the self-contained editor routes
from .nicegui_editor.editor_app import editor_router
file_editor_cm6_bp.include_router(editor_router)

# Mount NiceGUI editor as sub-application (picked up by app_worker.py)
# NiceGUI requires ui.run_with() for proper initialization when embedding
from nicegui import ui

# Configure and initialize NiceGUI with the FastAPI app
# This will be called after the FastAPI app is created in app_worker.py
def init_nicegui_with_app(fastapi_app):
    """Initialize NiceGUI by attaching it to the existing FastAPI app"""
    mount = '/ui'
    
    # Critical: Set Socket.IO path BEFORE calling ui.run_with()
    # This ensures the client connects to /ui/_nicegui_ws/socket.io
    # which matches our main server's dynamic WS proxy route
    import nicegui.nicegui as ng
    # Engine.IO path must be a pure path (no query string)
    # Routing to the correct worker is handled by the main server proxy.
    # Use NiceGUI's default engine.io path; NiceGUI mounts its Socket.IO app
    # internally at '/_nicegui_ws/', so externally this resolves to
    # f"{mount}/_nicegui_ws/socket.io" which matches the client's URL.
    ng.sio_app.engineio_path = '/socket.io'
    
    ui.run_with(
        fastapi_app,
        mount_path=mount,
        storage_secret='file-editor-cm6-secret',  # For session management
    )
    
    # Now import the page definitions
    from app.apps.file_editor_cm6.nicegui_editor import editor_app

# Don't expose SUBAPPS - ui.run_with() handles the mounting
# Just expose the init hook for app_worker.py to call
NICEGUI_INIT_HOOK = init_nicegui_with_app

# Import singleton store instances
from .stores import _history_store, _preferences_store

def _ensure_project_root_synced() -> Path:
    """Ensure the in-memory project root matches the persisted active project."""
    stored = _history_store.get_active_project()
    if stored:
        stored_path = Path(stored)
        if stored_path.is_dir():
            current = get_project_root()
            try:
                if stored_path.resolve() != current.resolve():
                    new_root = set_project_root(stored)
                    invalidate_diff_cache(new_root)
                    return new_root
            except Exception:
                pass
            return stored_path
    return get_project_root()

# Sync the initial project root on module import.
try:
    project_root = _ensure_project_root_synced()
    edit_tracker.set_project_root(project_root)
except Exception:
    pass

def _get_active_project_root() -> Path:
    project_path = _history_store.get_active_project()
    if not project_path:
        raise GitError('No project selected')
    project = Path(project_path)
    if not project.exists():
        raise GitError(f'Project "{project_path}" not found')
    set_project_root(project_path)
    return project


def _status_to_payload(status) -> dict:
    return {
        "branch": status.branch,
        "detached": status.detached,
        "ahead": status.ahead,
        "behind": status.behind,
        "staged": status.staged,
        "unstaged": status.unstaged,
        "untracked": status.untracked,
    }

def _get_runtime_metadata() -> dict:
    """Collect runtime metadata for crash detection."""
    import os
    return {
        "run_id": os.getenv("TE_RUN_ID", "unknown"),
        "shell_id": os.getenv("TE_FRAMEWORK_SHELL_ID", "unknown"),
        "shell_run_id": os.getenv("TE_FRAMEWORK_SHELL_RUN_ID", "unknown"),
        "launcher_pid": int(os.getenv("TE_LAUNCHER_PID", "0")),
        "worker_pid": os.getpid(),
    }

def _build_state_payload() -> dict:
    project_path = _history_store.get_active_project()
    project_exists = bool(project_path and Path(project_path).is_dir())
    project_label = HistoryStore.format_label(project_path)
    project_message = ""
    if not project_path:
        project_message = "No project selected."
    elif not project_exists:
        project_message = f'Project "{project_label or project_path}" not found.'
    else:
        # Make sure runtime root matches
        try:
            set_project_root(project_path)
        except Exception:
            project_exists = False
            project_message = f'Project "{project_label or project_path}" not accessible.'

    last_file = _history_store.get_last_file(project_path)
    last_file_exists = bool(last_file and Path(last_file).is_file())
    last_file_label = HistoryStore.format_label(last_file)
    last_file_message = ""
    if last_file and not last_file_exists:
        last_file_message = f'File "{last_file_label or last_file}" not found.'

    recents_raw = _history_store.list_files(project_path) if project_path else []
    recents = []
    for entry in recents_raw:
        entry_path = entry.get("path")
        exists = bool(entry_path and Path(entry_path).is_file())
        recents.append({
            "path": entry_path,
            "label": entry.get("label") or HistoryStore.format_label(entry_path),
            "opened_at": entry.get("opened_at"),
            "exists": exists,
        })

    editor_prefs = _preferences_store.get_preferences(project_path)
    runtime_meta = _get_runtime_metadata()

    return {
        "activeProject": project_path,
        "activeProjectLabel": project_label,
        "activeProjectExists": project_exists,
        "activeProjectMessage": project_message,
        "lastFile": last_file,
        "lastFileLabel": last_file_label,
        "lastFileExists": last_file_exists,
        "lastFileMessage": last_file_message,
        "recents": recents,
        "preferences": editor_prefs,
        "runtime": runtime_meta,
    }

def _expand_and_validate_path(path):
    base_home = os.path.expanduser('~')
    expanded = os.path.normpath(os.path.expanduser(path))
    if not os.path.abspath(expanded).startswith(base_home):
        return None, 'Access denied'
    return expanded, None

@file_editor_cm6_bp.get('/')
def status_root():
    return {"ok": True, "data": {"message": "File Editor CM6 app API ready"}}

@file_editor_cm6_bp.get('/status')
def status():
    return {"ok": True, "data": {"message": "File Editor CM6 app API ready"}}


@file_editor_cm6_bp.get('/session_cache')
def get_session_cache(
    project: str = Query(...),
    path: str = Query(...),
):
    """Retrieve cached session for a document."""
    expanded_project, err = _expand_and_validate_path(project)
    if err:
        raise HTTPException(status_code=403, detail=err)
    
    expanded_path, err = _expand_and_validate_path(path)
    if err:
        raise HTTPException(status_code=403, detail=err)
    
    cached = _history_store.get_cached_document(expanded_project, expanded_path)
    
    if not cached:
        return {"ok": True, "data": None}
    
    # Determine state: crashed vs mid-session
    runtime_meta = _get_runtime_metadata()
    current_run_id = runtime_meta["run_id"]
    cached_run_id = cached.get("run_id", "unknown")
    
    state = "mid_session" if current_run_id == cached_run_id else "crashed"
    
    return {
        "ok": True,
        "data": {
            "state": state,
            "content": cached["content"],
            "content_sha256": cached["content_sha256"],
            "base_sha256": cached["base_sha256"],
            "unsaved": cached["unsaved"],
            "run_id": cached_run_id,
            "updated_at": cached["updated_at"],
            "current_run_id": current_run_id,
        }
    }


@file_editor_cm6_bp.delete('/session_cache')
def delete_session_cache(
    project: str = Query(...),
    path: str = Query(...),
):
    """Discard cached session for a document."""
    expanded_project, err = _expand_and_validate_path(project)
    if err:
        raise HTTPException(status_code=403, detail=err)
    
    expanded_path, err = _expand_and_validate_path(path)
    if err:
        raise HTTPException(status_code=403, detail=err)
    
    existed = _history_store.clear_cached_document(expanded_project, expanded_path)
    
    return {
        "ok": True,
        "data": {
            "cleared": existed
        }
    }


@file_editor_cm6_bp.get('/read')
def read_file(path: str = Query(...)):
    expanded, err = _expand_and_validate_path(path)
    if err:
        raise HTTPException(status_code=403, detail=err)
    if not os.path.isfile(expanded):
        raise HTTPException(status_code=404, detail='File not found')
    try:
        with open(expanded, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        meta = _get_file_meta(Path(expanded))
        return {"ok": True, "data": {"path": expanded, "content": content, "sha256": meta.get("sha256")}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.post('/write')
async def write_file_route(data: dict = Body(...)):
    path = data.get('path')
    content = data.get('content')
    client_id = data.get('client_id', 'unknown')
    op_id = data.get('op_id', '')
    base_sha256 = None

    if not path:
        raise HTTPException(status_code=400, detail="Path is required")

    if data.get('base') and isinstance(data['base'], dict):
        base_sha256 = data['base'].get('sha256')

    project_root = get_project_root()
    try:
        rel_path = _normalize_rel_path(project_root, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    try:
        # Initialize watcher if not already running
        init_watcher(project_root)

        # Perform atomic write with optional conflict check
        file_meta = await anyio.to_thread.run_sync(
            lambda: write_full(project_root, str(rel_path), content, base_sha256=base_sha256)
        )
        
        # NEW: Purge cache entry on successful save
        project_path = _history_store.get_active_project()
        if project_path:
            _history_store.clear_cached_document(project_path, path)

        # Send save acknowledgement to prevent self-echo
        push_save_ack(str(rel_path), op_id, client_id, file_meta)

        # Notify diff subscribers of change
        emit_diff_changed(str(rel_path), file_meta["sha256"])

        # Refresh caches so explorer + diff stay accurate
        mark_git_cache_dirty(project_root)
        invalidate_diff_cache(project_root, str(rel_path))

        return {
            "ok": True,
            "data": {
                "mtime": file_meta["mtime"],
                "size": file_meta["size"],
                "sha256": file_meta["sha256"]
            }
        }
    except BaseMismatchError as e:
        return JSONResponse(status_code=409, content={
            "ok": False,
            "error": "BASE_MISMATCH",
            "data": {
                "current": e.current_meta
            }
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

import asyncio

@file_editor_cm6_bp.websocket('/ws/read')
async def ws_read(websocket: WebSocket):
    """WebSocket endpoint for file change notifications."""
    await websocket.accept()
    path = websocket.query_params.get('path')
    client_id = websocket.query_params.get('client_id', 'unknown')

    if not path:
        await websocket.close(reason='Missing path parameter')
        return

    project_root = get_project_root()
    try:
        rel_path = _normalize_rel_path(project_root, path)
    except ValueError:
        await websocket.close(reason='Path outside project root')
        return

    # Initialize watcher if not already running
    init_watcher(project_root)

    # Subscribe to file changes
    event_queue = asyncio.Queue()
    token = subscribe(str(rel_path), client_id, lambda event: event_queue.put_nowait(event))

    async def forward_events():
        while True:
            try:
                event = await event_queue.get()
                await websocket.send_text(json.dumps(event))
            except asyncio.CancelledError:
                break
            except Exception:
                break

    forward_task = asyncio.create_task(forward_events())

    try:
        # Keep connection alive and ignore incoming messages
        async for msg in websocket.iter_text():
            pass
    finally:
        forward_task.cancel()
        unsubscribe(token)

@file_editor_cm6_bp.post('/project/open')
async def project_open(data: dict = Body(...)):
    """Open a project directory."""
    path = (data.get('path') or '').strip()

    try:
        abs_path = set_project_root(path)  # validates and sets global project root
        _history_store.touch_project(str(abs_path))
        _history_store.set_active_project(str(abs_path))
        invalidate_diff_cache(abs_path)
        edit_tracker.set_project_root(abs_path)
        state = _build_state_payload()
        return {"ok": True, "data": {"path": str(abs_path), "state": state}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.get('/project/current')
def project_current():
    """Get the current project root."""
    root = _history_store.get_active_project() or str(get_project_root())
    return {"ok": True, "data": {"path": str(root)}}

@file_editor_cm6_bp.get('/git/branches')
def git_branches():
    try:
        project_root = _get_active_project_root()
        info = git_list_branches(project_root)
        return {"ok": True, "data": {"current": info.current, "branches": info.branches}}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/checkout')
async def git_checkout_route(data: dict = Body(...)):
    name = (data.get('name') or '').strip()
    if not name:
        raise HTTPException(status_code=400, detail="Branch name required")
    try:
        project_root = _get_active_project_root()
        info = git_checkout_branch(project_root, name)
        return {"ok": True, "data": {"current": info.current, "branches": info.branches}}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/branch')
async def git_create_branch_route(data: dict = Body(...)):
    name = (data.get('name') or '').strip()
    if not name:
        raise HTTPException(status_code=400, detail="Branch name required")
    try:
        project_root = _get_active_project_root()
        info = git_create_branch_helper(project_root, name)
        return {"ok": True, "data": {"current": info.current, "branches": info.branches}}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.get('/git/status')
def git_status_route():
    try:
        project_root = _get_active_project_root()
        status = git_get_status(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/stage_all')
def git_stage_all_route():
    try:
        project_root = _get_active_project_root()
        status = git_stage_all(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/unstage_all')
def git_unstage_all_route():
    try:
        project_root = _get_active_project_root()
        status = git_unstage_all(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/commit')
async def git_commit_route(data: dict = Body(...)):
    message = (data.get('message') or '').strip()
    amend = bool(data.get('amend'))
    if not message:
        raise HTTPException(status_code=400, detail="Commit message required")
    try:
        project_root = _get_active_project_root()
        status = git_commit_changes(project_root, message, amend=amend)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/push')
async def git_push_route(data: dict = Body(...)):
    remote = (data.get('remote') or '').strip() or None
    branch = (data.get('branch') or '').strip() or None
    force = bool(data.get('force'))
    try:
        project_root = _get_active_project_root()
        status = git_push_changes(project_root, remote=remote, branch=branch, force=force)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@file_editor_cm6_bp.post('/git/pull')
async def git_pull_route(data: dict = Body(...)):
    remote = (data.get('remote') or '').strip() or None
    branch = (data.get('branch') or '').strip() or None
    rebase = bool(data.get('rebase'))
    try:
        project_root = _get_active_project_root()
        status = git_pull_changes(project_root, remote=remote, branch=branch, rebase=rebase)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.post('/git/stage')
async def git_stage_route(data: dict = Body(...)):
    paths = data.get('paths', [])
    if not paths:
        raise HTTPException(status_code=400, detail="Paths required")
    try:
        project_root = _get_active_project_root()
        status = stage_paths(project_root, paths)
        mark_git_cache_dirty(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.post('/git/unstage')
async def git_unstage_route(data: dict = Body(...)):
    paths = data.get('paths', [])
    if not paths:
        raise HTTPException(status_code=400, detail="Paths required")
    try:
        project_root = _get_active_project_root()
        status = unstage_paths(project_root, paths)
        mark_git_cache_dirty(project_root)
        return {"ok": True, "data": _status_to_payload(status)}
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.get('/state')
def get_project_state():
    """Return consolidated editor state."""
    state = _build_state_payload()
    return {"ok": True, "data": state}

@file_editor_cm6_bp.get('/session_state')
def get_session_state():
    """Return last-known editor session telemetry."""
    state = _history_store.get_session_state()
    return {"ok": True, "data": state}

@file_editor_cm6_bp.post('/session_state')
def update_session_state(payload: dict = Body(...)):
    """Persist lightweight session telemetry for crash/reconnect recovery."""
    state = _history_store.update_session_state(payload or {})
    return {"ok": True, "data": state}


@file_editor_cm6_bp.get('/preferences')
def get_preferences():
    """Return persisted editor/UI preferences."""
    project_path = _history_store.get_active_project()
    prefs = _preferences_store.get_preferences(project_path)
    return {"ok": True, "data": prefs}


@file_editor_cm6_bp.post('/preferences')
async def update_preferences(payload: dict = Body(...)):
    """Persist editor/UI preference changes."""
    editor = payload.get('editor')
    ui = payload.get('ui')
    project = payload.get('project')

    active_project = _history_store.get_active_project()
    if project is None and active_project:
        project = {"path": active_project}
    elif project and not project.get('path') and active_project:
        project['path'] = active_project

    try:
        updated = _preferences_store.update_preferences(
            editor=editor,
            ui=ui,
            project=project,
        )
        # Return a fresh snapshot for convenience
        snapshot = _preferences_store.get_preferences(active_project)
        return {"ok": True, "data": snapshot, "updated": updated}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@file_editor_cm6_bp.post('/state/file_activity')
async def record_file_activity(data: dict = Body(...)):
    """Persist last-opened file and recents for the active project."""
    path = data.get('path')
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")

    project_path = data.get('project') or _history_store.get_active_project()
    if not project_path:
        raise HTTPException(status_code=400, detail="No project selected")

    try:
        project_root_path = Path(project_path).expanduser().resolve()
        candidate_path = Path(path).expanduser().resolve()
        if not str(candidate_path).startswith(str(project_root_path)):
            raise HTTPException(status_code=400, detail="File is outside the project root")

        entry = _history_store.record_file_activity(project_path, str(candidate_path))
        state = _build_state_payload()
        return {"ok": True, "data": {"entry": entry, "state": state}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@file_editor_cm6_bp.get('/diff')
def get_diff(path: str = Query(...)):
    """Return git diff hunks for the requested file."""
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")

    project_path = _history_store.get_active_project() or str(get_project_root())
    if not project_path:
        raise HTTPException(status_code=400, detail="No project selected")

    project_root = Path(project_path).expanduser()
    if not project_root.exists():
        raise HTTPException(status_code=404, detail="Project directory not available")

    try:
        rel = _normalize_rel_path(project_root, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    payload = collect_diff(project_root, rel)
    return {"ok": True, "data": payload}

@file_editor_cm6_bp.get('/explorer/list')
def explorer_list(rel: str = Query('.')):
    """List directory contents for the file explorer."""
    try:
        return {"ok": True, "data": list_dir(rel)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.post('/explorer/mkdir')
async def explorer_mkdir(data: dict = Body(...)):
    project = data.get('project')
    parent_rel = data.get('parent_rel', '.')
    name = data.get('name', '').strip()
    
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if '/' in name or '\\' in name:
        raise HTTPException(status_code=400, detail="Invalid name")
    
    try:
        from .explorer_helper import create_directory
        result = create_directory(parent_rel, name)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/touch')
async def explorer_touch(data: dict = Body(...)):
    project = data.get('project')
    parent_rel = data.get('parent_rel', '.')
    name = data.get('name', '').strip()
      
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if '/' in name or '\\' in name:
        raise HTTPException(status_code=400, detail="Invalid name")
      
    try:
        from .explorer_helper import create_file
        result = create_file(parent_rel, name)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/rename')
async def explorer_rename(data: dict = Body(...)):
    rel = data.get('rel')
    new_name = data.get('new_name', '').strip()
    
    if not rel:
        raise HTTPException(status_code=400, detail="Path required")
    if not new_name:
        raise HTTPException(status_code=400, detail="New name required")
    if '/' in new_name or '\\' in new_name:
        raise HTTPException(status_code=400, detail="Invalid name")
    
    try:
        from .explorer_helper import rename_entry
        result = rename_entry(rel, new_name)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/delete')
async def explorer_delete(data: dict = Body(...)):
    rel = data.get('rel')
    if not rel:
        raise HTTPException(status_code=400, detail="Path required")
    try:
        from .explorer_helper import delete_entry
        result = delete_entry(rel)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/batch_delete')
async def explorer_batch_delete(data: dict = Body(...)):
    rels = data.get('rels', [])
    if not rels:
        raise HTTPException(status_code=400, detail="Paths required")
    try:
        from .explorer_helper import batch_delete
        result = batch_delete(rels)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/copy')
async def explorer_copy(data: dict = Body(...)):
    rel = data.get('rel')
    dest_path = data.get('dest_path')
    if not rel or not dest_path:
        raise HTTPException(status_code=400, detail="Path required")
    try:
        from .explorer_helper import copy_entry
        result = copy_entry(rel, dest_path)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/move')
async def explorer_move(data: dict = Body(...)):
    rel = data.get('rel')
    dest_path = data.get('dest_path')
    if not rel or not dest_path:
        raise HTTPException(status_code=400, detail="Path required")
    try:
        from .explorer_helper import move_entry
        result = move_entry(rel, dest_path)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/batch_copy')
async def explorer_batch_copy(data: dict = Body(...)):
    rels = data.get('rels', [])
    dest_path = data.get('dest_path')
    if not rels or not dest_path:
        raise HTTPException(status_code=400, detail="Paths and destination required")
    try:
        from .explorer_helper import batch_copy
        result = batch_copy(rels, dest_path)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.post('/explorer/batch_move')
async def explorer_batch_move(data: dict = Body(...)):
    rels = data.get('rels', [])
    dest_path = data.get('dest_path')
    if not rels or not dest_path:
        raise HTTPException(status_code=400, detail="Paths and destination required")
    try:
        from .explorer_helper import batch_move
        result = batch_move(rels, dest_path)
        mark_git_cache_dirty(get_project_root())
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@file_editor_cm6_bp.get('/history/files')
def get_recent_files():
    """Get recent files for the current project."""
    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        files_raw = _history_store.list_files(str(project_root))
        files = []
        for entry in files_raw:
            entry_path = entry.get("path")
            files.append({
                **entry,
                "exists": bool(entry_path and Path(entry_path).is_file()),
            })
        return {"ok": True, "data": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.post('/history/touch')
async def touch_file_history(data: dict = Body(...)):
    """Add a file to the recent files list."""
    path = data.get('path')

    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        entry = _history_store.record_file_activity(str(project_root), path)
        return {"ok": True, "data": entry}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.delete('/history/file')
def remove_file_history(path: str = Query(...)):
    """Remove a file from the recent files list."""
    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        removed = _history_store.remove_file(str(project_root), path)
        return {"ok": True, "data": {"removed": removed}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.delete('/history/files/all')
def clear_all_file_history():
    """Clear all recent files for the active project."""
    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        cleared = _history_store.clear_all_files(str(project_root))
        return {"ok": True, "data": {"cleared": cleared}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.get('/edit_tracker/status')
def get_edit_tracker_status():
    """Get current edit tracker status."""
    try:
        status = edit_tracker.get_tracking_status()
        return {"ok": True, "data": status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@file_editor_cm6_bp.websocket('/ws/edit_tracker')
async def edit_tracker_ws(websocket: WebSocket):
    """WebSocket endpoint for edit tracking events."""
    await websocket.accept()
    
    event_queue = asyncio.Queue()
    
    def queue_callback(event):
        try:
            event_queue.put_nowait(event)
        except Exception:
            pass
    
    token = edit_tracker.subscribe(queue_callback)
    
    async def forward_events_to_ws():
        """Forward edit tracker events to WebSocket"""
        while True:
            try:
                event = await event_queue.get()
                await websocket.send_text(json.dumps(event))
            except asyncio.CancelledError:
                break
            except Exception:
                break
    
    forward_task = asyncio.create_task(forward_events_to_ws())
    
    try:
        # Keep connection alive (receive ping/pong)
        async for msg in websocket.iter_text():
            pass
    finally:
        # Clean up
        forward_task.cancel()
        try:
            edit_tracker.unsubscribe(token)
        except Exception:
            pass

@file_editor_cm6_bp.post('/editor/update_diffs')
async def update_diffs(data: dict = Body(...)):
    """Update diff hunks in editor state - for testing inline diffs"""
