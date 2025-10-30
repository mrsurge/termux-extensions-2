# app/apps/file_editor_cm6/terminal_backend.py

"""
Terminal drawer backend for the code editor.
Provides REST endpoints and WebSocket PTY streaming for embedded terminal.
"""

import json
import threading
from flask import jsonify, request
from app.libs.framework_shells import _manager
from .terminal_shell import create_editor_shell, destroy_editor_shell, resize_editor_shell, get_shell_info
from . import edit_tracker


def register_terminal_routes(bp, sock):
    """
    Register terminal-related routes on the file_editor_cm6 blueprint.
    
    Args:
        bp: Flask blueprint
        sock: Flask-Sock instance
    """
    
    @bp.post('/terminal/create')
    def terminal_create():
        """
        Create a new terminal shell session.
        
        Body (JSON):
            cwd: Working directory (optional, defaults to home or current project)
            shell: Custom shell command (optional, defaults to bash -l -i)
        
        Returns:
            Shell session info including ID
        """
        data = request.get_json(silent=True) or {}
        cwd = data.get('cwd')
        shell_cmd = data.get('shell')
        
        try:
            shell_info = create_editor_shell(cwd=cwd, shell_cmd=shell_cmd)
            return jsonify({"ok": True, "data": shell_info}), 201
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    
    @bp.delete('/terminal/<shell_id>')
    def terminal_destroy(shell_id):
        """
        Permanently destroy a terminal shell session.
        Called when user clicks the X button to close the terminal.
        
        Args:
            shell_id: Shell session ID to destroy
        
        Returns:
            Success confirmation
        """
        try:
            success = destroy_editor_shell(shell_id)
            if success:
                return jsonify({"ok": True, "data": {"id": shell_id}})
            else:
                return jsonify({"ok": False, "error": "Failed to destroy shell"}), 500
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    
    @bp.post('/terminal/<shell_id>/resize')
    def terminal_resize(shell_id):
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
        data = request.get_json(silent=True) or {}
        cols = int(data.get('cols', 80))
        rows = int(data.get('rows', 24))
        
        try:
            success = resize_editor_shell(shell_id, cols, rows)
            if success:
                return jsonify({"ok": True, "data": {"id": shell_id, "cols": cols, "rows": rows}})
            else:
                return jsonify({"ok": False, "error": "Failed to resize terminal"}), 500
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    
    @bp.get('/terminal/<shell_id>')
    def terminal_info(shell_id):
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
            mgr = _manager()
            rec = mgr.get_shell(shell_id)
            if not rec:
                return jsonify({"ok": False, "error": "Shell not found"}), 404
            
            # Parse query params
            include_logs = request.args.get('logs', 'false').lower() in {'1', 'true', 'yes'}
            tail_lines = 200
            try:
                if request.args.get('tail'):
                    tail_lines = max(0, int(request.args.get('tail')))
            except ValueError:
                pass
            
            info = mgr.describe(rec, include_logs=include_logs, tail_lines=tail_lines)
            return jsonify({"ok": True, "data": info})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    
    
    @sock.route('/ws/terminal/<shell_id>')
    def terminal_ws(ws, shell_id):
        """
        WebSocket endpoint for bidirectional PTY streaming.
        
        Flow:
            1. Subscribe to PTY output queue
            2. Start thread to forward PTY output → WebSocket
            3. Forward WebSocket input → PTY
            4. Clean up on disconnect
        
        Args:
            ws: WebSocket connection
            shell_id: Shell session ID
        """
        mgr = _manager()
        
        # Subscribe to PTY output
        try:
            output_queue = mgr.subscribe_output(shell_id)
        except Exception as e:
            try:
                ws.close()
            except:
                pass
            return
        
        stop_event = threading.Event()
        
        def forward_pty_to_ws():
            """Forward PTY output to WebSocket client"""
            import queue as _queue
            while not stop_event.is_set():
                try:
                    chunk = output_queue.get(timeout=0.5)
                except _queue.Empty:
                    continue
                
                try:
                    ws.send(chunk)
                except Exception:
                    stop_event.set()
                    break
        
        # Start PTY → WebSocket forwarding thread
        forward_thread = threading.Thread(target=forward_pty_to_ws, daemon=True)
        forward_thread.start()
        
        # Register shell for edit tracking
        edit_tracker.register_shell_watcher(shell_id, 'terminal')
        
        try:
            # Forward WebSocket → PTY
            while not stop_event.is_set():
                msg = ws.receive()
                if msg is None:
                    break
                
                try:
                    mgr.write_to_pty(shell_id, msg)
                except Exception:
                    pass
        finally:
            # Clean up
            stop_event.set()
            
            # Unregister shell from edit tracking
            edit_tracker.unregister_shell_watcher(shell_id)
            
            try:
                forward_thread.join(timeout=1.0)
            except Exception:
                pass
            
            try:
                mgr.unsubscribe_output(shell_id, output_queue)
            except Exception:
                pass
