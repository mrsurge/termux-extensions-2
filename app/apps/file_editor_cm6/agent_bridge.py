# app/apps/file_editor_cm6/agent_bridge.py

"""
Agent Bridge - Protocol normalization layer for Codex and Gemini agents.

Provides a unified API for the frontend while handling protocol translation
between Codex app-server and Gemini ACP formats. Uses framework shells for
process lifecycle management.
"""

import json
import os
from typing import Dict, List, Optional, Any
from pathlib import Path
from app.libs.framework_shells import FrameworkShellManager, get_manager as _manager

def _debug_log(stage: str, message: str) -> None:
    print(f"[AgentDrawer][{stage}] {message}")


def _normalize_conversation_id(value: Any) -> Optional[str]:
    """Normalize conversation IDs coming from various layers."""
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


class CodexAdapter:
    """
    Protocol adapter for Codex MCP server.
    Implements full MCP (Model Context Protocol) flow.
    """
    
    # Track conversation IDs per session
    _conversations = {}
    
    # Track last complete message per request (for persistence)
    _last_messages = {}

    @staticmethod
    def store_message_chunk(request_id: str, text: str):
        """Appends a chunk of a streaming message to a buffer."""
        if request_id not in CodexAdapter._last_messages:
            CodexAdapter._last_messages[request_id] = []
        CodexAdapter._last_messages[request_id].append(text)

    @staticmethod
    def get_complete_message(request_id: str) -> str:
        """Retrieves the complete message and clears the buffer."""
        return "".join(CodexAdapter._last_messages.pop(request_id, []))
    
    @staticmethod
    def to_agent(normalized: dict, context: Optional[dict] = None) -> dict:
        """
        Convert normalized frontend message to Codex MCP tool call.
        
        MCP flow:
        1. Initialize (sent automatically on connection)
        2. tools/call with "codex" or "codex-reply" tool
        
        Normalized format:
            {"id": "42", "action": "chat", "text": "...", "context": {...}}
        
        Codex MCP format (JSON-RPC 2.0 tool call):
            {"jsonrpc": "2.0", "id": 42, "method": "tools/call", "params": {...}}
        """
        msg_id = normalized.get('id')
        text = normalized.get('text', '')
        ctx = context or normalized.get('context', {})
        session_id = normalized.get('session', 'default')
        
        # Check if conversationId was passed from frontend (for session restore)
        conversation_id = normalized.get('conversationId') or CodexAdapter._conversations.get(session_id)
        
        if conversation_id:
            # Continue existing conversation
            tool_name = 'codex-reply'
            tool_params = {
                'conversationId': conversation_id,
                'prompt': text
            }
        else:
            # Start new conversation
            tool_name = 'codex'
            tool_params = {
                'prompt': text,
                'cwd': ctx.get('cwd', os.path.expanduser('~'))
            }
            
            
            # Add approval policy and sandbox settings if provided
            if ctx.get('approval_policy'):
                tool_params['approval-policy'] = ctx['approval_policy']
            if ctx.get('sandbox'):
                tool_params['sandbox'] = ctx['sandbox']
            
            # Add file context if available
            if ctx.get('file_path') and ctx.get('file_content'):
                tool_params['prompt'] = f"""File: {ctx['file_path']}
Language: {ctx.get('language', 'unknown')}

Content:
```
{ctx['file_content']}
```

{text}"""
        
        # Build MCP tool call
        mcp_msg = {
            'jsonrpc': '2.0',
            'id': msg_id,
            'method': 'tools/call',
            'params': {
                'name': tool_name,
                'arguments': tool_params
            }
        }
        
        return mcp_msg
    
    @staticmethod
    def from_agent(mcp_msg: dict) -> dict:
        """
        Convert Codex MCP response to normalized format.
        
        MCP responses can be:
        - Initialization result
        - Tool call result (with conversationId)
        - Progress notifications
        - Errors
        """
        # Handle initialization response
        if mcp_msg.get('result', {}).get('serverInfo', {}).get('name') == 'codex-mcp-server':
            return {
                'id': str(mcp_msg.get('id')),
                'event': 'initialized',
                'agent': 'codex',
                'result': mcp_msg['result']
            }
        
        # Handle tool call result
        if 'result' in mcp_msg:
            result = mcp_msg['result']
            
            # Extract conversation ID if present (for first message)
            if isinstance(result, dict) and 'conversationId' in result:
                # Store conversation ID for future messages
                conv_id = result['conversationId']
                # We need to know which session this belongs to - this is tricky
                # For now, we'll include it in the response and let the handler deal with it
                return {
                    'id': str(mcp_msg.get('id')),
                    'event': 'conversation_started',
                    'agent': 'codex',
                    'conversationId': conv_id
                }
            
            # Handle content/response
            if isinstance(result, list):
                # MCP returns tool results as array of content blocks
                for item in result:
                    if item.get('type') == 'text':
                        return {
                            'id': str(mcp_msg.get('id')),
                            'event': 'final',
                            'agent': 'codex',
                            'text': item.get('text', ''),
                            'ok': True
                        }
            
            return {
                'id': str(mcp_msg.get('id')),
                'event': 'result',
                'agent': 'codex',
                'result': result
            }
        
        # Handle notifications (streaming, progress, etc.)
        if 'method' in mcp_msg:
            method = mcp_msg['method']
            params = mcp_msg.get('params', {})
            
            # Codex-specific event notifications
            if method == 'codex/event':
                msg_data = params.get('msg', {})
                event_type = msg_data.get('type')
                request_id = params.get('_meta', {}).get('requestId')
                
                # DIRECT USER RESPONSES - these get normal bubbles
                if event_type == 'agent_message_delta':
                    # Streaming token - DIRECT RESPONSE
                    request_id_str = str(request_id)
                    delta = msg_data.get('delta', '')
                    CodexAdapter.store_message_chunk(request_id_str, delta)
                    return {
                        'id': request_id_str,
                        'event': 'token',
                        'agent': 'codex',
                        'text': delta
                    }
                elif event_type == 'agent_message':
                    # Full message - not sent to UI (we use deltas for streaming)
                    return None
                
                # EVERYTHING ELSE - terminal/console style
                elif event_type == 'agent_reasoning_delta':
                    # Streaming reasoning tokens - display only, no persistence
                    return {
                        'id': str(request_id),
                        'event': 'system',
                        'agent': 'codex',
                        'text': msg_data.get('delta', ''),
                        'reasoning': True,
                        'complete': False
                    }
                elif event_type == 'agent_reasoning':
                    # Full reasoning block - persistable system message
                    return {
                        'id': str(request_id),
                        'event': 'system',
                        'agent': 'codex',
                        'text': msg_data.get('text', ''),
                        'reasoning': True,
                        'complete': True
                    }
                elif event_type == 'agent_reasoning_section_break':
                    # Section break during reasoning
                    return {
                        'id': str(request_id),
                        'event': 'system',
                        'agent': 'codex',
                        'text': '\n',
                        'reasoning': True,
                        'complete': False
                    }
                elif event_type == 'task_started':
                    # Task starting - SYSTEM MESSAGE
                    return {
                        'id': str(request_id),
                        'event': 'system',
                        'agent': 'codex',
                        'text': '[Task started]',
                        'complete': True,
                        'taskStarted': True
                    }
                elif event_type == 'task_complete':
                    # Task finished - use last_agent_message from the event itself
                    complete_text = msg_data.get('last_agent_message', '')
                    return {
                        'id': str(request_id),
                        'event': 'final',
                        'agent': 'codex',
                        'text': complete_text,  # Include full message for backend persistence
                        'ok': True
                    }
                elif event_type == 'session_configured':
                    # Session started - store conversation ID but don't show
                    return {
                        'id': str(request_id),
                        'event': 'conversation_started',
                        'agent': 'codex',
                        'conversationId': msg_data.get('session_id')
                    }
                elif event_type == 'exec_approval_request':
                    # Command needs approval - IGNORE (elicitation/create is the real one)
                    return None
                # Ignore everything else (token_count, etc.)
                return None
            
            # Elicitation requests (approval mechanism)
            if method == 'elicitation/create':
                params_data = params
                return {
                    'id': str(mcp_msg.get('id', '')),
                    'event': 'elicitation',
                    'agent': 'codex',
                    'elicitation_id': mcp_msg.get('id'),
                    'message': params_data.get('message'),
                    'call_id': params_data.get('codex_call_id'),
                    'command': params_data.get('codex_command'),
                    'cwd': params_data.get('codex_cwd'),
                    'tool_call_id': params_data.get('codex_mcp_tool_call_id')
                }
            
            # MCP progress notifications
            if method == 'notifications/progress':
                return {
                    'id': str(params.get('progressToken', '')),
                    'event': 'progress',
                    'agent': 'codex',
                    'progress': params.get('progress', 0),
                    'total': params.get('total', 100)
                }
            
            # MCP message notification
            if method == 'notifications/message':
                return {
                    'id': str(mcp_msg.get('id', '')),
                    'event': 'system',
                    'agent': 'codex',
                    'text': params.get('message', ''),
                    'level': params.get('level', 'info'),
                    'complete': True
                }
            
            # Generic notification - ignore unknown ones
            return None
        
        # Handle errors
        if 'error' in mcp_msg:
            error = mcp_msg['error']
            return {
                'id': str(mcp_msg.get('id')),
                'event': 'error',
                'agent': 'codex',
                'error': error.get('message'),
                'code': error.get('code')
            }
        
        return {'event': 'unknown', 'agent': 'codex'}
    
    @staticmethod
    def store_conversation_id(session_id: str, conversation_id: str):
        """Store conversation ID for a session."""
        CodexAdapter._conversations[session_id] = conversation_id
    
    @staticmethod
    def clear_conversation(session_id: str):
        """Clear conversation ID for a session."""
        CodexAdapter._conversations.pop(session_id, None)


