# app/apps/file_editor_cm6/agent_routes.py

"""
REST API endpoints for agent management.

Provides endpoints to spawn, list, describe, and terminate agent processes.
"""

import json
import time
from flask import jsonify, request
from .agent_bridge import get_bridge


def register_agent_routes(bp):
    """
    Register agent REST API routes on the file_editor_cm6 blueprint.
    
    Args:
        bp: Flask blueprint
    """
    
    @bp.post('/agent/create')
    def agent_create():
        """
        Create a new agent session.
        
        Body (JSON):
            agent: Agent type - 'codex' or 'gemini' (required)
            cwd: Working directory (optional, defaults to home)
            session: Session ID (optional, auto-generated if not provided)
        
        Returns:
            Agent session info including shell ID
        
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
        data = request.get_json(silent=True) or {}
        
        agent_type = data.get('agent')
        if not agent_type:
            return jsonify({"ok": False, "error": "Missing required field: agent"}), 400
        
        if agent_type not in ['codex', 'gemini']:
            return jsonify({"ok": False, "error": f"Invalid agent type: {agent_type}"}), 400
        
        cwd = data.get('cwd')
        session_id = data.get('session')
        
        if not session_id:
            import uuid
            session_id = str(uuid.uuid4())
        
        try:
            shell = bridge.spawn_agent(agent_type, cwd, session_id)
            return jsonify({
                "ok": True,
                "data": {
                    "session_id": session_id,
                    "shell_id": shell['id'],
                    "agent_type": agent_type,
                    "cwd": shell.get('cwd', ''),
                    "alive": shell.get('alive', True)
                }
            }), 201
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    
    @bp.get('/agent/list')
    def agent_list():
        """
        List all active agent sessions.
        
        Returns:
            List of active agents with metadata
        
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
            agents = bridge.list_agents()
            return jsonify({"ok": True, "data": agents})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    
    @bp.get('/agent/<session_id>')
    def agent_info(session_id):
        """
        Get agent session information and statistics.
        
        Args:
            session_id: Agent session ID
        
        Returns:
            Agent metadata including resource stats
        
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
            stats = bridge.get_agent_stats(session_id)
            if stats is None:
                return jsonify({"ok": False, "error": "Agent not found"}), 404
            
            return jsonify({
                "ok": True,
                "data": {
                    "session_id": session_id,
                    **stats
                }
            })
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    
    @bp.delete('/agent/<session_id>')
    def agent_terminate(session_id):
        """
        Terminate an agent session.
        
        Stops the agent process and cleans up resources.
        
        Args:
            session_id: Agent session ID
        
        Returns:
            Success confirmation
        
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
            bridge.terminate_agent(session_id)
            return jsonify({
                "ok": True,
                "data": {"session_id": session_id}
            })
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    @bp.post('/agent/send_raw')
    def agent_send_raw():
        """
        Send raw JSON message to agent (for approval responses, etc).
        
        Body (JSON):
            session_id: Session ID (required)
            message: Raw JSON string to send (required)
        
        Returns:
            Success confirmation
        """
        bridge = get_bridge()
        data = request.get_json(silent=True) or {}
        
        session_id = data.get('session_id')
        message = data.get('message')
        
        if not session_id or not message:
            return jsonify({"ok": False, "error": "Missing session_id or message"}), 400
        
        try:
            # Get shell ID for this session
            shell_id = bridge._sessions.get(session_id)
            if not shell_id:
                return jsonify({"ok": False, "error": "Session not found"}), 404
            
            # Write raw message to PTY
            bridge.manager.write_to_pty(shell_id, message + '\n')
            
            return jsonify({"ok": True, "data": {"session_id": session_id}})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    @bp.get('/preferences/get')
    def preferences_get():
        """Get a preference value by key."""
        from .agent_preferences import load_preferences
        key = request.args.get('key')
        if not key:
            return jsonify({"ok": False, "error": "Missing key parameter"}), 400
        
        try:
            prefs = load_preferences()
            return jsonify({"ok": True, "data": prefs.get(key)})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    @bp.post('/preferences/set')
    def preferences_set():
        """Set a preference value by key."""
        from .agent_preferences import load_preferences, save_preferences
        data = request.get_json(silent=True) or {}
        key = data.get('key')
        value = data.get('value')
        
        if not key:
            return jsonify({"ok": False, "error": "Missing key"}), 400
        
        try:
            prefs = load_preferences()
            prefs[key] = value
            save_preferences(prefs)
            return jsonify({"ok": True, "data": {"key": key}})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    # --- Session Management Endpoints ---
    
    @bp.get('/agent/sessions')
    def list_agent_sessions():
        """
        List all agent sessions with summary metadata.
        
        Returns:
            List of sessions (no full message history)
        
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
        from .agent_session_store import list_sessions
        try:
            sessions = list_sessions()
            return jsonify({"ok": True, "data": sessions})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    @bp.get('/agent/session/<session_id>')
    def get_agent_session(session_id):
        """
        Get full session data including message transcript.
        
        Args:
            session_id: Session ID
        
        Returns:
            Complete session with all messages
        
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
        from .agent_session_store import get_session
        try:
            session = get_session(session_id)
            if not session:
                return jsonify({"ok": False, "error": "Session not found"}), 404
            return jsonify({"ok": True, "data": session})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    @bp.post('/agent/sessions')
    def create_agent_session():
        """
        Create a new agent session.
        
        Body (JSON):
            name: Session name (required)
            agent: Agent type - 'codex' or 'gemini' (optional, default: 'codex')
            cwd: Working directory (optional)
            auto: Auto-approval enabled (optional, default: false)
            fullAccess: Full filesystem access (optional, default: false)
        
        Returns:
            Created session
        
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
        from .agent_session_store import create_session
        import uuid
        
        data = request.get_json(silent=True) or {}
        name = data.get('name')
        if not name:
            return jsonify({"ok": False, "error": "Missing required field: name"}), 400
        
        agent = data.get('agent', 'codex')
        if agent not in ['codex', 'gemini']:
            return jsonify({"ok": False, "error": f"Invalid agent type: {agent}"}), 400
        
        session_id = f"session-{uuid.uuid4().hex[:12]}"
        cwd = data.get('cwd')
        auto = data.get('auto', False)
        fullAccess = data.get('fullAccess', False)
        
        try:
            session = create_session(
                session_id=session_id,
                name=name,
                agent=agent,
                cwd=cwd,
                auto=auto,
                fullAccess=fullAccess
            )
            return jsonify({"ok": True, "data": session}), 201
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    @bp.delete('/agent/session/<session_id>')
    def delete_agent_session(session_id):
        """
        Delete a session.
        
        Args:
            session_id: Session ID
        
        Returns:
            Success confirmation
        
        Example:
            DELETE /api/app/file_editor_cm6/agent/session/session-123
            
            Response:
            {
              "ok": true,
              "data": {"session_id": "session-123"}
            }
        """
        from .agent_session_store import delete_session
        try:
            deleted = delete_session(session_id)
            if not deleted:
                return jsonify({"ok": False, "error": "Session not found"}), 404
            return jsonify({"ok": True, "data": {"session_id": session_id}})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    @bp.post('/agent/session/<session_id>/send')
    def send_to_agent_session(session_id):
        """
        Send a user message to an agent session.
        
        This enqueues the message for processing. The response will be
        streamed back via WebSocket.
        
        Body (JSON):
            text: User message text (required)
            attachFile: Attach current file context (optional, default: false)
        
        Args:
            session_id: Session ID
        
        Returns:
            Message acknowledgement
        
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
        from .agent_session_store import get_session, append_message
        import uuid
        
        data = request.get_json(silent=True) or {}
        text = data.get('text')
        if not text:
            return jsonify({"ok": False, "error": "Missing required field: text"}), 400
        
        try:
            session = get_session(session_id)
            if not session:
                return jsonify({"ok": False, "error": "Session not found"}), 404
            
            # Append user message to session
            message_id = f"msg-{uuid.uuid4().hex[:12]}"
            message = {
                'id': message_id,
                'type': 'user',
                'text': text,
                'timestamp': time.time()
            }
            append_message(session_id, message)
            
            # TODO: Trigger agent processing via WebSocket or queue
            # For now, the WebSocket handler will pick this up
            
            return jsonify({
                "ok": True,
                "data": {
                    "session_id": session_id,
                    "messageId": message_id,
                    "queued": True
                }
            })
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    @bp.get('/agent/shell/status')
    def get_agent_shell_status():
        """
        Check if there's an active Codex MCP server shell.
        
        Returns shell info if one exists, otherwise returns None.
        
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
        from app.libs.framework_shells import _manager
        
        try:
            # Get the manager instance
            mgr = _manager()
            
            # Find active Codex MCP shells
            shells = mgr.list_shells()
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
            
            return jsonify({"ok": True, "data": codex_shell})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
