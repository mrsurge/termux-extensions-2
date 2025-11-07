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

import asyncio
import json
import os
import uuid
from typing import Optional
from fastapi import WebSocket
from .agent_bridge import get_bridge, enrich_context
from .agent_session_store import get_session, clear_conversation_id
from . import edit_tracker

# Global registry of shared shells: agent_type -> (session_id, shell_id)
_shared_shells = {}
_initialized_shells = set()


def _debug_log(stage: str, message: str) -> None:
    """Lightweight debug print with consistent prefix."""
    print(f"[AgentDrawer][{stage}] {message}")


def _normalize_conversation_id(value):
    """Treat empty/null-like strings as no conversation."""
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return None
        lowered = trimmed.lower()
        if lowered in {'null', 'none', 'undefined'}:
            return None
        return trimmed
    return None


def _build_history_payload(messages):
    if not isinstance(messages, list) or not messages:
        return '', ''

    transcript_lines = []
    for entry in messages:
        if not isinstance(entry, dict):
            continue
        text = entry.get('text') or entry.get('output')
        if not text:
            continue
        msg_type = entry.get('type')
        if msg_type == 'user':
            transcript_lines.append(f'User: {text}')
        elif msg_type in ('assistant', 'final'):
            transcript_lines.append(f'Assistant: {text}')
        elif msg_type == 'system':
            transcript_lines.append(f'System: {text}')

    transcript = '\n'.join(transcript_lines)
    base_instructions = (
        "Resume the prior conversation.\n"
        "You will receive the previous transcript followed by the user's latest message.\n"
        "Use that transcript to maintain continuity."
    )
    return base_instructions, transcript