class GeminiAdapter:
    """
    Protocol adapter for Gemini CLI (ACP mode).
    Translates between normalized messages and Gemini JSON-RPC format.
    """
    
    @staticmethod
    def to_agent(normalized: dict, context: Optional[dict] = None) -> dict:
        """
        Convert normalized frontend message to Gemini ACP format.
        
        Normalized format:
            {"id": "42", "action": "chat", "text": "...", "context": {...}}
        
        Gemini format:
            {"jsonrpc": "2.0", "id": 42, "method": "act", "params": {...}}
        """
        msg_id = normalized.get('id')
        action = normalized.get('action', 'chat')
        text = normalized.get('text', '')
        ctx = context or normalized.get('context', {})
        session_id = normalized.get('session', 'default')
        
        # Build input with context
        input_text = text
        if ctx.get('file_path') and ctx.get('file_content'):
            input_text = f"""File: {ctx['file_path']}
Language: {ctx.get('language', 'unknown')}
Git Status: {ctx.get('git_status', 'clean')}

Content:
```
{ctx['file_content']}
```

{text}"""
        
        # Build Gemini JSON-RPC message
        gemini_msg = {
            'jsonrpc': '2.0',
            'id': msg_id,
            'method': 'act',
            'params': {
                'session': session_id,
                'input': {
                    'type': 'text',
                    'text': input_text
                },
                'mode': normalized.get('mode', 'code')
            }
        }
        
        # Add buffers if provided
        if ctx.get('buffers'):
            gemini_msg['params']['buffers'] = ctx['buffers']
        
        return gemini_msg
    
    @staticmethod
    def from_agent(gemini_msg: dict) -> dict:
        """
        Convert Gemini ACP response to normalized format.
        
        Gemini format:
            {"jsonrpc": "2.0", "method": "token", "params": {"id": 3, "text": "..."}}
        
        Normalized format:
            {"id": "3", "event": "token", "text": "..."}
        """
        # Check if this is a notification (method) or response (result/error)
        if 'method' in gemini_msg:
            # Notification from agent
            method = gemini_msg['method']
            params = gemini_msg.get('params', {})
            msg_id = params.get('id')
            
            normalized = {
                'id': str(msg_id),
                'event': method,
                'agent': 'gemini'
            }
            
            # Map method-specific params
            if method == 'token':
                normalized['text'] = params.get('text', '')
            elif method == 'edit':
                normalized['path'] = params.get('path')
                normalized['patch'] = params.get('patch')
            elif method == 'progress':
                normalized['percent'] = params.get('pct', 0)
            elif method == 'final':
                normalized['ok'] = params.get('ok', True)
                normalized['output'] = params.get('output', {})
            
            return normalized
        
        elif 'error' in gemini_msg:
            # JSON-RPC error
            error = gemini_msg['error']
            return {
                'id': str(gemini_msg.get('id')),
                'event': 'error',
                'agent': 'gemini',
                'error': error.get('message'),
                'code': error.get('code'),
                'data': error.get('data', {})
            }
        
        elif 'result' in gemini_msg:
            # JSON-RPC result (e.g., capabilities)
            return {
                'id': str(gemini_msg.get('id')),
                'event': 'result',
                'agent': 'gemini',
                'result': gemini_msg['result']
            }
        
        return {'event': 'unknown', 'agent': 'gemini'}


