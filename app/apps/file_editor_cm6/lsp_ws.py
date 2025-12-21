"""LSP Socket.IO Bridge.

vectorArc • 2025-12-08

Bridges Socket.IO events from CM6 LSP client to language server STDIO.
Uses the "Piggyback" strategy to attach /lsp namespace to existing NiceGUI Socket.IO.
"""

import asyncio
import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

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
        # sid -> key (language_id, project_root)
        self.sid_to_key: Dict[str, Tuple[str, str]] = {}

        # Long-lived backend sessions keyed by (language_id, project_root).
        self.backend_sessions: Dict[Tuple[str, str], dict] = {}

        # Pending messages per sid while initialization wiring is happening.
        self.pending_messages: Dict[str, list] = {}
        self.session_ready: Dict[str, asyncio.Event] = {}
        import sys
        print(f"[LSP WS] Namespace initialized: {namespace}", file=sys.stderr, flush=True)

    async def _is_session_healthy(self, session: dict) -> bool:
        """Return True if the session's shell + pipe process are still alive.

        Users can manually exit LSP servers (or they can crash). In that case we
        must respawn on the next initialize rather than keeping a dead session
        around forever.
        """

        if not session or session.get("dead"):
            return False

        shell_id = session.get("shell_id")
        if not shell_id:
            return False

        try:
            mgr = await get_manager()
        except Exception:
            return False

        try:
            rec = await mgr.get_shell(shell_id)
        except Exception:
            rec = None

        if not rec or rec.status != "running" or not rec.pid:
            return False

        pipe_state = mgr.get_pipe_state(shell_id)
        if not pipe_state or not getattr(pipe_state, "process", None):
            return False

        proc = pipe_state.process
        # asyncio subprocess: returncode is None while running
        try:
            if getattr(proc, "returncode", None) is not None:
                return False
        except Exception:
            # If we can't read returncode, assume it's unhealthy.
            return False

        return True

    async def _teardown_session(self, key: Tuple[str, str], session: Optional[dict]) -> None:
        if not session:
            return

        # Mark dead immediately so concurrent calls don't reuse it.
        session["dead"] = True

        try:
            pipe_state = session.get("pipe_state")
            if pipe_state and getattr(pipe_state, "stop", None):
                pipe_state.stop.set()
        except Exception:
            pass

        try:
            task = session.get("reader_task")
            if task:
                task.cancel()
        except Exception:
            pass

        shell_id = session.get("shell_id")
        if shell_id:
            try:
                mgr = await get_manager()
                await mgr.terminate_shell(shell_id, force=True)
            except Exception:
                pass

        try:
            self.backend_sessions.pop(key, None)
        except Exception:
            pass

    async def _ensure_backend_session(self, language_id: str, project_root: str) -> Optional[dict]:
        """Get or create a healthy backend session for (language, project_root)."""

        key = (str(language_id), str(project_root))
        session = self.backend_sessions.get(key)
        if session is not None:
            if await self._is_session_healthy(session):
                return session
            # Stale/crashed session: tear down and respawn.
            await self._teardown_session(key, session)
            session = None

        shell = await get_or_spawn_lsp_shell(language_id, Path(project_root))
        if not shell:
            return None

        mgr = await get_manager()
        pipe_state = mgr.get_pipe_state(shell.id)
        if not pipe_state:
            return None

        session = {
            "language_id": str(language_id),
            "project_root": str(project_root),
            "shell_id": shell.id,
            "pipe_state": pipe_state,
            "parser": LSPFrameParser(),
            "reader_task": None,
            "current_sid": None,
            "init_request_id": None,
            "init_result_template": None,  # cached initialize response (without id rewrite)
            "initialized": False,
            "dead": False,
        }
        session["reader_task"] = asyncio.create_task(self._bridge_backend_output(key))
        self.backend_sessions[key] = session
        return session
    
    async def on_connect(self, sid, environ):
        import sys
        print(f"[LSP WS] Client connected: {sid}", file=sys.stderr, flush=True)
        self.pending_messages[sid] = []
        self.session_ready[sid] = asyncio.Event()
    
    async def on_disconnect(self, sid):
        import sys
        print(f"[LSP WS] Client disconnected: {sid}", file=sys.stderr, flush=True)
        key = self.sid_to_key.pop(sid, None)
        if key is not None:
            session = self.backend_sessions.get(key)
            if session and session.get("current_sid") == sid:
                session["current_sid"] = None

        self.pending_messages.pop(sid, None)
        self.session_ready.pop(sid, None)
    
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

        key = (str(language_id), str(project_root))
        self.sid_to_key[sid] = key

        session = await self._ensure_backend_session(language_id, project_root)
        if session is None:
            await self.emit("lsp:error", {"error": f"Failed to spawn LSP for {language_id}"}, to=sid)
            return

        # Single-attached-client policy: steal attachment on reconnect.
        session["current_sid"] = sid

        if sid in self.session_ready:
            self.session_ready[sid].set()

        pending = self.pending_messages.get(sid, [])
        if pending:
            print(f"[LSP WS] Processing {len(pending)} pending messages for {sid}", file=sys.stderr, flush=True)
            for msg in pending:
                await self._handle_client_message(sid, msg)
            self.pending_messages[sid] = []

        await self.emit("lsp_initialized", {"shellId": session.get("shell_id")}, to=sid)
    
    async def on_lsp_client_to_server(self, sid, message):
        """Receive JSON LSP message from client, forward to shell stdin."""
        import sys
        print(f"[LSP WS] on_lsp_client_to_server: sid={sid} msg={str(message)[:200]}", file=sys.stderr, flush=True)

        key = self.sid_to_key.get(sid)
        session = self.backend_sessions.get(key) if key else None
        if not session:
            print(f"[LSP WS] Session not ready, queuing message for {sid}", file=sys.stderr, flush=True)
            if sid in self.pending_messages:
                self.pending_messages[sid].append(message)
            return

        await self._handle_client_message(sid, message)

    async def _handle_client_message(self, sid: str, message: dict) -> None:
        """Apply broker rules, then forward (or short-circuit)."""
        import sys
        key = self.sid_to_key.get(sid)
        session = self.backend_sessions.get(key) if key else None
        if not session:
            return

        # Enforce single-attached-client: drop writes from stale sids.
        if session.get("current_sid") != sid:
            return

        if isinstance(message, dict):
            method = message.get("method")
            if method == "initialize":
                if session.get("initialized") and session.get("init_result_template") is not None:
                    print(f"[LSP WS] Short-circuit initialize for sid={sid}", file=sys.stderr, flush=True)
                    await self._emit_initialize_response(sid, message.get("id"), session.get("init_result_template"))
                    return
                if session.get("init_request_id") is None and message.get("id") is not None:
                    session["init_request_id"] = message.get("id")
            elif method == "initialized":
                if session.get("initialized"):
                    return
            elif method in ("shutdown", "exit"):
                return

        await self._forward_to_backend(sid, message)
    
    async def _emit_initialize_response(self, sid: str, request_id: Any, template: dict) -> None:
        if request_id is None:
            return
        try:
            payload = dict(template)
            payload["id"] = request_id
        except Exception:
            return
        try:
            await self.emit("lsp_server_to_client", payload, to=sid)
        except Exception:
            pass

    async def _forward_to_backend(self, sid: str, message: dict):
        """Forward a single LSP message to the backend stdin."""
        import sys
        key = self.sid_to_key.get(sid)
        session = self.backend_sessions.get(key) if key else None
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
            try:
                session["dead"] = True
            except Exception:
                pass
    
    async def _bridge_backend_output(self, key: Tuple[str, str]):
        """Read from backend stdout forever; deliver to current sid (session broker)."""
        import sys
        print(f"[LSP WS] Starting backend output bridge for {key}", file=sys.stderr, flush=True)
        session = self.backend_sessions.get(key)
        if not session:
            return
        
        parser: LSPFrameParser = session["parser"]
        pipe_state: PipeState = session["pipe_state"]
        proc = pipe_state.process
        
        try:
            while not pipe_state.stop.is_set():
                if proc.stdout is None:
                    print(f"[LSP WS] No stdout for {key}", file=sys.stderr, flush=True)
                    break
                
                try:
                    chunk = await asyncio.wait_for(proc.stdout.read(4096), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                
                if not chunk:
                    # EOF
                    print(f"[LSP WS] EOF on {key}", file=sys.stderr, flush=True)
                    try:
                        session["dead"] = True
                    except Exception:
                        pass
                    break
                
                print(f"[LSP WS] Read {len(chunk)} bytes from LSP server", file=sys.stderr, flush=True)
                for msg in parser.feed(chunk):
                    # Cache initialize response (so reconnecting stateless clients can be short-circuited).
                    try:
                        init_id = session.get("init_request_id")
                        if (
                            (not session.get("initialized"))
                            and init_id is not None
                            and isinstance(msg, dict)
                            and msg.get("id") == init_id
                            and "result" in msg
                        ):
                            session["init_result_template"] = dict(msg)
                            session["initialized"] = True
                    except Exception:
                        pass

                    current_sid = session.get("current_sid")
                    if not current_sid:
                        continue
                    print(f"[LSP WS] Sending to client: {str(msg)[:200]}...", file=sys.stderr, flush=True)
                    await self.emit("lsp_server_to_client", msg, to=current_sid)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[LSP WS] Reader error: {e}", file=sys.stderr, flush=True)
            try:
                session = self.backend_sessions.get(key)
                if session:
                    session["dead"] = True
            except Exception:
                pass
    
    # Note: on_disconnect is defined earlier in the class
