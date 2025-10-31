# app/apps/file_editor_cm6/agent_routes.py

"""
REST API endpoints for agent management.

Provides endpoints to spawn, list, describe, and terminate agent processes.
"""

import json
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
    
    # Preferences storage helpers (shared by GET/SET) ---------------------------------
    import threading
    from pathlib import Path

    _PREFS_LOCK = threading.Lock()
    _PREFS_DIR = Path.home() / '.codex' / 'app_prefs'
    _PREFS_FILE = _PREFS_DIR / 'code_cm6.json'

    def _load_preferences() -> dict:
        with _PREFS_LOCK:
            if not _PREFS_FILE.exists():
                return {}
            try:
                content = _PREFS_FILE.read_text(encoding='utf-8')
                if not content.strip():
                    return {}
                data = json.loads(content)
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                # Corrupt file: back up and reset
                backup = _PREFS_FILE.with_suffix('.corrupt')
                try:
                    _PREFS_FILE.replace(backup)
                except Exception:
                    pass
            except Exception:
                pass
            return {}

    def _save_preferences(prefs: dict) -> None:
        _PREFS_DIR.mkdir(parents=True, exist_ok=True)
        tmp_path = _PREFS_FILE.with_suffix('.tmp')
        with _PREFS_LOCK:
            payload = json.dumps(prefs, indent=2)
            tmp_path.write_text(payload, encoding='utf-8')
            tmp_path.replace(_PREFS_FILE)

    @bp.get('/preferences/get')
    def preferences_get():
        """Get a preference value by key."""
        key = request.args.get('key')
        if not key:
            return jsonify({"ok": False, "error": "Missing key parameter"}), 400
        
        try:
            prefs = _load_preferences()
            return jsonify({"ok": True, "data": prefs.get(key)})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    @bp.post('/preferences/set')
    def preferences_set():
        """Set a preference value by key."""
        data = request.get_json(silent=True) or {}
        key = data.get('key')
        value = data.get('value')
        
        if not key:
            return jsonify({"ok": False, "error": "Missing key"}), 400
        
        try:
            prefs = _load_preferences()
            prefs[key] = value
            _save_preferences(prefs)
            return jsonify({"ok": True, "data": {"key": key}})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
