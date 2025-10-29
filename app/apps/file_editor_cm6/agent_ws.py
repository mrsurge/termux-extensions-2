# app/apps/file_editor_cm6/agent_ws.py

"""
WebSocket endpoint for agent communication.

Provides bidirectional WebSocket relay between browser and agent processes,
with protocol normalization and line-buffered JSON parsing.
"""

import json
import queue
import threading
import uuid
from flask import request
from .agent_bridge import get_bridge, enrich_context


def register_agent_websocket(sock):
    """
    Register agent WebSocket endpoint.
    
    Args:
        sock: Flask-Sock instance
    """
    
    @sock.route('/ws/agent')
    def agent_websocket(ws):
        """
        WebSocket endpoint for bidirectional agent communication.
        
        Query parameters:
            session: Session ID (optional, auto-generated if not provided)
            agent: Agent type - 'codex' or 'gemini' (default: 'codex')
            cwd: Working directory (optional, defaults to home)
            file: Current file path for context enrichment (optional)
        
        Message Flow:
            Frontend → WebSocket → Bridge → Agent Process
            Agent Process → Bridge → WebSocket → Frontend
        
        Frontend sends normalized messages:
            {"id":"42","action":"chat","text":"Explain this code","target":"codex"}
        
        Frontend receives normalized events:
            {"id":"42","event":"token","text":"partial..."}
            {"id":"42","event":"diff","path":"/file.py","patch":"@@..."}
            {"id":"42","event":"final","ok":true,"output":{...}}
        """
        bridge = get_bridge()
        
        # Parse query parameters
        session_id = request.args.get('session', str(uuid.uuid4()))
        agent_type = request.args.get('agent', 'codex')
        cwd = request.args.get('cwd', None)
        file_path = request.args.get('file', None)
        
        # Validate agent type
        if agent_type not in ['codex', 'gemini']:
            try:
                ws.send(json.dumps({
                    'event': 'error',
                    'error': f'Invalid agent type: {agent_type}. Must be "codex" or "gemini".'
                }))
                ws.close()
            except:
                pass
            return
        
        # Get or spawn agent
        try:
            agent = bridge.get_or_create_agent(session_id, agent_type, cwd)
            shell_id = agent['id']
        except Exception as e:
            try:
                ws.send(json.dumps({
                    'event': 'error',
                    'error': f'Failed to spawn agent: {str(e)}'
                }))
                ws.close()
            except:
                pass
            return
        
        # Subscribe to agent output
        try:
            output_queue = bridge.subscribe_output(session_id)
        except Exception as e:
            try:
                ws.send(json.dumps({
                    'event': 'error',
                    'error': f'Failed to subscribe to agent output: {str(e)}'
                }))
                ws.close()
            except:
                pass
            return
        
        stop_event = threading.Event()
        line_buffer = ""
        
        def forward_agent_to_ws():
            """
            Forward agent output to WebSocket.
            Reads chunks from PTY, buffers lines, parses JSON, normalizes, and sends to WS.
            """
            nonlocal line_buffer
            
            while not stop_event.is_set():
                try:
                    chunk = output_queue.get(timeout=0.5)
                except queue.Empty:
                    continue
                
                # Buffer chunks and extract complete lines
                line_buffer += chunk
                
                while '\n' in line_buffer:
                    line, line_buffer = line_buffer.split('\n', 1)
                    line = line.strip()
                    
                    if not line:
                        continue
                    
                    # Parse and normalize agent output
                    normalized = bridge.parse_agent_output(agent_type, line)
                    
                    if normalized:
                        try:
                            ws.send(json.dumps(normalized))
                        except Exception:
                            stop_event.set()
                            break
        
        # Start agent → WebSocket forwarding thread
        forward_thread = threading.Thread(target=forward_agent_to_ws, daemon=True)
        forward_thread.start()
        
        try:
            # Forward WebSocket → Agent
            while not stop_event.is_set():
                data = ws.receive()
                if data is None:
                    break
                
                try:
                    # Parse frontend message
                    message = json.loads(data)
                    
                    # Override target if specified in message
                    msg_agent_type = message.get('target', agent_type)
                    
                    # Enrich context if file path provided
                    context = None
                    if file_path or message.get('file'):
                        context = enrich_context(
                            file_path=message.get('file') or file_path,
                            project_root=cwd
                        )
                    
                    # Write to agent with protocol translation
                    bridge.write_message(session_id, msg_agent_type, message, context)
                    
                except json.JSONDecodeError:
                    # Invalid JSON from frontend
                    try:
                        ws.send(json.dumps({
                            'event': 'error',
                            'error': 'Invalid JSON from client'
                        }))
                    except:
                        pass
                except Exception as e:
                    # Error writing to agent
                    try:
                        ws.send(json.dumps({
                            'event': 'error',
                            'error': f'Failed to send to agent: {str(e)}'
                        }))
                    except:
                        pass
        
        finally:
            # Clean up
            stop_event.set()
            
            try:
                forward_thread.join(timeout=1.0)
            except Exception:
                pass
            
            try:
                bridge.unsubscribe_output(session_id, output_queue)
            except Exception:
                pass
            
            # Note: We don't terminate the agent here - keep it alive for reconnection
