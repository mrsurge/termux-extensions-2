# app/apps/file_editor_cm6/agent_routes.py

"""
REST API endpoints for agent management.

Provides endpoints to spawn, list, describe, and terminate agent processes.
"""

import json
import time
from fastapi import APIRouter, Request, HTTPException, Body, Query, Depends
import anyio
from fastapi.responses import JSONResponse
from .agent_bridge import get_bridge
from framework_shells import FrameworkShellManager, get_manager
from .terminal_backend import get_manager_dep

bp = APIRouter()

@bp.post('/agent/create', status_code=201)
async def agent_create(data: dict = Body(...)):
    """
    Create a new agent session.

    Example:
        POST /api/app/file_editor_cm6/agent/create
        {"agent":"codex","cwd":"/home/user/project"}
        
        Response:
        {
          "ok": true,
          "data": {
            "session_id": "abc123",
            "shell_id": "fs_...",
            "agent_type": "codex",
            "cwd": "/home/user/project",
            "alive": true
          }
        }
    """
    bridge = get_bridge()
    
    agent_type = data.get('agent')
    if not agent_type:
        raise HTTPException(status_code=400, detail="Missing required field: agent")
    
    if agent_type not in ['codex', 'gemini']:
        raise HTTPException(status_code=400, detail=f"Invalid agent type: {agent_type}")
    
    cwd = data.get('cwd')
    session_id = data.get('session')
    
    if not session_id:
        import uuid
        session_id = str(uuid.uuid4())
    
    try:
        shell = await bridge.spawn_agent(agent_type, cwd, session_id)
        return {
            "ok": True,
            "data": {
                "session_id": session_id,
                "shell_id": shell['id'],
                "agent_type": agent_type,
                "cwd": shell.get('cwd', ''),
                "alive": shell.get('alive', True)
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@bp.get('/agent/list')
async def agent_list():
    """
    List all active agent sessions.

    Example:
        GET /api/app/file_editor_cm6/agent/list
        
        Response:
        {
          "ok": true,
          "data": [
            {
              "session_id": "abc123",
              "shell_id": "fs_...",
              "label": "agent-codex-abc123",
              "alive": true,
              "cwd": "/home/user/project",
              "uptime": 123.45
            }
          ]
        }
    """
    bridge = get_bridge()
    
    try:
        agents = await bridge.list_agents()
        return {"ok": True, "data": agents}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# Specific routes MUST come before wildcard routes to avoid path conflicts
    
@bp.get('/agent/sessions')
async def list_agent_sessions():
    """
    List all agent sessions with summary metadata.

    Example:
        GET /api/app/file_editor_cm6/agent/sessions
        
        Response:
        {
          "ok": true,
          "data": [
            {
              "id": "session-123",
              "name": "Project Debug",
              "agent": "codex",
              "conversationId": "abc...",
              "messageCount": 15,
              "createdAt": 1730000000,
              "cwd": "/home/user/project",
              "auto": false,
              "fullAccess": false
            }
          ]
        }
    """
    from .conversation_store import list_sessions
    try:
        sessions = await anyio.to_thread.run_sync(list_sessions)
        return {"ok": True, "data": sessions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@bp.post('/agent/sessions', status_code=201)
async def create_agent_session(data: dict = Body(...)):
    """
    Create a new agent session.
    
    Example:
        POST /api/app/file_editor_cm6/agent/sessions
        {"name":"Debug Session","agent":"codex","cwd":"/home/user/project"}
        
        Response:
        {
          "ok": true,
          "data": {
            "id": "session-123",
            "name": "Debug Session",
            "agent": "codex",
            "messages": [],
            "createdAt": 1730000000
          }
        }
    
    """
    from .conversation_store import create_session
    import uuid
    
    # Make name optional with a default for backwards compatibility
    name = data.get('name') or f"Session {uuid.uuid4().hex[:6]}"
    
    agent = data.get('agent', 'codex')
    if agent not in ['codex', 'gemini']:
        raise HTTPException(status_code=400, detail=f"Invalid agent type: {agent}")
    
    cwd = data.get('cwd')
    auto = data.get('auto', False)
    fullAccess = data.get('fullAccess', False)
    
    try:
        session = await anyio.to_thread.run_sync(
            lambda: create_session(
                name=name,
                agent=agent,
                cwd=cwd,
                auto=auto,
                fullAccess=fullAccess
            )
        )
        return {"ok": True, "data": session}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@bp.get('/agent/shell/status')
async def get_agent_shell_status(mgr: FrameworkShellManager = Depends(get_manager_dep)):
    """
    Check if there's an active Codex MCP server shell.

    Example:
        GET /api/app/file_editor_cm6/agent/shell/status
        
        Response:
        {
          "ok": true,
          "data": {
            "shell_id": "fs_1762043953_7cd3f985",
            "status": "running",
            "alive": true
          }
        }
    """
    try:
        # Find active Codex MCP shells
        shells = await mgr.list_shells()
        codex_shell = None
        
        for shell in shells:
            # Check if this is a Codex MCP server shell (note: space not hyphen)
            # shell.command is a List[str], so join and check
            command_str = ' '.join(shell.command) if isinstance(shell.command, list) else str(shell.command)
            if 'codex mcp-server' in command_str:
                # Check if shell is running (status == 'running' and has PID)
                if shell.status == 'running' and shell.pid:
                    codex_shell = {
                        'shell_id': shell.id,
                        'status': shell.status,
                        'alive': True,
                        'pid': shell.pid
                    }
                    break
        
        return {"ok": True, "data": codex_shell}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    
@bp.get('/agent/{session_id}')
async def agent_info(session_id: str):
    """
    Get agent session information and statistics.

    Example:
        GET /api/app/file_editor_cm6/agent/abc123
        
        Response:
        {
          "ok": true,
          "data": {
            "session_id": "abc123",
            "alive": true,
            "cpu_percent": 2.5,
            "rss_mb": 45.2,
            "uptime": 123.45,
            "pid": 12345
          }
        }
    """
    bridge = get_bridge()
    
    try:
        stats = await bridge.get_agent_stats(session_id)
        if stats is None:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        return {
            "ok": True,
            "data": {
                "session_id": session_id,
                **stats
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    
@bp.delete('/agent/{session_id}')
async def agent_terminate(session_id: str):
    """
    Terminate an agent session.

    Example:
        DELETE /api/app/file_editor_cm6/agent/abc123
        
        Response:
        {
          "ok": true,
          "data": {"session_id": "abc123"}
        }
    """
    bridge = get_bridge()
    
    try:
        await bridge.terminate_agent(session_id)
        return {
            "ok": True,
            "data": {"session_id": session_id}
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@bp.post('/agent/send_raw')
async def agent_send_raw(data: dict = Body(...)):
    """
    Send raw JSON message to agent (for approval responses, etc).
    """
    bridge = get_bridge()
    
    session_id = data.get('session_id')
    message = data.get('message')
    
    if not session_id or not message:
        raise HTTPException(status_code=400, detail="Missing session_id or message")
    
    try:
        # Get shell ID for this session
        shell_id = bridge._sessions.get(session_id)
        if not shell_id:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Write raw message to PTY
        mgr = await bridge._get_manager()
        await mgr.write_to_pty(shell_id, message + '\n')
        
        return {"ok": True, "data": {"session_id": session_id}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@bp.get('/preferences/get')
async def preferences_get(key: str = Query(...)):
    """Get a preference value by key."""
    from .agent_preferences import load_preferences
    if not key:
        raise HTTPException(status_code=400, detail="Missing key parameter")
    
    try:
        prefs = await anyio.to_thread.run_sync(load_preferences)
        return {"ok": True, "data": prefs.get(key)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@bp.post('/preferences/set')
async def preferences_set(data: dict = Body(...)):
    """Set a preference value by key."""
    from .agent_preferences import load_preferences, save_preferences
    key = data.get('key')
    value = data.get('value')
    
    if not key:
        raise HTTPException(status_code=400, detail="Missing key")
    
    try:
        prefs = await anyio.to_thread.run_sync(load_preferences)
        prefs[key] = value
        await anyio.to_thread.run_sync(save_preferences, prefs)
        return {"ok": True, "data": {"key": key}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    # --- Session Management Endpoints ---
    
@bp.get('/agent/session/{session_id}')
async def get_agent_session(session_id: str):
    """
    Get full session data including message transcript.

    Example:
        GET /api/app/file_editor_cm6/agent/session/session-123
        
        Response:
        {
          "ok": true,
          "data": {
            "id": "session-123",
            "name": "Project Debug",
            "agent": "codex",
            "conversationId": "abc...",
            "messages": [...],
            "createdAt": 1730000000,
            "version": 42
          }
        }
    """
    from .conversation_store import get_session
    try:
        session = await anyio.to_thread.run_sync(get_session, session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"ok": True, "data": session}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@bp.delete('/agent/session/{session_id}')
async def delete_agent_session(session_id: str):
    """
    Delete a session.

    Example:
        DELETE /api/app/file_editor_cm6/agent/session/session-123
        
        Response:
        {
          "ok": true,
          "data": {"session_id": "session-123"}
        }
    """
    from .conversation_store import delete_session
    try:
        await anyio.to_thread.run_sync(delete_session, session_id)
        return {"ok": True, "data": {"session_id": session_id}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@bp.post('/agent/session/{session_id}/send')
async def send_to_agent_session(session_id: str, data: dict = Body(...)):
    """
    Send a user message to an agent session.

    Example:
        POST /api/app/file_editor_cm6/agent/session/session-123/send
        {"text":"Explain this function","attachFile":true}
        
        Response:
        {
          "ok": true,
          "data": {
            "session_id": "session-123",
            "messageId": "msg-456",
            "queued": true
          }
        }
    """
    from .conversation_store import get_session, append_message
    import uuid
    
    text = data.get('text')
    if not text:
        raise HTTPException(status_code=400, detail="Missing required field: text")
    
    try:
        session = await anyio.to_thread.run_sync(get_session, session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Append user message to session
        message_id = f"msg-{uuid.uuid4().hex[:12]}"
        message = {
            'id': message_id,
            'type': 'user',
            'text': text,
            'timestamp': time.time()
        }
        await anyio.to_thread.run_sync(append_message, session_id, message)
        
        # TODO: Trigger agent processing via WebSocket or queue
        # For now, the WebSocket handler will pick this up
        
        return {
            "ok": True,
            "data": {
                "session_id": session_id,
                "messageId": message_id,
                "queued": True
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))