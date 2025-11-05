# app/apps/file_editor_cm6/terminal_backend.py

"""
Terminal drawer backend for the code editor.
Provides REST endpoints and WebSocket PTY streaming for embedded terminal.
"""

import json
import threading
from fastapi import APIRouter, Request, HTTPException, WebSocket, Body, Query
import asyncio
import anyio
from app.libs.framework_shells import FrameworkShellManager, get_manager

terminal_router = APIRouter()

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
        shell_info = await anyio.to_thread.run_sync(create_editor_shell, cwd=cwd, shell_cmd=shell_cmd)
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
        success = await anyio.to_thread.run_sync(destroy_editor_shell, shell_id)
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
        success = await anyio.to_thread.run_sync(resize_editor_shell, shell_id, cols, rows)
        if success:
            return {"ok": True, "data": {"id": shell_id, "cols": cols, "rows": rows}}
        else:
            raise HTTPException(status_code=500, detail="Failed to resize terminal")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@terminal_router.get('/terminal/{shell_id}')
def terminal_info(shell_id: str, logs: bool = Query(False), tail: int = Query(200), mgr: FrameworkShellManager = Depends(get_manager)):
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
        rec = mgr.get_shell(shell_id)
        if not rec:
            raise HTTPException(status_code=404, detail="Shell not found")
        
        info = mgr.describe(rec, include_logs=logs, tail_lines=tail)
        return {"ok": True, "data": info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    
    @terminal_router.websocket('/ws/terminal/{shell_id}')
async def terminal_ws(websocket: WebSocket, shell_id: str, mgr: FrameworkShellManager = Depends(get_manager)):
    """
    WebSocket endpoint for bidirectional PTY streaming.
    """
    await websocket.accept()
    
    try:
        output_queue = mgr.subscribe_output(shell_id)
    except Exception as e:
        await websocket.close()
        return
    
    stop_event = asyncio.Event()
    
    async def forward_pty_to_ws():
        """Forward PTY output to WebSocket client"""
        import queue as _queue
        while not stop_event.is_set():
            try:
                chunk = await anyio.to_thread.run_sync(output_queue.get, timeout=0.5)
            except _queue.Empty:
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
            try:
                await anyio.to_thread.run_sync(mgr.write_to_pty, shell_id, msg)
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
            await anyio.to_thread.run_sync(mgr.unsubscribe_output, shell_id, output_queue)
        except Exception:
            pass
