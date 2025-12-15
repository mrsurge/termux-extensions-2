"""LSP Socket.IO Bridge.

vectorArc • 2025-12-08

Bridges Socket.IO events from CM6 LSP client to language server STDIO.
Uses the "Piggyback" strategy to attach /lsp namespace to existing NiceGUI Socket.IO.
"""

import asyncio
import json
from pathlib import Path
from typing import Dict, Optional

import socketio

from framework_shells import get_manager, PipeState
from .lsp_shell_manager import get_or_spawn_lsp_shell


class LSPFrameParser:
    """Parse LSP Content-Length framed messages from byte stream."""
    
    def __init__(self):
        self.buffer = b""
    
    def feed(self, data: bytes):
        """Feed data and yield complete JSON messages."""
        self.buffer += data
        while True:
            msg = self._try_parse()
            if msg is None:
                break
            yield msg
    
    def _try_parse(self) -> Optional[dict]:
        # Look for header separator
        sep = b"\r\n\r\n"
        idx = self.buffer.find(sep)
        if idx < 0:
            return None
        
        header_bytes = self.buffer[:idx]
        content_start = idx + len(sep)
        
        # Parse Content-Length
        content_length = None
        for line in header_bytes.split(b"\r\n"):
            if line.lower().startswith(b"content-length:"):
                try:
                    content_length = int(line.split(b":", 1)[1].strip())
                except (ValueError, IndexError):
                    pass
                break
        
        if content_length is None:
            # Malformed, skip this header block
            self.buffer = self.buffer[content_start:]
            return None
        
        # Check if we have full body
        if len(self.buffer) < content_start + content_length:
            return None
        
        body = self.buffer[content_start:content_start + content_length]
        self.buffer = self.buffer[content_start + content_length:]
        
        try:
            return json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None