async def agent_websocket(websocket: WebSocket):
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
    await websocket.accept()
    bridge = get_bridge()
    manager = await bridge.get_manager()
    global _shared_shells
    request_session_map = {}
    request_map_lock = asyncio.Lock()
    
    # Parse query parameters
    agent_type = websocket.query_params.get('agent', 'codex')
    cwd = websocket.query_params.get('cwd', None)
    file_path = websocket.query_params.get('file', None)
    requested_session_id = websocket.query_params.get('session', None)
        
    # Validate agent type
    if agent_type not in ['codex', 'gemini']:
        try:
            await websocket.send_text(json.dumps({
                'event': 'error',
                'error': f'Invalid agent type: {agent_type}. Must be "codex" or "gemini".'
            }))
            await websocket.close()
        except:
            pass
        return
    
    async def _send_connected_event(current_shell_id: str, current_session_id: str, replaced_from: Optional[str] = None):
        """Emit the connected event expected by the frontend handshake."""
        payload = {
            'event': 'connected',
            'agent': agent_type,
            'shell_id': current_shell_id,
            'session_id': current_session_id,
            'cwd': cwd,
        }
        try:
            await websocket.send_text(json.dumps(payload))
            if replaced_from and replaced_from != current_shell_id:
                await websocket.send_text(json.dumps({
                    'event': 'shell_replaced',
                    'agent': agent_type,
                    'old_shell_id': replaced_from,
                    'shell_id': current_shell_id,
                    'session_id': current_session_id,
                }))
        except Exception:
            pass

    # Get or create THE SINGLE shared shell for this agent type
    # First, try to find existing shell by label (survives worker restarts)
    label = f"agent-{agent_type}-shared-c"  # Consistent label for shared shell
    session_id = requested_session_id
    shell_id = None
    connected_sent = False
    
    # Try to find existing shell by label (survives worker restarts)
    existing_shell = await manager.find_shell_by_label(label, status='running')
    if existing_shell:
        shell_id = existing_shell.id
        if not session_id:
            cached = _shared_shells.get(agent_type)
            session_id = cached[0] if cached else f'shared-{agent_type}'
        bridge.attach_session(session_id, shell_id)
        _shared_shells[agent_type] = (session_id, shell_id)
        print(f'[Agent WS] Found existing {agent_type} shell: {shell_id}')
        await _send_connected_event(shell_id, session_id)
        connected_sent = True
        # FIX 1: Populate CodexAdapter._conversations from disk on connection
        if requested_session_id:
            from .agent_bridge import CodexAdapter
            saved = get_session(requested_session_id)
            if saved and saved.get('conversationId'):
                CodexAdapter.store_conversation_id(requested_session_id, saved['conversationId'])
                print(f"[Agent WS] Restored conversation ID {saved['conversationId'][:8]}... for session {requested_session_id}")
    else:
        # Fallback: use in-memory registry if still valid
        cached = _shared_shells.get(agent_type)
        if cached:
            cached_session, cached_shell = cached
            record = await manager.get_shell(cached_shell)
            if record and record.status == 'running':
                shell_id = cached_shell
                session_id = session_id or cached_session
                bridge.attach_session(session_id, shell_id)
                await _send_connected_event(shell_id, session_id)
                connected_sent = True
                # FIX 1: Restore conversation ID mapping for cached shell
                if requested_session_id:
                    from .agent_bridge import CodexAdapter
                    saved = get_session(requested_session_id)
                    if saved and saved.get('conversationId'):
                        CodexAdapter.store_conversation_id(requested_session_id, saved['conversationId'])
                        print(f"[Agent WS] Restored conversation ID {saved['conversationId'][:8]}... for session {requested_session_id}")
            else:
                _shared_shells.pop(agent_type, None)
                _initialized_shells.discard(cached_shell)
    
    original_shell_id = shell_id
    
    # Spawn shared shell if needed
    if not shell_id:
        try:
            session_id = session_id or f'shared-{agent_type}-{uuid.uuid4().hex[:8]}'
            shell_info = await bridge.spawn_agent(agent_type, cwd or os.path.expanduser('~'), session_id)
            shell_id = shell_info['id']
            bridge.attach_session(session_id, shell_id)
            _shared_shells[agent_type] = (session_id, shell_id)
        except Exception as e:
            try:
                await websocket.send_text(json.dumps({
                    'event': 'error',
                    'error': f'Failed to spawn agent: {str(e)}'
                }))
                await websocket.close()
            except:
                pass
            return
        
        bridge.update_session_shell(session_id, shell_id)

        # Send shell metadata to frontend
        await _send_connected_event(shell_id, session_id, replaced_from=original_shell_id)
        connected_sent = True

    # If we reused a shell but never emitted the handshake (shouldn't happen, defensive)
    if shell_id and not connected_sent:
        await _send_connected_event(shell_id, session_id, replaced_from=original_shell_id)

    # Subscribe to agent output
    try:
        output_queue = await bridge.subscribe_output(session_id)
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({
                'event': 'error',
                'error': f'Failed to subscribe to agent output: {str(e)}'
            }))
            await websocket.close()
        except:
            pass
        return
    
    # Initialize MCP for Codex once per shell lifetime
    if agent_type == 'codex' and shell_id and shell_id not in _initialized_shells:
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
                await manager.write_to_pty(shell_id, json.dumps(init_msg) + '\n')
                _initialized_shells.add(shell_id)
        except Exception as e:
            print(f'Failed to initialize Codex MCP: {e}')
    
    line_buffer = ""
    
    async def forward_agent_to_ws():
        """
        Forward agent output to WebSocket.
        Reads chunks from PTY, buffers lines, parses JSON, normalizes, and sends to WS.
        """
        nonlocal line_buffer
        
        while True:
            try:
                chunk = await asyncio.wait_for(output_queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
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
                    request_id = normalized.get('id')
                    session_key = None
                    if request_id is not None:
                        async with request_map_lock:
                            session_key = request_session_map.get(str(request_id))
                    if session_key:
                        normalized.setdefault('session', session_key)

                    # Store conversation ID for Codex MCP
                    if normalized.get('event') == 'conversation_started' and normalized.get('conversationId'):
                        target_session = session_key or session_id
                        from .agent_bridge import CodexAdapter
                        from .agent_session_store import update_session_metadata
                        CodexAdapter.store_conversation_id(target_session, normalized['conversationId'])
                        bridge.note_conversation(target_session, normalized['conversationId'])
                        if session_key:
                            # Persist conversation ID immediately
                            update_session_metadata(session_key, conversationId=normalized['conversationId'], shell_id=shell_id)
                        # DON'T remove from request_session_map yet - we need it for 'final' event!

                    # Persist agent messages to session
                    if session_key:
                        event_type = normalized.get('event')
                        from .agent_session_store import append_message
                        import time
                        
                        try:
                            # Handle different message types
                            if event_type == 'token':
                                # Streaming assistant response - skip persistence of tokens; final persists output
                                pass
                            
                            elif event_type == 'final':
                                # Complete assistant response
                                final_text = normalized.get('text', '')
                                append_message(session_key, {
                                    'id': f"msg-{request_id}",
                                    'type': 'assistant',
                                    'text': final_text,
                                    'timestamp': time.time()
                                })
                            
                            elif event_type == 'system':
                                # System messages (planning, etc.)
                                append_message(session_key, {
                                    'id': str(uuid.uuid4()),
                                    'type': 'system',
                                    'text': normalized.get('text', ''),
                                    'timestamp': time.time()
                                })
                            
                            elif event_type == 'error':
                                # Error messages
                                append_message(session_key, {
                                    'id': str(uuid.uuid4()),
                                    'type': 'error',
                                    'error': normalized.get('error', ''),
                                    'timestamp': time.time()
                                })
                            
                            elif event_type == 'planning':
                                # Planning messages
                                append_message(session_key, {
                                    'id': str(uuid.uuid4()),
                                    'type': 'planning',
                                    'summary': normalized.get('summary', ''),
                                    'timestamp': time.time()
                                })
                            
                            elif event_type == 'tool_call':
                                # Tool usage
                                append_message(session_key, {
                                    'id': str(uuid.uuid4()),
                                    'type': 'tool_call',
                                    'tool': normalized.get('tool', ''),
                                    'args': normalized.get('args', {}),
                                    'timestamp': time.time()
                                })
                            
                            elif event_type == 'diff':
                                # Diff messages
                                append_message(session_key, {
                                    'id': str(uuid.uuid4()),
                                    'type': 'diff',
                                    'path': normalized.get('path', ''),
                                    'patch': normalized.get('patch', ''),
                                    'timestamp': time.time()
                                })
                            
                        except Exception as e:
                            print(f"[Agent WS] Failed to persist agent message: {e}")
                    
                    # Clean up request map AFTER persistence
                    if normalized.get('event') in ('final', 'error') and request_id is not None:
                        async with request_map_lock:
                            request_session_map.pop(str(request_id), None)
                    
                    try:
                        await websocket.send_text(json.dumps(normalized))
                    except Exception:
                        break
        
        forward_task = asyncio.create_task(forward_agent_to_ws())
        
        # Register shell for edit tracking
        edit_tracker.register_shell_watcher(shell_id, 'agent')
        
        try:
            # Forward WebSocket → Agent
            async for data in websocket.iter_text():
                try:
                    # Parse frontend message
                    message = json.loads(data)
                    if 'conversationId' in message:
                        normalized_conv = _normalize_conversation_id(message.get('conversationId'))
                        if normalized_conv is None:
                            message.pop('conversationId', None)
                        else:
                            message['conversationId'] = normalized_conv
                    
                    # Override target if specified in message
                    msg_agent_type = message.get('target', agent_type)

                    chat_session_id = message.get('session') or requested_session_id or session_id
                    _debug_log(
                        "WS<-Client",
                        f"id={message.get('id')} target={msg_agent_type} "
                        f"chat_session={chat_session_id} shared_session={session_id} "
                        f"text={str(message.get('text', ''))[:120]!r}"
                    )
                    if not chat_session_id:
                        try:
                            await websocket.send_text(json.dumps({
                                'event': 'error',
                                'error': 'Missing session identifier for agent message'
                            }))
                        except Exception:
                            pass
                        continue

                    saved_session = get_session(chat_session_id)
                    history_instructions = ''
                    history_transcript = ''
                    needs_restore = False
                    approval_policy = None
                    sandbox = None
                    stored_conversation = None

                    if saved_session:
                        history_instructions, history_transcript = _build_history_payload(saved_session.get('messages', []))
                        stored_conversation = _normalize_conversation_id(saved_session.get('conversationId'))
                        saved_shell = saved_session.get('shell_id')

                        # FIX 2: Simplified needs_restore logic
                        # Restore conversation if:
                        # 1. Shell ID changed (server restarted), OR
                        # 2. No conversation ID stored at all, OR
                        # 3. Conversation ID not in memory (defensive check)
                        from .agent_bridge import CodexAdapter

                        if history_transcript:
                            if saved_shell and saved_shell != shell_id:
                                needs_restore = True
                            elif not stored_conversation:
                                needs_restore = True
                            elif not CodexAdapter._conversations.get(chat_session_id):
                                needs_restore = True

                        if saved_session.get('fullAccess'):
                            approval_policy = 'never'
                            sandbox = 'danger-full-access'
                        elif saved_session.get('auto'):
                            approval_policy = 'never'
                            sandbox = 'workspace-write'

                    if needs_restore:
                        clear_conversation_id(chat_session_id)
                        stored_conversation = None

                    # Persist shell_id update immediately
                    from .agent_session_store import update_session_metadata
                    update_session_metadata(chat_session_id, shell_id=shell_id)

                    # Enrich context if file path provided
                    context = {'cwd': cwd} if cwd else {}
                    if file_path or message.get('file'):
                        file_context = enrich_context(
                            file_path=message.get('file') or file_path,
                            project_root=cwd
                        )
                        if file_context:
                            context.update(file_context)

                    if approval_policy:
                        context.setdefault('approval_policy', approval_policy)
                    if sandbox:
                        context.setdefault('sandbox', sandbox)

                    # FIX 3: Proper conversation ID routing
                    _debug_log(
                        "WS:conversation",
                        f"needs_restore={needs_restore} has_history={bool(history_transcript)} "
                        f"stored_conv={stored_conversation} chat_session={chat_session_id}"
                    )
                    if needs_restore and history_transcript:
                        _debug_log("WS:conversation", f"Restoring history size={len(history_transcript)} chars")
                        message['text'] = f"{history_transcript}\n\nUser: {message.get('text', '')}"
                        message['conversationId'] = None
                    elif stored_conversation:
                        _debug_log("WS:conversation", f"Using stored conversation {stored_conversation[:8]}…")
                        message['conversationId'] = stored_conversation
                        from .agent_bridge import CodexAdapter
                        if not CodexAdapter._conversations.get(chat_session_id):
                            CodexAdapter.store_conversation_id(chat_session_id, stored_conversation)
                    else:
                        _debug_log("WS:conversation", "New conversation (no history)")
                        message['conversationId'] = None

                    _debug_log("WS:conversation", f"Final conversationId={message.get('conversationId')}")

                    bridge.set_session_state(chat_session_id, {
                        'history_instructions': history_instructions,
                        'history_transcript': history_transcript,
                        'needs_restore': needs_restore,
                        'approval_policy': approval_policy,
                        'sandbox': sandbox,
                        'conversation_id': (None if needs_restore else stored_conversation),
                        'shell_id': shell_id,
                    })

                    bridge.update_session_shell(chat_session_id, shell_id)

                    req_id = message.get('id')
                    if req_id is not None:
                        async with request_map_lock:
                            request_session_map[str(req_id)] = chat_session_id

                    # Persist user message to session (BEFORE sending to agent)
                    from .agent_session_store import append_message
                    import time
                    user_msg_id = str(uuid.uuid4())
                    try:
                        append_message(chat_session_id, {
                            'id': user_msg_id,
                            'type': 'user',
                            'text': message.get('text', ''),
                            'timestamp': time.time()
                        })
                    except Exception as e:
                        print(f"[Agent WS] Failed to persist user message: {e}")

                    # Write to agent with protocol translation
                    _debug_log(
                        "WS->Bridge",
                        f"shared_session={session_id} chat_session={chat_session_id} shell={shell_id} "
                        f"req_id={req_id} conv={message.get('conversationId')} "
                        f"context_keys={sorted(context.keys()) if context else []}"
                    )
                    await bridge.write_message(session_id, msg_agent_type, message, context)
                    
                except json.JSONDecodeError:
                    # Invalid JSON from frontend
                    try:
                        await websocket.send_text(json.dumps({
                            'event': 'error',
                            'error': 'Invalid JSON from client'
                        }))
                    except:
                        pass
                except Exception as e:
                    # Error writing to agent
                    try:
                        await websocket.send_text(json.dumps({
                            'event': 'error',
                            'error': f'Failed to send to agent: {str(e)}'
                        }))
                    except:
                        pass
        
        finally:
            # Clean up
            forward_task.cancel()
            
            # Unregister shell from edit tracking
            edit_tracker.unregister_shell_watcher(shell_id)
            
            try:
                await bridge.unsubscribe_output(session_id, output_queue)
            except Exception:
                pass
            
            # Note: We don't terminate the agent here - keep it alive for reconnection