class AgentBridge:
    """
    Main bridge coordinator for agent processes.
    Manages agent lifecycle via framework shells and handles protocol translation.
    """
    
    def __init__(self):
        self._sessions: Dict[str, str] = {}  # session_id -> shell_id
        self._session_state: Dict[str, Dict[str, Any]] = {}
        self._adapters = {
            'codex': CodexAdapter,
            'gemini': GeminiAdapter
        }
    
    async def _get_manager(self):
        """Get manager instance (lazy async initialization)."""
        if not hasattr(self, '_manager_instance'):
            self._manager_instance = await _manager()
        return self._manager_instance

    async def find_or_spawn_agent(self, agent_type: str, cwd: str) -> dict:
        """
        Find an existing shared agent shell or spawn a new one.
        Ensures a single shared Codex shell backs all sessions.
        """
        if agent_type not in self._adapters:
            raise ValueError(f"Unknown agent type: {agent_type}")

        label = f"agent-{agent_type}-shared-c"
        session_id = f"shared-{agent_type}"
        manager = await self._get_manager()
        existing = await manager.find_shell_by_label(label, status="running")
        if existing:
            self._sessions[session_id] = existing.id
            described = await manager.describe(existing)
            return {
                "id": existing.id,
                "session_id": session_id,
                "alive": described.get("alive", False),
                "label": described.get("label"),
            }

        shell_dict = await self.spawn_agent(agent_type, cwd, session_id)
        return {
            "id": shell_dict["id"],
            "session_id": session_id,
            "alive": shell_dict.get("alive", False),
            "label": shell_dict.get("label"),
        }

    async def get_manager(self) -> FrameworkShellManager:
        """Public async accessor for the framework shell manager."""
        return await self._get_manager()
    
    async def spawn_agent(self, agent_type: str, cwd: str, session_id: str) -> dict:
        """
        Spawn a new agent process via framework shells.
        
        Args:
            agent_type: 'codex' or 'gemini'
            cwd: Working directory (project root)
            session_id: Unique session identifier
        
        Returns:
            Shell metadata from framework_shells
        
        Raises:
            ValueError: If agent_type is not supported
        """
        if agent_type not in self._adapters:
            raise ValueError(f"Unknown agent type: {agent_type}")
        
        # Build command
        if agent_type == 'codex':
            command = ['codex', 'mcp-server']
        elif agent_type == 'gemini':
            command = ['gemini', '--experimental-acp']
        
        # Spawn via framework shell PTY with consistent label for shared shells
        # Use 'shared-c' suffix for shared shells (discoverable across restarts)
        label_suffix = 'shared-c' if 'shared' in session_id else session_id[:8]
        
        manager = await self._get_manager()
        shell_record = await manager.spawn_shell_pty(
            command,
            label=f"agent-{agent_type}-{label_suffix}",
            cwd=cwd
        )
        
        # Convert to dict for return
        shell_dict = await manager.describe(shell_record)
        
        # Store session mapping
        self._sessions[session_id] = shell_dict['id']
        
        return shell_dict
    
    async def get_or_create_agent(self, session_id: str, agent_type: str, cwd: str) -> dict:
        """
        Get existing agent shell or spawn new one.
        
        Args:
            session_id: Session identifier
            agent_type: 'codex' or 'gemini'
            cwd: Working directory
        
        Returns:
            Shell metadata
        """
        shell_id = self._sessions.get(session_id)
        
        if shell_id:
            # Check if still alive
            try:
                manager = await self._get_manager()
                shell = await manager.describe(shell_id)
                if shell and shell.get('alive'):
                    return shell
            except Exception:
                pass
        
        # Spawn new agent
        return await self.spawn_agent(agent_type, cwd, session_id)
    
    async def write_message(self, session_id: str, agent_type: str, message: dict, context: Optional[dict] = None):
        """
        Write normalized message to agent, translating to agent-specific format.
        
        Args:
            session_id: Session identifier
            agent_type: 'codex' or 'gemini'
            message: Normalized message from frontend
            context: Optional context enrichment (file content, git status, etc.)
        """
        shell_id = self._sessions.get(session_id)
        if not shell_id:
            _debug_log("Bridge:error", f"No shell mapping for session={session_id}")
            raise ValueError(f"No agent for session {session_id}")
        
        # Get adapter
        adapter = self._adapters[agent_type]

        chat_session_id = message.get('session')
        _debug_log(
            "Bridge:route",
            f"shared_session={session_id} chat_session={chat_session_id} "
            f"shell={shell_id} agent={agent_type} msg_id={message.get('id')}"
        )

        if 'conversationId' in message:
            normalized_conv = _normalize_conversation_id(message.get('conversationId'))
            if normalized_conv is None:
                message.pop('conversationId', None)
            else:
                message['conversationId'] = normalized_conv

        session_state = None
        if agent_type == 'codex':
            if chat_session_id:
                session_state = self._session_state.get(chat_session_id)
            if session_state is None:
                session_state = self._session_state.get(session_id)

        if agent_type == 'codex':
            context = context or {}

            if session_state:
                # If a history restore is pending, attach base instructions and
                # clear any cached conversation data before sending the message.
                if session_state.get('needs_restore') and session_state.get('history_transcript'):
                    transcript = session_state.get('history_transcript') or ''
                    if transcript:
                        message['text'] = f"{transcript}\n\nUser: {message.get('text', '')}"
                    if session_state.get('approval_policy'):
                        context.setdefault('approval_policy', session_state['approval_policy'])
                    if session_state.get('sandbox'):
                        context.setdefault('sandbox', session_state['sandbox'])
                    target_key = chat_session_id or session_id
                    CodexAdapter.clear_conversation(target_key)
                    message['conversationId'] = None
                    session_state['needs_restore'] = False
                    session_state['conversation_id'] = None

                # Enforce stored conversation ID if we have one
                stored_conv = _normalize_conversation_id(session_state.get('conversation_id'))
                if stored_conv:
                    message['conversationId'] = stored_conv
                    session_state['conversation_id'] = stored_conv
                elif 'conversationId' in message and message['conversationId']:
                    # If we don't have a stored conversation, ensure None is sent
                    message['conversationId'] = None
            else:
                # No session state tracked yet; ensure we clear stale IDs
                if message.get('conversationId'):
                    message['conversationId'] = None

        # Translate to agent format
        agent_msg = adapter.to_agent(message, context)
        line = json.dumps(agent_msg) + '\n'

        payload_preview = line.strip().replace('\n', '\\n')
        params = agent_msg.get('params', {})
        tool_name = params.get('name') if isinstance(params, dict) else None
        encoded = line.encode("utf-8")
        _debug_log(
            "Bridge->PTY",
            f"shell={shell_id} bytes={len(encoded)} tool={tool_name} "
            f"conversation={message.get('conversationId')} preview={payload_preview[:160]}"
        )
        
        # Write line-delimited JSON to PTY
        manager = await self._get_manager()
        try:
            await manager.write_to_pty(shell_id, encoded)
        except Exception as exc:
            _debug_log("Bridge->PTY", f"write failed shell={shell_id}: {exc}")
            raise
        else:
            _debug_log("Bridge->PTY", f"write complete shell={shell_id}")
    
    def parse_agent_output(self, agent_type: str, line: str) -> Optional[dict]:
        """
        Parse agent output line and normalize to frontend format.
        
        Args:
            agent_type: 'codex' or 'gemini'
            line: Raw JSON line from agent stdout
        
        Returns:
            Normalized message or None if parsing fails
        """
        try:
            agent_msg = json.loads(line)
            adapter = self._adapters[agent_type]
            return adapter.from_agent(agent_msg)
        except json.JSONDecodeError:
            return None
    
    async def subscribe_output(self, session_id: str):
        """Subscribe to agent output queue."""
        shell_id = self._sessions.get(session_id)
        if not shell_id:
            raise ValueError(f"No agent for session {session_id}")
        manager = await self._get_manager()
        return await manager.subscribe_output(shell_id)
    
    async def unsubscribe_output(self, session_id: str, queue):
        """Unsubscribe from agent output queue."""
        shell_id = self._sessions.get(session_id)
        if shell_id:
            manager = await self._get_manager()
            await manager.unsubscribe_output(shell_id, queue)

    def set_session_state(self, session_id: str, state: Dict[str, Any]):
        if 'conversation_id' in state:
            state['conversation_id'] = _normalize_conversation_id(state['conversation_id'])
        self._session_state[session_id] = state

    def clear_session_state(self, session_id: str):
        self._session_state.pop(session_id, None)

    def note_conversation(self, session_id: str, conversation_id: str):
        state = self._session_state.setdefault(session_id, {})
        state['conversation_id'] = _normalize_conversation_id(conversation_id)

    def update_session_shell(self, session_id: str, shell_id: str):
        state = self._session_state.setdefault(session_id, {})
        state['shell_id'] = shell_id
    
    def attach_session(self, session_id: str, shell_id: str):
        """Attach an existing shell to a session mapping."""
        if session_id and shell_id:
            self._sessions[session_id] = shell_id
    
    async def terminate_agent(self, session_id: str):
        """Stop agent process gracefully."""
        shell_id = self._sessions.get(session_id)
        if shell_id:
            try:
                manager = await self._get_manager()
                await manager.stop_shell(shell_id)
            except Exception:
                pass
            del self._sessions[session_id]
    
    async def get_agent_stats(self, session_id: str) -> Optional[dict]:
        """Get resource stats for agent process."""
        shell_id = self._sessions.get(session_id)
        if not shell_id:
            return None
        
        try:
            manager = await self._get_manager()
            shell = await manager.describe(shell_id)
            return {
                'alive': shell.get('alive', False),
                'cpu_percent': shell.get('cpu_percent'),
                'rss_mb': shell.get('rss_mb'),
                'uptime': shell.get('uptime'),
                'pid': shell.get('pid')
            }
        except Exception:
            return None
    
    async def list_agents(self) -> List[dict]:
        """List all active agent sessions."""
        agents = []
        manager = await self._get_manager()
        for session_id, shell_id in self._sessions.items():
            try:
                shell = await manager.describe(shell_id)
                agents.append({
                    'session_id': session_id,
                    'shell_id': shell_id,
                    'label': shell.get('label', ''),
                    'alive': shell.get('alive', False),
                    'cwd': shell.get('cwd', ''),
                    'uptime': shell.get('uptime')
                })
            except Exception:
                continue
        return agents


def enrich_context(file_path: Optional[str] = None, project_root: Optional[str] = None) -> dict:
    """
    Enrich message context with file content and metadata.
    
    Args:
        file_path: Path to current file
        project_root: Project root directory
    
    Returns:
        Context dictionary with file content, language, git status, etc.
    """
    context = {
        'cwd': project_root or os.path.expanduser('~')
    }
    
    if file_path and os.path.isfile(file_path):
        try:
            # Read file content
            with open(file_path, 'r', encoding='utf-8') as f:
                context['file_path'] = file_path
                context['file_content'] = f.read()
            
            # Detect language from extension
            ext = Path(file_path).suffix.lstrip('.')
            context['language'] = ext or 'text'
            
            # TODO: Add git status check
            context['git_status'] = 'unknown'
            
        except Exception:
            pass
    
    return context


# Singleton instance
_bridge_instance = None

def get_bridge() -> AgentBridge:
    """Get singleton AgentBridge instance."""
    global _bridge_instance
    if _bridge_instance is None:
        _bridge_instance = AgentBridge()
    return _bridge_instance