class LSPSocketIONamespace(socketio.AsyncNamespace):
    """Socket.IO namespace for LSP communication."""
    
    def __init__(self, namespace="/lsp"):
        super().__init__(namespace)
        self.active_sessions: Dict[str, dict] = {}  # sid -> session info
        self.reader_tasks: Dict[str, asyncio.Task] = {}
        self.pending_messages: Dict[str, list] = {}  # sid -> queued messages waiting for session
        self.session_ready: Dict[str, asyncio.Event] = {}  # sid -> event signaling session is ready
        import sys
        print(f"[LSP WS] Namespace initialized: {namespace}", file=sys.stderr, flush=True)
    
    async def on_connect(self, sid, environ):
        import sys
        print(f"[LSP WS] Client connected: {sid}", file=sys.stderr, flush=True)
        self.pending_messages[sid] = []
        self.session_ready[sid] = asyncio.Event()
    
    async def on_disconnect(self, sid):
        import sys
        print(f"[LSP WS] Client disconnected: {sid}", file=sys.stderr, flush=True)
        # Clean up
        self.active_sessions.pop(sid, None)
        self.pending_messages.pop(sid, None)
        self.session_ready.pop(sid, None)
        task = self.reader_tasks.pop(sid, None)
        if task:
            task.cancel()
    
    async def on_initialize(self, sid, data):
        """Client sends: { languageId: 'python', projectRoot: '/path/to/project' }"""
        import sys
        print(f"[LSP WS] on_initialize called: sid={sid} data={data}", file=sys.stderr, flush=True)
        
        language_id = data.get("languageId")
        project_root = data.get("projectRoot", ".")
        
        if not language_id:
            await self.emit("lsp:error", {"error": "Missing languageId"}, to=sid)
            return
        
        print(f"[LSP WS] Initialize: {sid} lang={language_id} root={project_root}")
        
        # Spawn or get existing LSP shell
        shell = await get_or_spawn_lsp_shell(language_id, Path(project_root))
        if not shell:
            await self.emit("lsp:error", {"error": f"Failed to spawn LSP for {language_id}"}, to=sid)
            return
        
        # Get pipe state for direct I/O
        mgr = await get_manager()
        pipe_state = mgr.get_pipe_state(shell.id)
        if not pipe_state:
            await self.emit("lsp:error", {"error": "LSP shell has no pipe state"}, to=sid)
            return
        
        self.active_sessions[sid] = {
            "language_id": language_id,
            "shell_id": shell.id,
            "project_root": project_root,
            "parser": LSPFrameParser(),
            "pipe_state": pipe_state,
        }
        
        # Start background reader for this session
        task = asyncio.create_task(self._bridge_output(sid, pipe_state))
        self.reader_tasks[sid] = task
        
        # Signal that session is ready
        if sid in self.session_ready:
            self.session_ready[sid].set()
        
        # Process any pending messages that arrived before session was ready
        pending = self.pending_messages.get(sid, [])
        if pending:
            print(f"[LSP WS] Processing {len(pending)} pending messages for {sid}", file=sys.stderr, flush=True)
            for msg in pending:
                await self._forward_to_shell(sid, msg)
            self.pending_messages[sid] = []
        
        await self.emit("lsp_initialized", {"shellId": shell.id}, to=sid)
    
    async def on_lsp_client_to_server(self, sid, message):
        """Receive JSON LSP message from client, forward to shell stdin."""
        import sys
        print(f"[LSP WS] on_lsp_client_to_server: sid={sid} msg={str(message)[:200]}", file=sys.stderr, flush=True)
        
        session = self.active_sessions.get(sid)
        if not session:
            # Session not ready yet - queue the message
            print(f"[LSP WS] Session not ready, queuing message for {sid}", file=sys.stderr, flush=True)
            if sid in self.pending_messages:
                self.pending_messages[sid].append(message)
            return
        
        await self._forward_to_shell(sid, message)
    
    async def _forward_to_shell(self, sid: str, message: dict):
        """Forward a single LSP message to the shell stdin."""
        import sys
        session = self.active_sessions.get(sid)
        if not session:
            return
        
        pipe_state = session.get("pipe_state")
        if not pipe_state or not pipe_state.process or not pipe_state.process.stdin:
            print(f"[LSP WS] No pipe state or stdin for session {sid}", file=sys.stderr, flush=True)
            return
        
        # Add LSP framing (Content-Length header)
        body = json.dumps(message).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
        
        try:
            pipe_state.process.stdin.write(header + body)
            await pipe_state.process.stdin.drain()
            print(f"[LSP WS] Wrote {len(body)} bytes to shell", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[LSP WS] Write error: {e}", file=sys.stderr, flush=True)
    
    async def _bridge_output(self, sid: str, pipe_state: PipeState):
        """Read from shell stdout, parse LSP frames, emit to client."""
        import sys
        print(f"[LSP WS] Starting output bridge for {sid}", file=sys.stderr, flush=True)
        session = self.active_sessions.get(sid)
        if not session:
            return
        
        parser = session["parser"]
        proc = pipe_state.process
        
        try:
            while not pipe_state.stop.is_set():
                if proc.stdout is None:
                    print(f"[LSP WS] No stdout for {sid}", file=sys.stderr, flush=True)
                    break
                
                try:
                    chunk = await asyncio.wait_for(proc.stdout.read(4096), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                
                if not chunk:
                    # EOF
                    print(f"[LSP WS] EOF on {sid}", file=sys.stderr, flush=True)
                    break
                
                print(f"[LSP WS] Read {len(chunk)} bytes from LSP server", file=sys.stderr, flush=True)
                for msg in parser.feed(chunk):
                    print(f"[LSP WS] Sending to client: {str(msg)[:200]}...", file=sys.stderr, flush=True)
                    await self.emit("lsp_server_to_client", msg, to=sid)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[LSP WS] Reader error: {e}", file=sys.stderr, flush=True)
    
    # Note: on_disconnect is defined earlier in the class
