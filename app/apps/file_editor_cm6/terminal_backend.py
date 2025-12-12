# app/apps/file_editor_cm6/terminal_backend.py

"""
Terminal drawer backend for the code editor.
Provides REST endpoints and WebSocket PTY streaming for embedded terminal.
"""

import asyncio
import json
import shlex
from pathlib import Path
from typing import Set
from fastapi import APIRouter, HTTPException, WebSocket, Body, Query, Depends

from app.libs.framework_shells import FrameworkShellManager, get_manager
from app.apps.file_editor_cm6 import edit_tracker
from app.apps.file_editor_cm6.stores import _history_store as _shared_history_store
from app.apps.file_editor_cm6.project_sidecar import ProjectSidecar
from app.apps.file_editor_cm6.terminal_shell import (
    create_editor_shell,
    destroy_editor_shell,
    resize_editor_shell,
)

terminal_router = APIRouter()

# Track active terminal websocket clients so the backend can force a reconnect on project switch.
_active_terminal_sockets: Set[WebSocket] = set()
_active_terminal_lock = asyncio.Lock()


async def close_active_terminal_sockets(reason: str = "project switch") -> None:
    """Close all live terminal websocket connections.

    This is used to force clients to reconnect to /ws/terminal/auto so the
    backend can bind them to the newly active project's shell. The frontend
    remains project-agnostic.
    """
    async with _active_terminal_lock:
        sockets = list(_active_terminal_sockets)
        _active_terminal_sockets.clear()

    for ws in sockets:
        try:
            await ws.close(code=1012, reason=reason)
        except Exception:
            pass

def get_history_store():
    """Return the shared HistoryStore instance used across the app."""
    return _shared_history_store

# Commands allowed for "run current file" action.
RUNNABLE_COMMANDS = {
    ".py": ["python3"],
    ".pyw": ["python3"],
    ".sh": ["bash"],
    ".bash": ["bash"],
    ".zsh": ["zsh"],
}

