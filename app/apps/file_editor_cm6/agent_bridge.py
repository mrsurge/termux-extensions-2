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
from app.libs.framework_shells import _manager


class CodexAdapter:
    """
    Protocol adapter for Codex CLI (app-server mode).
    Translates between normalized messages and Codex-specific format.
    """
    
    @staticmethod
    def to_agent(normalized: dict, context: Optional[dict] = None) -> dict:
        """
        Convert normalized frontend message to Codex format.
        
        Normalized format:
            {"id": "42", "action": "chat", "text": "...", "context": {...}}
        
        Codex format:
            {"id": "42", "type": "send_user_turn", "params": {...}}
        """
        msg_id = normalized.get('id')
        action = normalized.get('action', 'chat')
        text = normalized.get('text', '')
        ctx = context or normalized.get('context', {})
        
        # Build items array
        items = []
        
        # Add context if available
        if ctx.get('file_path') and ctx.get('file_content'):
            items.append({
                'type': 'context',
                'path': ctx['file_path'],
                'content': ctx['file_content'],
                'language': ctx.get('language', ''),
                'git_status': ctx.get('git_status', 'clean')
            })
        
        # Add user message
        items.append({
            'type': 'text',
            'text': text
        })
        
        # Build Codex message
        codex_msg = {
            'id': msg_id,
            'type': 'send_user_turn',
            'params': {
                'model': normalized.get('model', 'gpt-5-codex'),
                'effort': normalized.get('effort', 'medium'),
                'summary': text[:50],  # First 50 chars as summary
                'items': items,
                'cwd': ctx.get('cwd', os.path.expanduser('~')),
                'metadata': {
                    'session': normalized.get('session', 'default')
                }
            }
        }
        
        # Add optional schema for structured output
        if normalized.get('output_schema'):
            codex_msg['params']['final_output_json_schema'] = normalized['output_schema']
        
        return codex_msg
    
    @staticmethod
    def from_agent(codex_msg: dict) -> dict:
        """
        Convert Codex response to normalized format.
        
        Codex format:
            {"id": "42", "event": "token", "data": {"text": "..."}}
        
        Normalized format:
            {"id": "42", "event": "token", "text": "..."}
        """
        msg_id = codex_msg.get('id')
        event = codex_msg.get('event')
        data = codex_msg.get('data', {})
        
        normalized = {
            'id': msg_id,
            'event': event,
            'agent': 'codex'
        }
        
        # Map event-specific data
        if event == 'token':
            normalized['text'] = data.get('text', '')
        elif event == 'diff':
            normalized['path'] = data.get('path')
            normalized['patch'] = data.get('patch')
        elif event == 'tool_call':
            normalized['tool'] = data.get('name')
            normalized['args'] = data.get('args', {})
        elif event == 'planning':
            normalized['summary'] = data.get('summary')
        elif event == 'final':
            normalized['ok'] = data.get('ok', True)
            normalized['output'] = data.get('output', {})
        elif event == 'error':
            normalized['error'] = data.get('message')
            normalized['kind'] = data.get('kind', 'terminal')
        
        return normalized


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
        self.manager = _manager()
        self._sessions: Dict[str, str] = {}  # session_id -> shell_id
        self._adapters = {
            'codex': CodexAdapter,
            'gemini': GeminiAdapter
        }
    
    def spawn_agent(self, agent_type: str, cwd: str, session_id: str) -> dict:
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
            command = ['codex', 'app-server']
        elif agent_type == 'gemini':
            command = ['gemini', '--experimental-acp']
        
        # Spawn via framework shell PTY
        shell = self.manager.spawn_shell_pty(
            command,
            label=f"agent-{agent_type}-{session_id[:8]}",
            cwd=cwd
        )
        
        # Store session mapping
        self._sessions[session_id] = shell['id']
        
        return shell
    
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
