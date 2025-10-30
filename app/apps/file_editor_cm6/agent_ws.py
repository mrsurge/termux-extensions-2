# app/apps/file_editor_cm6/agent_ws.py

"""
WebSocket endpoint for agent communication.

Provides bidirectional WebSocket relay between browser and agent processes,
with protocol normalization and line-buffered JSON parsing.

Architecture:
- ONE shared framework shell per agent type (codex, gemini)
- Multiple UI sessions share the same shell process
- Sessions are multiplexed via conversationId in messages
"""

import json
import os
import queue
import threading
import uuid
from flask import request
from .agent_bridge import get_bridge, enrich_context

# Global registry of shared shells: agent_type -> (session_id, shell_id)
_shared_shells = {}


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
        
        ONE shared shell per agent type - multiple UI sessions multiplex via conversationId.
        
        Query parameters:
            agent: Agent type - 'codex' or 'gemini' (default: 'codex')
            cwd: Working directory (optional, defaults to home)
            file: Current file path for context enrichment (optional)
        
        Message Flow:
            Frontend → WebSocket → Bridge → Shared Agent Process
            Shared Agent Process → Bridge → WebSocket → Frontend
        
        Frontend sends normalized messages with conversationId:
            {"id":"42","action":"chat","text":"Explain","conversationId":"abc-123"}
        
        Frontend receives normalized events:
            {"id":"42","event":"token","text":"partial..."}
            {"id":"42","event":"conversation_started","conversationId":"abc-123"}
        """
        bridge = get_bridge()
        global _shared_shells
        
        # Parse query parameters
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
        
        # Get or create THE SINGLE shared shell for this agent type
        session_id = None
        shell_id = None
        
        if agent_type in _shared_shells:
            session_id, shell_id = _shared_shells[agent_type]
            
            # Check if shell is still alive
            try:
                shell = bridge.manager.describe(shell_id)
                if not shell or not shell.get('alive'):
                    # Shell died - need to respawn
                    session_id = None
                    shell_id = None
                    del _shared_shells[agent_type]
            except Exception:
                session_id = None
                shell_id = None
                if agent_type in _shared_shells:
                    del _shared_shells[agent_type]
        
        # Spawn shared shell if needed
        if not shell_id:
            try:
                session_id = f'shared-{agent_type}-{uuid.uuid4().hex[:8]}'
                agent = bridge.spawn_agent(agent_type, cwd or os.path.expanduser('~'), session_id)
                shell_id = agent['id']
                _shared_shells[agent_type] = (session_id, shell_id)
                
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
        
        # Send shell metadata to frontend
        try:
            ws.send(json.dumps({
                'event': 'connected',
                'agent': agent_type,
                'shell_id': shell_id,
                'session_id': session_id,  # Shared session ID for send_raw endpoint
                'cwd': cwd
            }))
        except:
            pass
        
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
        
        # Initialize MCP for Codex
        if agent_type == 'codex':
            try:
                init_msg = {
                    'jsonrpc': '2.0',
                    'id': 'init-mcp',
                    'method': 'initialize',
                    'params': {
                        'protocolVersion': '2024-11-05',
                        'capabilities': {},
                        'clientInfo': {
                            'name': 'code_cm6',
                            'version': '1.0.0'
                        }
                    }
                }
                shell_id = bridge._sessions.get(session_id)
                if shell_id:
                    bridge.manager.write_to_pty(shell_id, json.dumps(init_msg) + '\n')
            except Exception as e:
                print(f'Failed to initialize Codex MCP: {e}')
        
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
                        # Store conversation ID for Codex MCP
                        if normalized.get('event') == 'conversation_started' and normalized.get('conversationId'):
                            from .agent_bridge import CodexAdapter
                            CodexAdapter.store_conversation_id(session_id, normalized['conversationId'])
                        
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
                    context = {'cwd': cwd} if cwd else {}
                    if file_path or message.get('file'):
                        file_context = enrich_context(
                            file_path=message.get('file') or file_path,
                            project_root=cwd
                        )
                        if file_context:
                            context.update(file_context)
                    
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
