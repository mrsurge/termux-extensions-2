# app/apps/file_editor_cm6/agent_bridge.py

"""
Agent Bridge - Protocol normalization layer for Codex and Gemini agents.

Provides a unified API for the frontend while handling protocol translation
between Codex app-server (JSONL) and Gemini ACP formats. Uses framework shells for
process lifecycle management.
"""

import json
import os
from typing import Dict, List, Optional, Any
from pathlib import Path
from app.libs.framework_shells import _manager


class CodexAdapter:
    """
    Protocol adapter for Codex app-server mode.
    Implements JSONL (newline-delimited JSON) protocol over STDIN/STDOUT.
    """
    
    @staticmethod
    def to_agent(normalized: dict, context: Optional[dict] = None) -> dict:
        """
        Convert normalized frontend message to Codex app-server turn request.
        
        App-server protocol:
        - Send one JSON object per line to STDIN
        - Receive event stream on STDOUT
        
        Normalized format:
            {"id": "42", "action": "chat", "text": "...", "context": {...}}
        
        Codex app-server format (JSONL):
            {"id": "42", "type": "send-user-turn", "params": {...}}
        """
        msg_id = normalized.get('id')
        text = normalized.get('text', '')
        ctx = context or normalized.get('context', {})
        
        # Build user turn items
        items = [{'type': 'text', 'text': text}]
        
        # Add file context if available
        if ctx.get('file_path') and ctx.get('file_content'):
            items[0]['text'] = f"""File: {ctx['file_path']}
Language: {ctx.get('language', 'unknown')}

Content:
```
{ctx['file_content']}
```

{text}"""
        
        # Build app-server turn request
        turn_msg = {
            'id': msg_id,
            'type': 'send-user-turn',
            'params': {
                'model': ctx.get('model', 'gpt-5-codex'),
                'effort': ctx.get('effort', 'medium'),
                'items': items,
                'cwd': ctx.get('cwd', os.path.expanduser('~'))
            }
        }
        
        # Add approval policy if provided (maps to Codex config)
        # Note: app-server doesn't have direct approval-policy param,
        # but we can include it in metadata for future use
        if ctx.get('approval_policy') or ctx.get('sandbox'):
            turn_msg['metadata'] = {
                'approval_policy': ctx.get('approval_policy'),
                'sandbox': ctx.get('sandbox')
            }
        
        return turn_msg
    
    @staticmethod
    def from_agent(app_server_msg: dict) -> Optional[dict]:
        """
        Convert Codex app-server event to normalized format.
        
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
                # Check if this is an error response
                is_error = mcp_msg.get('result', {}).get('isError', False)
                
                for item in result:
                    if item.get('type') == 'text':
                        text = item.get('text', '')
                        
                        # Special handling for "Session not found" errors
                        if is_error and 'Session not found' in text and 'conversation_id' in text:
                            return {
                                'id': str(mcp_msg.get('id')),
                                'event': 'session_not_found',
                                'agent': 'codex',
                                'error': text
                            }
                        
                        return {
                            'id': str(mcp_msg.get('id')),
                            'event': 'error' if is_error else 'final',
                            'agent': 'codex',
                            'text': text,
                            'ok': not is_error
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
                    return {
                        'id': str(request_id),
                        'event': 'token',
                        'agent': 'codex',
                        'text': msg_data.get('delta', '')
                    }
                elif event_type == 'agent_message':
                    # Full message - DIRECT RESPONSE (ignore, we use deltas)
                    return None
                
                # EVERYTHING ELSE - terminal/console style
                elif event_type == 'agent_reasoning_delta':
                    # Reasoning tokens - SYSTEM MESSAGE
                    return {
                        'id': str(request_id),
                        'event': 'system',
                        'agent': 'codex',
                        'text': msg_data.get('delta', '')
                    }
                elif event_type == 'agent_reasoning':
                    # Full reasoning - SYSTEM MESSAGE (ignore, we use deltas)
                    return None
                elif event_type == 'agent_reasoning_section_break':
                    # Section break - SYSTEM MESSAGE
                    return {
                        'id': str(request_id),
                        'event': 'system',
                        'agent': 'codex',
                        'text': '\n'
                    }
                elif event_type == 'task_started':
                    # Task starting - SYSTEM MESSAGE
                    return {
                        'id': str(request_id),
                        'event': 'system',
                        'agent': 'codex',
                        'text': '[Task started]'
                    }
                elif event_type == 'task_complete':
                    # Task finished - SYSTEM MESSAGE + final marker
                    return {
                        'id': str(request_id),
                        'event': 'final',
                        'agent': 'codex',
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
                    'event': 'message',
                    'agent': 'codex',
                    'level': params.get('level', 'info'),
                    'text': params.get('message', '')
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
    Uses consistent label-based shell lookup to ensure singleton per agent type.
    """
    
    def __init__(self):
        self.manager = _manager()
        self._sessions: Dict[str, str] = {}  # session_id -> shell_id
        self._adapters = {
            'codex': CodexAdapter,
            'gemini': GeminiAdapter
        }
    
    def _get_agent_label(self, agent_type: str) -> str:
        """Get consistent label for agent shell."""
        return f"agent-{agent_type}-shared"
    
    def find_or_spawn_agent(self, agent_type: str, cwd: str) -> dict:
        """
        Find existing agent shell by label or spawn new one.
        Ensures only ONE shell per agent type across all workers.
        
        Args:
            agent_type: 'codex' or 'gemini'
            cwd: Working directory (project root)
        
        Returns:
            Shell metadata with 'id' and 'session_id'
        
        Raises:
            ValueError: If agent_type is not supported
        """
        if agent_type not in self._adapters:
            raise ValueError(f"Unknown agent type: {agent_type}")
        
        label = self._get_agent_label(agent_type)
        session_id = f'shared-{agent_type}'
        
        # Try to find existing shell
        existing = self.manager.find_shell_by_label(label, status='running')
        if existing:
            # Store session mapping
            self._sessions[session_id] = existing.id
            return {
                'id': existing.id,
                'session_id': session_id,
                'alive': True
            }
        
        # Spawn new shell
        return self.spawn_agent(agent_type, cwd, session_id)
    
    def spawn_agent(self, agent_type: str, cwd: str, session_id: str) -> dict:
        """
        Spawn a new agent process via framework shells.
        Uses consistent label pattern to enable singleton enforcement.
        
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
        
        # Use consistent label for singleton enforcement
        label = self._get_agent_label(agent_type)
        
        # Spawn via framework shell PTY (will reuse existing if label matches)
        shell_record = self.manager.spawn_shell_pty(
            command,
            label=label,
            cwd=cwd,
            autostart=True
        )
        
        # Convert to dict for return
        shell_dict = self.manager.describe(shell_record)
        
        # Store session mapping
        self._sessions[session_id] = shell_dict['id']
        
        return {
            'id': shell_dict['id'],
            'session_id': session_id,
            'alive': shell_dict.get('alive', False)
        }
    
    def get_or_create_agent(self, session_id: str, agent_type: str, cwd: str) -> dict:
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
                shell = self.manager.describe(shell_id)
                if shell and shell.get('alive'):
                    return shell
            except Exception:
                pass
        
        # Spawn new agent
        return self.spawn_agent(agent_type, cwd, session_id)
    
    def write_message(self, session_id: str, agent_type: str, message: dict, context: Optional[dict] = None):
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
            raise ValueError(f"No agent for session {session_id}")
        
        # Get adapter
        adapter = self._adapters[agent_type]
        
        # Translate to agent format
        agent_msg = adapter.to_agent(message, context)
        
        # Write line-delimited JSON to PTY
        line = json.dumps(agent_msg) + '\n'
        self.manager.write_to_pty(shell_id, line)
    
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
    
    def subscribe_output(self, session_id: str):
        """Subscribe to agent output queue."""
        shell_id = self._sessions.get(session_id)
        if not shell_id:
            raise ValueError(f"No agent for session {session_id}")
        return self.manager.subscribe_output(shell_id)
    
    def unsubscribe_output(self, session_id: str, queue):
        """Unsubscribe from agent output queue."""
        shell_id = self._sessions.get(session_id)
        if shell_id:
            self.manager.unsubscribe_output(shell_id, queue)
    
    def terminate_agent(self, session_id: str):
        """Stop agent process gracefully."""
        shell_id = self._sessions.get(session_id)
        if shell_id:
            try:
                self.manager.stop_shell(shell_id)
            except Exception:
                pass
            del self._sessions[session_id]
    
    def get_agent_stats(self, session_id: str) -> Optional[dict]:
        """Get resource stats for agent process."""
        shell_id = self._sessions.get(session_id)
        if not shell_id:
            return None
        
        try:
            shell = self.manager.describe(shell_id)
            return {
                'alive': shell.get('alive', False),
                'cpu_percent': shell.get('cpu_percent'),
                'rss_mb': shell.get('rss_mb'),
                'uptime': shell.get('uptime'),
                'pid': shell.get('pid')
            }
        except Exception:
            return None
    
    def list_agents(self) -> List[dict]:
        """List all active agent sessions."""
        agents = []
        for session_id, shell_id in self._sessions.items():
            try:
                shell = self.manager.describe(shell_id)
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
