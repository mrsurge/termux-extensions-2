"""Socket.IO agent namespace for the file_editor_cm6 app."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from typing import Any, Dict, Optional

import requests
from flask import request
from flask_socketio import Namespace

from app.apps.file_editor_cm6.agent_bridge import enrich_context
from app.apps.file_editor_cm6.agent_session_store import (
    append_message,
    get_session,
    update_session_metadata,
)
from app.apps.file_editor_cm6.conversation_utils import build_transcript
from .protocol import CodexAdapter

LOGGER = logging.getLogger("te.ipc.agent_drawer")
FRAMEWORK_URL = os.getenv("TE_FRAMEWORK_URL", "http://127.0.0.1:8089").rstrip("/")
FRAMEWORK_TOKEN = os.getenv("TE_FRAMEWORK_SHELL_TOKEN")

_state_lock = threading.RLock()
_shell_by_agent: Dict[str, str] = {}
_shell_by_session: Dict[str, str] = {}
_conversations: Dict[str, str] = {}
_initialized_shells: set[str] = set()


def register_ipc_routes(_app, socketio) -> None:
    """Register the Socket.IO namespace."""
    socketio.on_namespace(AgentNamespace(socketio))


class AgentNamespace(Namespace):
    def __init__(self, socketio):
        super().__init__("/agent")
        self.socketio = socketio
        self._sessions: Dict[str, AgentSocketSession] = {}

    def on_connect(self):
        args = request.args
        session_id = args.get("session") or f"session-{uuid.uuid4().hex}"
        session = AgentSocketSession(
            socketio=self.socketio,
            sid=request.sid,
            agent_type=args.get("agent", "codex"),
            cwd=args.get("cwd") or os.path.expanduser("~"),
            session_id=session_id,
        )
        self._sessions[request.sid] = session
        try:
            session.start()
        except Exception as exc:
            LOGGER.error("agent session failed to start: %s", exc)
            session.emit_error(f"Failed to start agent: {exc}")
            session.stop()
            self._sessions.pop(request.sid, None)

    def on_disconnect(self):
        session = self._sessions.pop(request.sid, None)
        if session:
            session.stop()

    def on_agent_user_message(self, data):
        session = self._sessions.get(request.sid)
        if session:
            session.handle_client_message(data)


class AgentSocketSession:
    """Bridges a Socket.IO client to the Codex MCP PTY."""

    def __init__(self, socketio, sid: str, agent_type: str, cwd: str, session_id: str):
        self.socketio = socketio
        self.sid = sid
        self.agent_type = agent_type or "codex"
        self.cwd = cwd or os.path.expanduser("~")
        self.session_id = session_id
        self.shell_id: Optional[str] = None
        self.line_buffer = ""
        self.running = True
        self.output_thread: Optional[threading.Thread] = None
        self._request_map: Dict[str, str] = {}

    # ------------------------------------------------------------------ #
    # Lifecycle                                                          #
    # ------------------------------------------------------------------ #
    def start(self) -> None:
        self._log("connect", f"agent={self.agent_type} session={self.session_id}")
        self.shell_id = self._ensure_shell()
        self._restore_session_state()
        self._initialize_shell()
        self._send_connected_event()
        self._start_output_thread()

    def stop(self) -> None:
        self.running = False
        if self.output_thread and self.output_thread.is_alive():
            self.output_thread.join(timeout=1.0)
        self._log("disconnect", f"agent={self.agent_type} session={self.session_id}")

    # ------------------------------------------------------------------ #
    # Client handling                                                    #
    # ------------------------------------------------------------------ #
    def handle_client_message(self, raw_message: Dict[str, Any]) -> None:
        try:
            self._handle_client_message(raw_message)
        except Exception as exc:  # pragma: no cover - defensive
            self._log("error", f"client message failed: {exc}")
            self.emit_error(str(exc))

    # ------------------------------------------------------------------ #
    # Shell management                                                   #
    # ------------------------------------------------------------------ #
    def _ensure_shell(self) -> str:
        if self.agent_type != "codex":
            raise ValueError(f"Unsupported agent '{self.agent_type}'")

        label = f"agent-{self.agent_type}-shared-c"
        with _state_lock:
            existing = _shell_by_agent.get(self.agent_type)

        if existing and self._is_shell_alive(existing):
            self._attach_session(existing)
            self._log("shell", f"reusing cached shell {existing}")
            return existing

        record = self._find_shell(label)
        if record:
            shell_id = record["id"]
            self._log("shell", f"found running shell {shell_id}")
            self._attach_session(shell_id)
            with _state_lock:
                _shell_by_agent[self.agent_type] = shell_id
            return shell_id

        shell_id = self._spawn_shell(label)
        self._log("shell", f"spawned new shell {shell_id}")
        self._attach_session(shell_id)
        with _state_lock:
            _shell_by_agent[self.agent_type] = shell_id
        return shell_id

    def _attach_session(self, shell_id: str) -> None:
        with _state_lock:
            _shell_by_session[self.session_id] = shell_id

    def _restore_session_state(self) -> None:
        session = get_session(self.session_id)
        if session and session.get("conversationId"):
            with _state_lock:
                _conversations[self.session_id] = session["conversationId"]
            self._log(
                "conversation",
                f"restored saved conversation {session['conversationId'][:8]}…",
            )

    def _initialize_shell(self) -> None:
        if not self.shell_id:
            raise RuntimeError("Shell not established")
        with _state_lock:
            if self.shell_id in _initialized_shells:
                return

        init_msg = {
            "jsonrpc": "2.0",
            "id": "init-mcp",
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "file_editor_cm6_ipc", "version": "1.0.0"},
            },
        }
        self._write_to_shell(json.dumps(init_msg) + "\n")
        time.sleep(0.2)
        with _state_lock:
            _initialized_shells.add(self.shell_id)

    # ------------------------------------------------------------------ #
    # Client message processing                                          #
    # ------------------------------------------------------------------ #
    def _handle_client_message(self, payload: Dict[str, Any]) -> None:
        if not self.shell_id:
            raise RuntimeError("Shell not ready")
        chat_session_id = payload.get("session") or self.session_id
        session = get_session(chat_session_id)
        if not session:
            raise ValueError(f"Session {chat_session_id} not found")

        # Conversation restoration logic
        _base_instructions, transcript_text = build_transcript(session.get("messages"))
        stored_shell = session.get("shell_id")
        stored_conversation = session.get("conversationId")
        needs_restore = bool(transcript_text) and (
            not stored_conversation or (stored_shell and stored_shell != self.shell_id)
        )

        original_text = payload.get("text", "")
        if needs_restore:
            payload["text"] = f"{transcript_text}\n\nUser: {original_text}"
            payload["conversationId"] = None
            CodexAdapter.clear_conversation(chat_session_id)
            self._log("conversation", f"injecting transcript ({len(transcript_text)} chars)")
        elif stored_conversation:
            payload["conversationId"] = stored_conversation
        else:
            payload["conversationId"] = None

        # Set up context for the agent
        context: Dict[str, Any] = {"cwd": self.cwd}
        if payload.get("file"):
            context.update(
                enrich_context(file_path=payload.get("file"), project_root=self.cwd) or {}
            )
        if session.get("fullAccess"):
            context.setdefault("approval_policy", "never")
            context.setdefault("sandbox", "danger-full-access")
        elif session.get("auto"):
            context.setdefault("approval_policy", "never")
            context.setdefault("sandbox", "workspace-write")

        # Persist user message before sending to agent
        request_id = f"msg-{uuid.uuid4().hex}"
        payload["id"] = request_id
        self._request_map[request_id] = chat_session_id
        
        append_message(
            chat_session_id,
            {
                "id": request_id,
                "type": "user",
                "text": original_text, # Persist original text, not the prepended one
                "timestamp": time.time(),
            },
        )
        
        # Update shell_id in session metadata
        update_session_metadata(chat_session_id, shell_id=self.shell_id)

        # Convert to agent message and send
        agent_msg = CodexAdapter.to_agent(payload, context)
        self._write_to_shell(json.dumps(agent_msg) + "\n")
        self._log(
            "pty-write",
            f"shell={self.shell_id} session={chat_session_id} bytes={len(json.dumps(agent_msg))}",
        )

    # ------------------------------------------------------------------ #
    # Shell output streaming                                             #
    # ------------------------------------------------------------------ #
    def _start_output_thread(self) -> None:
        self.output_thread = threading.Thread(target=self._stream_shell_output, daemon=True)
        self.output_thread.start()

    def _stream_shell_output(self) -> None:
        if not self.shell_id:
            return
        url = f"{FRAMEWORK_URL}/api/internal/shells/{self.shell_id}/stream"
        try:
            with requests.get(
                url,
                headers=self._auth_headers(),
                stream=True,
                timeout=(5, None),
            ) as resp:
                resp.raise_for_status()
                for raw in resp.iter_lines():
                    if not self.running:
                        break
                    if not raw or raw.startswith(b":"):
                        continue
                    data = raw[5:].strip() if raw.startswith(b"data:") else raw.strip()
                    if not data:
                        continue
                    try:
                        chunk_payload = json.loads(data.decode("utf-8"))
                    except Exception:
                        continue
                    chunk = chunk_payload.get("chunk")
                    if not chunk:
                        continue
                    self._process_agent_chunk(chunk)
        except requests.RequestException as exc:
            self._log("stream", f"shell stream failed: {exc}")
            self.emit_error(f"Shell stream error: {exc}")

    def _process_agent_chunk(self, chunk: str) -> None:
        self.line_buffer += chunk
        while "\n" in self.line_buffer:
            line, self.line_buffer = self.line_buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                agent_msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            
            normalized = CodexAdapter.from_agent(agent_msg)
            if not normalized:
                continue

            request_id = str(normalized.get("id", ""))
            chat_session = self._request_map.get(request_id) or self.session_id
            normalized["session"] = chat_session
            
            event = normalized.get("event")

            if event == "token":
                # Token is already stored by from_agent, just emit
                pass
            elif event == "conversation_started":
                conversation_id = normalized.get("conversationId")
                if conversation_id:
                    with _state_lock:
                        _conversations[chat_session] = conversation_id
                    update_session_metadata(chat_session, conversationId=conversation_id, shell_id=self.shell_id)
                    self._log(
                        "conversation",
                        f"{chat_session} conversation_id={conversation_id[:8]}…",
                    )
            elif event == "system":
                if normalized.get("reasoning") and not normalized.get("complete"):
                    # streaming-only reasoning; emit to UI but skip persistence
                    pass
                else:
                    append_message(
                        chat_session,
                        {
                            "id": f"msg-{uuid.uuid4().hex}",
                            "type": "system",
                            "text": normalized.get("text", ""),
                            "timestamp": time.time(),
                        },
                    )
            elif event == "tool_call":
                append_message(
                    chat_session,
                    {
                        "id": f"msg-{uuid.uuid4().hex}",
                        "type": "tool_call",
                        "tool": normalized.get("tool", ""),
                        "args": normalized.get("args", {}),
                        "timestamp": time.time(),
                    },
                )
            elif event == "diff":
                append_message(
                    chat_session,
                    {
                        "id": f"msg-{uuid.uuid4().hex}",
                        "type": "diff",
                        "path": normalized.get("path", ""),
                        "patch": normalized.get("patch", ""),
                        "timestamp": time.time(),
                    },
                )
            elif event == "final":
                complete_text = CodexAdapter.get_complete_message(request_id)
                append_message(
                    chat_session,
                    {
                        "id": request_id,
                        "type": "assistant",
                        "text": complete_text,
                        "timestamp": time.time(),
                    },
                )
                self._request_map.pop(request_id, None)
            elif event == "error":
                error_text = normalized.get("error") or normalized.get("text") or "Agent error"
                append_message(
                    chat_session,
                    {
                        "id": request_id or f"msg-{uuid.uuid4().hex}",
                        "type": "error",
                        "text": error_text,
                        "timestamp": time.time(),
                    },
                )
                if request_id:
                    self._request_map.pop(request_id, None)

            self._emit_event(normalized)

    # ------------------------------------------------------------------ #
    # HTTP helpers                                                       #
    # ------------------------------------------------------------------ #
    def _auth_headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        if FRAMEWORK_TOKEN:
            headers["X-Framework-Key"] = FRAMEWORK_TOKEN
        return headers

    def _is_shell_alive(self, shell_id: str) -> bool:
        url = f"{FRAMEWORK_URL}/api/internal/shells/{shell_id}"
        try:
            resp = requests.get(url, headers=self._auth_headers(), timeout=3)
            if not resp.ok:
                return False
            data = resp.json()
            return bool(data.get("stats", {}).get("alive"))
        except requests.RequestException:
            return False

    def _find_shell(self, label: str) -> Optional[dict]:
        url = f"{FRAMEWORK_URL}/api/internal/shells/find"
        try:
            resp = requests.get(
                url,
                params={"label": label, "status": "running"},
                headers=self._auth_headers(),
                timeout=3,
            )
            if resp.ok:
                return resp.json()
        except requests.RequestException:
            return None
        return None

    def _spawn_shell(self, label: str) -> str:
        url = f"{FRAMEWORK_URL}/api/internal/shells/spawn"
        payload = {
            "command": ["codex", "mcp-server"],
            "cwd": self.cwd,
            "label": label,
        }
        resp = requests.post(
            url,
            headers=self._auth_headers(),
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        shell_id = data.get("id")
        if not shell_id:
            raise RuntimeError("Spawn response missing shell id")
        return shell_id

    def _write_to_shell(self, data: str) -> None:
        if not self.shell_id:
            raise RuntimeError("Shell not ready")
        url = f"{FRAMEWORK_URL}/api/internal/shells/{self.shell_id}/write"
        resp = requests.post(
            url,
            headers=self._auth_headers(),
            json={"message": data},
            timeout=5,
        )
        resp.raise_for_status()

    # ------------------------------------------------------------------ #
    # Emission helpers                                                   #
    # ------------------------------------------------------------------ #
    def _send_connected_event(self) -> None:
        payload = {
            "agent": self.agent_type,
            "shell_id": self.shell_id,
            "session_id": self.session_id,
        }
        self.socketio.emit(
            "agent_connected",
            payload,
            room=self.sid,
            namespace="/agent",
        )

    def _emit_event(self, payload: Dict[str, Any]) -> None:
        self.socketio.emit(
            "agent_event",
            payload,
            room=self.sid,
            namespace="/agent",
        )

    def emit_error(self, message: str) -> None:
        self.socketio.emit(
            "agent_error",
            {"message": message},
            room=self.sid,
            namespace="/agent",
        )

    # ------------------------------------------------------------------ #
    # Logging                                                            #
    # ------------------------------------------------------------------ #
    def _log(self, stage: str, message: str) -> None:
        LOGGER.info("[AgentIPC][%s] %s", stage, message)