@terminal_router.get('/terminal/shell-id')
async def get_terminal_shell_id():
    """Get the stored terminal shell ID for the active project.

    Validates the shell is still alive; does not terminate other shells.
    """
    history_store = get_history_store()
    mgr = await get_manager()
    
    try:
        project_path = history_store.get_active_project()
        shell_id = history_store.get_terminal_shell_id(project_path)
        
        # If we have a stored shell ID, verify it still exists
        if shell_id:
            rec = await mgr.get_shell(shell_id)
            if not rec or rec.status != 'running' or not rec.pid:
                # Shell was deleted or died - clear the stale ID
                history_store.set_terminal_shell_id(None, project_path)
                shell_id = None
        
        # Return null if no valid shell ID
        return {"ok": True, "data": {"shell_id": shell_id}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@terminal_router.post('/terminal/shell-id')
async def set_terminal_shell_id(data: dict = Body(...)):
    """Store the terminal shell ID."""
    history_store = get_history_store()
    
    shell_id = data.get('shell_id')
    
    try:
        history_store.set_terminal_shell_id(shell_id)
        return {"ok": True, "data": {"shell_id": shell_id}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.get('/terminal/shells')
async def list_terminal_shells(include_exited: bool = Query(False)):
    """List terminal shells for the active project.

    Returns ordered live shells by default. Exited/stale shells are pruned from
    the per-project list unless include_exited is true.
    """
    history_store = get_history_store()
    project_path = history_store.get_active_project()
    if not project_path:
        return {"ok": True, "data": {"active_shell_id": None, "shells": []}}

    sidecar = ProjectSidecar.load_or_create(project_path)
    shell_ids = sidecar.get_terminal_shell_ids()
    active_id = sidecar.get_active_terminal_shell_id()

    mgr = await get_manager()
    shells = []
    dead_ids = []
    for sid in shell_ids:
        rec = await mgr.get_shell(sid)
        live = bool(rec and rec.status == "running" and rec.pid)
        if not live:
            dead_ids.append(sid)
            if not include_exited:
                continue
        shells.append({
            "id": sid,
            "label": f"Terminal {sid[-4:]}",
            "status": rec.status if rec else "missing",
            "pid": rec.pid if rec else None,
        })

    # Prune dead ids from sidecar to keep list clean.
    if dead_ids and not include_exited:
        for sid in dead_ids:
            sidecar.remove_terminal_shell_id(sid)
        active_id = sidecar.get_active_terminal_shell_id()
        sidecar.save()

    return {"ok": True, "data": {"active_shell_id": active_id, "shells": shells}}


@terminal_router.post('/terminal/shells')
async def create_terminal_shell():
    """Create a new PTY terminal shell for the active project and set active."""
    history_store = get_history_store()
    project_path = history_store.get_active_project()
    if not project_path:
        raise HTTPException(status_code=400, detail="No active project selected")

    sidecar = ProjectSidecar.load_or_create(project_path)
    existing_ids = sidecar.get_terminal_shell_ids()
    sequence = len(existing_ids) + 1

    cwd = project_path if Path(project_path).is_dir() else str(Path.home())
    shell_rec = await create_editor_shell(cwd=cwd, project_path=project_path, sequence=sequence)
    shell_id = shell_rec["id"]

    sidecar.add_terminal_shell_id(shell_id)
    sidecar.save()

    # Force any open drawers to rebind to the new active shell.
    await close_active_terminal_sockets("new terminal")

    return {"ok": True, "data": {"shell_id": shell_id, "label": f"Terminal {shell_id[-4:]}"}}


@terminal_router.post('/terminal/shells/{shell_id}/activate')
async def activate_terminal_shell(shell_id: str):
    """Activate an existing terminal shell for the active project."""
    history_store = get_history_store()
    project_path = history_store.get_active_project()
    if not project_path:
        raise HTTPException(status_code=400, detail="No active project selected")

    sidecar = ProjectSidecar.load_or_create(project_path)
    ids = sidecar.get_terminal_shell_ids()
    if shell_id not in ids:
        raise HTTPException(status_code=404, detail="Shell not tracked for this project")

    mgr = await get_manager()
    rec = await mgr.get_shell(shell_id)
    if not rec or rec.status != "running" or not rec.pid:
        # Prune dead shell.
        sidecar.remove_terminal_shell_id(shell_id)
        sidecar.save()
        raise HTTPException(status_code=409, detail="Shell is not running")

    sidecar.set_active_terminal_shell_id(shell_id)
    sidecar.save()

    await close_active_terminal_sockets("terminal activate")
    return {"ok": True, "data": {"shell_id": shell_id}}


@terminal_router.post('/terminal/run_active_file')
async def run_active_file():
    """Run the currently active (last opened) file in the project terminal.

    Saving is handled separately by the editor save endpoint; this only dispatches.
    """
    history_store = get_history_store()

    project_path = history_store.get_active_project()
    current_file = history_store.get_last_file(project_path) if project_path else None
    if not current_file:
        raise HTTPException(status_code=400, detail="No file is currently open")

    path_obj = Path(current_file).expanduser().resolve(strict=False)
    ext = path_obj.suffix.lower()
    runner = RUNNABLE_COMMANDS.get(ext)
    if not runner:
        raise HTTPException(status_code=400, detail="Only Python and shell scripts can be executed")

    workdir = str(path_obj.parent)
    cmd_tokens = runner + [str(path_obj)]
    command_preview = " ".join(shlex.quote(part) for part in cmd_tokens)

    mgr = await get_manager()
    shell_id = history_store.get_terminal_shell_id(project_path)
    if shell_id:
        rec = await mgr.get_shell(shell_id)
        if not rec or rec.status != "running" or not rec.pid:
            history_store.set_terminal_shell_id(None, project_path)
            shell_id = None

    if not shell_id:
        preferred_cwd = project_path if project_path and Path(project_path).is_dir() else workdir
        try:
            sidecar = ProjectSidecar.load_or_create(project_path) if project_path else None
            seq = (len(sidecar.get_terminal_shell_ids()) + 1) if sidecar else 1
        except Exception:
            seq = 1
        shell_info = await create_editor_shell(cwd=preferred_cwd, project_path=project_path, sequence=seq)
        shell_id = shell_info["id"]
        history_store.set_terminal_shell_id(shell_id, project_path)

    try:
        await mgr.write_to_pty(shell_id, command_preview + "\n")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to dispatch command: {e}")

    return {
        "ok": True,
        "data": {
            "shell_id": shell_id,
            "command_preview": command_preview,
            "working_dir": workdir,
        },
    }

@terminal_router.delete('/terminal/{shell_id}')
async def terminal_destroy(shell_id: str):
    """
    Permanently destroy a terminal shell session.
    Called when user clicks the X button to close the terminal.
    
    Args:
        shell_id: Shell session ID to destroy
    
    Returns:
        Success confirmation
    """
    try:
        success = await destroy_editor_shell(shell_id)
        # Remove from per-project list if applicable.
        history_store = get_history_store()
        project_path = history_store.get_active_project()
        was_active = False
        if project_path:
            try:
                sidecar = ProjectSidecar.load_or_create(project_path)
                was_active = sidecar.get_active_terminal_shell_id() == shell_id
                sidecar.remove_terminal_shell_id(shell_id)
                sidecar.save()
            except Exception:
                pass
        if was_active:
            await close_active_terminal_sockets("terminal closed")
        if success:
            return {"ok": True, "data": {"id": shell_id}}
        else:
            raise HTTPException(status_code=500, detail="Failed to destroy shell")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.post('/terminal/{shell_id}/resize')
async def terminal_resize(shell_id: str, data: dict = Body(...)):
    """
    Resize the terminal PTY.
    
    Body (JSON):
        cols: Terminal columns
        rows: Terminal rows
    
    Args:
        shell_id: Shell session ID
    
    Returns:
        Success confirmation
    """
    cols = int(data.get('cols', 80))
    rows = int(data.get('rows', 24))
    
    try:
        success = await resize_editor_shell(shell_id, cols, rows)
        if success:
            return {"ok": True, "data": {"id": shell_id, "cols": cols, "rows": rows}}
        else:
            raise HTTPException(status_code=500, detail="Failed to resize terminal")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.get('/terminal/{shell_id}')
async def terminal_info(shell_id: str, logs: bool = Query(False), tail: int = Query(200), mgr: FrameworkShellManager = Depends(get_manager)):
    """
    Get terminal shell session information.
    
    Query params:
        logs: Include log tails (default: false)
        tail: Number of lines to include (default: 200)
    
    Args:
        shell_id: Shell session ID
    
    Returns:
        Shell metadata with optional log tails
    """
    try:
        rec = await mgr.get_shell(shell_id)
        if not rec:
            raise HTTPException(status_code=404, detail="Shell not found")
        
        info = await mgr.describe(rec, include_logs=logs, tail_lines=tail)
        return {"ok": True, "data": info}
    except HTTPException:
        raise  # Re-raise HTTPException as-is
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.websocket('/ws/terminal/{shell_id}')
async def terminal_ws(websocket: WebSocket, shell_id: str, mgr: FrameworkShellManager = Depends(get_manager)):
    """
    WebSocket endpoint for bidirectional PTY streaming.
    If shell_id is 'auto', backend will restore or create a shell automatically.
    """
    await websocket.accept()

    # Register this websocket for backend-managed project switches.
    async with _active_terminal_lock:
        _active_terminal_sockets.add(websocket)

    history_store = get_history_store()
    shell_project_path: str | None = None
    
    # Handle auto shell management
    if shell_id == 'auto':
        print(f"[Terminal WS] Auto shell management requested")
        shell_project_path = history_store.get_active_project()
        saved_shell_id = history_store.get_terminal_shell_id(shell_project_path)
        print(f"[Terminal WS] Saved shell ID from history: {saved_shell_id}")
        
        # Validate saved shell - DIRECT AWAIT
        if saved_shell_id:
            rec = await mgr.get_shell(saved_shell_id)
            if rec and rec.status == 'running' and rec.pid:
                print(f"[Terminal WS] Reconnecting to existing shell: {saved_shell_id}")
                shell_id = saved_shell_id
            else:
                print(f"[Terminal WS] Saved shell no longer running (status={rec.status if rec else 'not found'})")
                history_store.set_terminal_shell_id(None, shell_project_path)
                saved_shell_id = None
        else:
            print(f"[Terminal WS] No saved shell ID found")
        
        # Create new shell if needed - DIRECT AWAIT
        if not saved_shell_id:
            # Use active project path if available, fallback to home
            project_path = shell_project_path
            cwd = project_path if project_path and Path(project_path).is_dir() else str(Path.home())
            try:
                sidecar = ProjectSidecar.load_or_create(project_path) if project_path else None
                seq = (len(sidecar.get_terminal_shell_ids()) + 1) if sidecar else 1
            except Exception:
                seq = 1
            print(f"[Terminal WS] Creating new terminal shell (cwd={cwd})")
            shell_rec = await create_editor_shell(cwd=cwd, project_path=project_path, sequence=seq)
            shell_id = shell_rec['id']
            print(f"[Terminal WS] New shell created: {shell_id}")
            history_store.set_terminal_shell_id(shell_id, project_path)
            print(f"[Terminal WS] Saved shell ID to history store")
        
        # Send shell ID to client
        print(f"[Terminal WS] Sending shell_id to client: {shell_id}")
        await websocket.send_json({"type": "shell_id", "shell_id": shell_id})
    
    # Subscribe to output - DIRECT AWAIT, AsyncQueue returned
    try:
        output_queue = await mgr.subscribe_output(shell_id)
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close()
        return
    
    stop_event = asyncio.Event()
    
    async def forward_pty_to_ws():
        """Forward PTY output to WebSocket client"""
        while not stop_event.is_set():
            try:
                # AsyncQueue.get is already async - DIRECT AWAIT
                chunk = await asyncio.wait_for(output_queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            
            try:
                await websocket.send_text(chunk)
            except Exception:
                # Force the websocket loop to unwind so a fresh connection can start cleanly
                stop_event.set()
                try:
                    await websocket.close(code=1011, reason='terminal stream error')
                except Exception:
                    pass
                break
    
    forward_task = asyncio.create_task(forward_pty_to_ws())
    
    edit_tracker.register_shell_watcher(shell_id, 'terminal')
    
    try:
        async for msg in websocket.iter_text():
            # Check if this is a command message
            try:
                data = json.loads(msg)
                if isinstance(data, dict) and data.get('action') == 'destroy':
                    print(f"[Terminal WS] Received destroy command for shell {shell_id}")
                    
                    # Terminate the shell
                    try:
                        await mgr.terminate_shell(shell_id, force=True)
                    except Exception as e:
                        print(f"[Terminal WS] Error terminating shell: {e}")
                    
                    # Clear from history store (ATOMIC with terminate)
                    if shell_project_path:
                        try:
                            sidecar = ProjectSidecar.load_or_create(shell_project_path)
                            sidecar.remove_terminal_shell_id(shell_id)
                            sidecar.save()
                        except Exception:
                            history_store.set_terminal_shell_id(None, shell_project_path)
                    else:
                        history_store.set_terminal_shell_id(None, shell_project_path)
                    print(f"[Terminal WS] Shell {shell_id} destroyed and cache cleared")
                    
                    # Send confirmation and close
                    await websocket.send_json({"type": "destroyed", "shell_id": shell_id})
                    break  # Exit loop, triggers cleanup in finally block
            except (json.JSONDecodeError, TypeError):
                # Not JSON, treat as regular terminal input
                pass
            
            # Regular terminal input
            try:
                await mgr.write_to_pty(shell_id, msg)
            except Exception:
                pass
    finally:
        stop_event.set()
        edit_tracker.unregister_shell_watcher(shell_id)
        async with _active_terminal_lock:
            _active_terminal_sockets.discard(websocket)
        forward_task.cancel()
        try:
            await forward_task
        except asyncio.CancelledError:
            pass
        
        try:
            # DIRECT AWAIT
            await mgr.unsubscribe_output(shell_id, output_queue)
        except Exception:
            pass
