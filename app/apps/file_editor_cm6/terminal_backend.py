# app/apps/file_editor_cm6/terminal_backend.py

"""
Terminal drawer backend for the code editor.
Provides REST endpoints and WebSocket PTY streaming for embedded terminal.
"""

import asyncio
import json
from pathlib import Path
from fastapi import APIRouter, Request, HTTPException, WebSocket, Body, Query, Depends

from app.libs.framework_shells import FrameworkShellManager, get_manager
from app.apps.file_editor_cm6 import edit_tracker
from app.apps.file_editor_cm6.terminal_shell import (
    create_editor_shell,
    destroy_editor_shell,
    resize_editor_shell,
    get_shell_info
)

terminal_router = APIRouter()

# Module-level singleton for history store to persist across requests
_history_store_singleton = None

def get_history_store():
    """Get or create the singleton HistoryStore instance."""
    global _history_store_singleton
    if _history_store_singleton is None:
        from app.apps.file_editor_cm6.history_store import HistoryStore
        _history_store_singleton = HistoryStore()
    return _history_store_singleton

@terminal_router.get('/terminal/shell-id')
async def get_terminal_shell_id():
    """Get the stored terminal shell ID, validating it still exists and cleaning up orphans."""
    history_store = get_history_store()
    mgr = await get_manager()
    
    try:
        shell_id = history_store.get_terminal_shell_id()
        
        # First, clean up orphaned terminal shells (except the saved one)
        shells = await mgr.list_shells()
        orphans = [s for s in shells if s.label == 'code-editor-terminal' and s.id != shell_id]
        for orphan in orphans:
            try:
                await mgr.terminate_shell(orphan.id)
            except Exception as e:
                print(f"Failed to cleanup orphan shell {orphan.id}: {e}")
        
        # If we have a stored shell ID, verify it still exists
        if shell_id:
            rec = await mgr.get_shell(shell_id)
            if not rec or rec.status != 'running':
                # Shell was deleted or died - clear the stale ID
                history_store.set_terminal_shell_id(None)
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

@terminal_router.post('/terminal/create')
async def terminal_create(data: dict = Body(...)):
    """
    Create a new terminal shell session.
    
    Body (JSON):
        cwd: Working directory (optional, defaults to home or current project)
        shell: Custom shell command (optional, defaults to bash -l -i)
    
    Returns:
        Shell session info including ID
    """
    cwd = data.get('cwd')
    shell_cmd = data.get('shell')
    
    try:
        shell_info = await create_editor_shell(cwd=cwd, shell_cmd=shell_cmd)
        return {"ok": True, "data": shell_info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    
    # Handle auto shell management
    if shell_id == 'auto':
        print(f"[Terminal WS] Auto shell management requested")
        history_store = get_history_store()
        saved_shell_id = history_store.get_terminal_shell_id()
        print(f"[Terminal WS] Saved shell ID from history: {saved_shell_id}")
        
        # Clean up orphaned shells first - DIRECT AWAIT
        shells = await mgr.list_shells()
        orphans = [s for s in shells if s.label == 'code-editor-terminal' and s.id != saved_shell_id]
        print(f"[Terminal WS] Found {len(orphans)} orphaned terminal shells")
        for s in orphans:
            try:
                print(f"[Terminal WS] Cleaning up orphaned shell: {s.id}")
                await mgr.terminate_shell(s.id)
            except Exception as e:
                print(f"[Terminal WS] Failed to cleanup orphan {s.id}: {e}")
        
        # Validate saved shell - DIRECT AWAIT
        if saved_shell_id:
            rec = await mgr.get_shell(saved_shell_id)
            if rec and rec.status == 'running':
                print(f"[Terminal WS] Reconnecting to existing shell: {saved_shell_id}")
                shell_id = saved_shell_id
            else:
                print(f"[Terminal WS] Saved shell no longer running (status={rec.status if rec else 'not found'})")
                saved_shell_id = None
        else:
            print(f"[Terminal WS] No saved shell ID found")
        
        # Create new shell if needed - DIRECT AWAIT
        if not saved_shell_id:
            # Use active project path if available, fallback to home
            project_path = history_store.get_active_project()
            cwd = project_path if project_path and Path(project_path).is_dir() else str(Path.home())
            print(f"[Terminal WS] Creating new terminal shell (cwd={cwd})")
            shell_rec = await create_editor_shell(cwd=cwd)
            shell_id = shell_rec['id']
            print(f"[Terminal WS] New shell created: {shell_id}")
            history_store.set_terminal_shell_id(shell_id)
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
                stop_event.set()
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
                    history_store.set_terminal_shell_id(None)
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
