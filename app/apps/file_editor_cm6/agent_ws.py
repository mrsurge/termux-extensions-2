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
from .conversation_store import get_session, clear_conversation_id, append_message, update_session_metadata
from . import edit_tracker
from .conversation_utils import build_transcript

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


async def agent_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for bidirectional agent communication.
    """
    await websocket.accept()
    bridge = get_bridge()
    manager = await bridge.get_manager()
    global _shared_shells
    request_session_map = {}
    request_map_lock = asyncio.Lock()
    
    agent_type = websocket.query_params.get('agent', 'codex')
    cwd = websocket.query_params.get('cwd', None)
    file_path = websocket.query_params.get('file', None)
    requested_session_id = websocket.query_params.get('session', None)
        
    if agent_type not in ['codex', 'gemini']:
        # ... (error handling as before)
        return
    
    # ... (shell spawning logic as before)

    # --- This point forward is the refactored logic ---

    line_buffer = ""
    
    async def forward_agent_to_ws():
        nonlocal line_buffer
        output_queue = await bridge.subscribe_output(session_id)
        while True:
            try:
                chunk = await asyncio.wait_for(output_queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            
            line_buffer += chunk
            
            while '\n' in line_buffer:
                line, line_buffer = line_buffer.split('\n', 1)
                line = line.strip()
                if not line:
                    continue
                
                try:
                    agent_msg = json.loads(line)
                except json.JSONDecodeError:
                    continue

                normalized = bridge.parse_agent_output(agent_type, line)
                if not normalized:
                    continue

                request_id = str(normalized.get("id", ""))
                async with request_map_lock:
                    chat_session = request_session_map.get(request_id) or requested_session_id

                if not chat_session:
                    continue
                
                normalized["session"] = chat_session
                event = normalized.get("event")

                if event == "token":
                    pass # Handled by adapter
                elif event == "conversation_started":
                    conversation_id = normalized.get("conversationId")
                    if conversation_id:
                        update_session_metadata(chat_session, conversationId=conversation_id, shell_id=shell_id)
                elif event == "system":
                    append_message(chat_session, {"id": f"msg-{uuid.uuid4().hex}", "type": "system", "text": normalized.get("text", ""), "timestamp": time.time()})
                elif event == "tool_call":
                    append_message(chat_session, {"id": f"msg-{uuid.uuid4().hex}", "type": "tool_call", "tool": normalized.get("tool", ""), "args": normalized.get("args", {}), "timestamp": time.time()})
                elif event == "diff":
                    append_message(chat_session, {"id": f"msg-{uuid.uuid4().hex}", "type": "diff", "path": normalized.get("path", ""), "patch": normalized.get("patch", ""), "timestamp": time.time()})
                elif event == "final":
                    from .agent_bridge import CodexAdapter
                    complete_text = CodexAdapter.get_complete_message(request_id)
                    append_message(chat_session, {"id": request_id, "type": "assistant", "text": complete_text, "timestamp": time.time()})
                    async with request_map_lock:
                        request_session_map.pop(request_id, None)
                elif event == "error":
                    error_text = normalized.get("error") or "Agent error"
                    append_message(chat_session, {"id": request_id or f"msg-{uuid.uuid4().hex}", "type": "error", "text": error_text, "timestamp": time.time()})
                    if request_id:
                        async with request_map_lock:
                            request_session_map.pop(request_id, None)
                
                try:
                    await websocket.send_text(json.dumps(normalized))
                except Exception:
                    break
    
    forward_task = asyncio.create_task(forward_agent_to_ws())
    
    try:
        async for data in websocket.iter_text():
            try:
                message = json.loads(data)
                chat_session_id = message.get('session') or requested_session_id
                if not chat_session_id:
                    continue

                session = get_session(chat_session_id)
                if not session:
                    continue

                _base_instructions, transcript_text = build_transcript(session.get("messages", []))
                stored_shell = session.get("shell_id")
                stored_conversation = session.get("conversationId")
                needs_restore = bool(transcript_text) and (not stored_conversation or (stored_shell and stored_shell != shell_id))
                
                original_text = message.get("text", "")
                if needs_restore:
                    message["text"] = f"{transcript_text}\n\nUser: {original_text}"
                    message["conversationId"] = None
                    from .agent_bridge import CodexAdapter
                    CodexAdapter.clear_conversation(chat_session_id)
                elif stored_conversation:
                    message["conversationId"] = stored_conversation
                else:
                    message["conversationId"] = None

                context = {'cwd': cwd} if cwd else {}
                # ... (context enrichment as before)

                request_id = f"msg-{uuid.uuid4().hex}"
                message["id"] = request_id
                async with request_map_lock:
                    request_session_map[request_id] = chat_session_id
                
                append_message(chat_session_id, {"id": request_id, "type": "user", "text": original_text, "timestamp": time.time()})
                update_session_metadata(chat_session_id, shell_id=shell_id)

                await bridge.write_message(session_id, agent_type, message, context)
            except (json.JSONDecodeError, KeyError):
                continue
    finally:
        forward_task.cancel()
