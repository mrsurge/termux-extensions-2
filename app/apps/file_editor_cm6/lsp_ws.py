"""LSP Socket.IO Bridge.

vectorArc • 2025-12-08

Bridges Socket.IO events from CM6 LSP client to language server STDIO.
Uses the "Piggyback" strategy to attach /lsp namespace to existing NiceGUI Socket.IO.
"""

import asyncio
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import socketio

_LSP_NAMESPACE_INSTANCE: Optional["LSPSocketIONamespace"] = None

from framework_shells import get_manager, PipeState
from .lsp_shell_manager import get_or_spawn_lsp_shell
from .project_sidecar import ProjectSidecar

_PIPE_WRITE_LOCKS: Dict[str, asyncio.Lock] = {}


def _get_pipe_lock(shell_id: str) -> asyncio.Lock:
    lock = _PIPE_WRITE_LOCKS.get(shell_id)
    if lock is None:
        lock = asyncio.Lock()
        _PIPE_WRITE_LOCKS[shell_id] = lock
    return lock


_LSP_DEBUG = os.getenv("TE2_LSP_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}


def _lsp_debug(msg: str) -> None:
    if _LSP_DEBUG:
        try:
            print(msg, file=sys.stderr)
        except Exception:
            pass


def _lsp_error(msg: str) -> None:
    try:
        print(msg, file=sys.stderr)
    except Exception:
        pass


def _git_fingerprint(project_root: Path) -> Optional[str]:
    git_dir = project_root / ".git"
    if not git_dir.exists():
        return None

    try:
        head = subprocess.run(
            ["git", "--no-pager", "rev-parse", "HEAD"],
            cwd=str(project_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
            text=True,
        ).stdout.strip()

        status = subprocess.run(
            ["git", "--no-pager", "status", "--porcelain=v1", "-z"],
            cwd=str(project_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
        ).stdout

        # Include diff content so successive saves change the fingerprint even when porcelain lines don't.
        diff = subprocess.run(
            ["git", "--no-pager", "diff", "--no-color"],
            cwd=str(project_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
        ).stdout

        payload = (
            ("HEAD=" + head + "\n").encode("utf-8")
            + b"STATUS\0" + status
            + b"DIFF\0" + diff
        )
        # Short, stable id for comparisons/logs.
        return hashlib.sha256(payload).hexdigest()[:20]
    except Exception:
        return None


def _fs_fingerprint(project_root: Path, *, max_files: int = 5000) -> str:
    # Cheap-ish fallback when no git repo exists.
    exts = {".kt", ".java", ".xml", ".gradle", ".kts", ".properties"}
    pinned = {
        "settings.gradle",
        "settings.gradle.kts",
        "build.gradle",
        "build.gradle.kts",
        "gradle.properties",
        "gradle/wrapper/gradle-wrapper.properties",
    }

    items: list[str] = []

    for rel in sorted(pinned):
        p = project_root / rel
        try:
            st = p.stat()
        except Exception:
            continue
        items.append(f"{rel}|{st.st_mtime_ns}|{st.st_size}")

    count = 0
    for root, _dirs, files in os.walk(project_root):
        for name in files:
            if count >= max_files:
                break
            p = Path(root) / name
            try:
                rel = str(p.relative_to(project_root))
            except Exception:
                continue
            if rel in pinned:
                continue
            if p.suffix.lower() not in exts:
                continue
            try:
                st = p.stat()
            except Exception:
                continue
            items.append(f"{rel}|{st.st_mtime_ns}|{st.st_size}")
            count += 1
        if count >= max_files:
            break

    items.sort()
    return hashlib.sha256("\n".join(items).encode("utf-8")).hexdigest()[:20]


def _compute_repo_fingerprint(project_root: Path) -> str:
    return _git_fingerprint(project_root) or _fs_fingerprint(project_root)


async def publish_draft_diagnostics_to_client(
    *,
    language_id: str,
    project_root: Path,
    uri: str,
    draft_diagnostics: list[dict],
) -> bool:
    """Publish TE2-generated draft diagnostics without clobbering backend diagnostics.

    CM6 overwrites diagnostics per-URI on each publish. To avoid wiping Gradle-backed
    diagnostics, merge draft diagnostics with the last diagnostics received from
    the backend for that URI.
    """

    ns = _LSP_NAMESPACE_INSTANCE
    if ns is None:
        return False

    key = (str(language_id), str(project_root))
    session = ns.backend_sessions.get(key)
    if not session:
        return False

    sid = session.get("current_sid")
    if not sid:
        return False

    base = []
    try:
        cache = session.get("diagnostics_by_uri")
        if isinstance(cache, dict):
            base = cache.get(uri) or []
    except Exception:
        base = []

    try:
        base_no_draft = [
            d
            for d in (base if isinstance(base, list) else [])
            if (d or {}).get("source") != "te2-android:draft"
        ]
    except Exception:
        base_no_draft = base if isinstance(base, list) else []

    merged = base_no_draft + (draft_diagnostics if isinstance(draft_diagnostics, list) else [])

    payload = {
        "jsonrpc": "2.0",
        "method": "textDocument/publishDiagnostics",
        "params": {"uri": uri, "diagnostics": merged},
    }

    try:
        await ns.emit("lsp_server_to_client", payload, to=sid)
        try:
            cache = session.get("diagnostics_by_uri")
            if not isinstance(cache, dict):
                cache = {}
                session["diagnostics_by_uri"] = cache
            cache[uri] = merged
        except Exception:
            pass
        return True
    except Exception:
        return False


async def send_lsp_notification(
    *,
    language_id: str,
    project_root: Path,
    message: dict,
    spawn_if_missing: bool = False,
) -> bool:
    """Send a single JSON-RPC notification to a running LSP backend.

    This bypasses the iframe client entirely (useful for server-side hooks like /write).
    """

    mgr = await get_manager()

    rec = await mgr.find_shell_by_label(f"lsp:{language_id}", status="running")
    if not rec and spawn_if_missing:
        rec = await get_or_spawn_lsp_shell(str(language_id), project_root)

    if not rec:
        try:
            _lsp_error(f"[LSP SAVE HOOK] no running shell for {language_id}")
        except Exception:
            pass
        return False

    pipe_state = mgr.get_pipe_state(rec.id)
    if not pipe_state or not getattr(pipe_state, "process", None) or not getattr(pipe_state.process, "stdin", None):
        try:
            _lsp_error(f"[LSP SAVE HOOK] missing pipe_state for shell={rec.id}")
        except Exception:
            pass
        return False

    lock = _get_pipe_lock(rec.id)
    async with lock:
        try:
            # Add LSP framing (Content-Length header)
            body = json.dumps(message).encode("utf-8")
            header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
            pipe_state.process.stdin.write(header + body)
            await pipe_state.process.stdin.drain()
            return True
        except Exception:
            return False


async def send_android_did_save_for_path(*, project_root: Path, abs_path: Path) -> bool:
    """On successful save, push te2Android state + didSave into kotlin-android LSP."""

    try:
        repo_fp = await asyncio.to_thread(_compute_repo_fingerprint, project_root)
    except Exception:
        repo_fp = None

    dirty_files: list[str] = []
    try:
        sidecar = ProjectSidecar.load_or_create(str(project_root))
        for entry in sidecar.list_project_drafts():
            fp = entry.get("file_path")
            if fp:
                dirty_files.append(str(fp))
    except Exception:
        pass

    settings_msg = {
        "jsonrpc": "2.0",
        "method": "workspace/didChangeConfiguration",
        "params": {
            "settings": {
                "te2Android": {
                    "repoFingerprint": repo_fp,
                    "dirtyFiles": dirty_files,
                    "updatedAt": int(time.time() * 1000),
                }
            }
        },
    }

    uri = f"file://{str(abs_path)}"
    did_save_msg = {
        "jsonrpc": "2.0",
        "method": "textDocument/didSave",
        "params": {
            "textDocument": {
                "uri": uri,
            }
        },
    }

    ok1 = await send_lsp_notification(
        language_id="kotlin-android",
        project_root=project_root,
        message=settings_msg,
        spawn_if_missing=False,
    )
    ok2 = await send_lsp_notification(
        language_id="kotlin-android",
        project_root=project_root,
        message=did_save_msg,
        spawn_if_missing=False,
    )

    try:
        _lsp_error(f"[LSP SAVE HOOK] sent settings={ok1} didSave={ok2} uri={uri}")
    except Exception:
        pass

    return bool(ok1 and ok2)


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

    async def _send_android_state(self, sid: str, *, force: bool = False) -> None:
        key = self.sid_to_key.get(sid)
        session = self.backend_sessions.get(key) if key else None
        if not session or session.get("language_id") != "kotlin-android":
            return

        now = time.time()
        last = float(session.get("android_state_last_sent") or 0.0)
        if not force and (now - last) < 1.0:
            return

        project_root_raw = str(session.get("project_root") or "").strip()
        if not project_root_raw:
            return

        try:
            project_root = Path(project_root_raw)
        except Exception:
            return

        try:
            repo_fp = await asyncio.to_thread(_compute_repo_fingerprint, project_root)
        except Exception:
            return

        dirty_files: list[str] = []
        try:
            sidecar = ProjectSidecar.load_or_create(project_root_raw)
            # Drafts in ProjectSidecar session_cache are SSOT for "dirty".
            for entry in sidecar.list_project_drafts():
                fp = entry.get("file_path")
                if fp:
                    dirty_files.append(str(fp))
        except Exception:
            pass

        payload = {
            "jsonrpc": "2.0",
            "method": "workspace/didChangeConfiguration",
            "params": {
                "settings": {
                    "te2Android": {
                        "repoFingerprint": repo_fp,
                        "dirtyFiles": dirty_files,
                        "updatedAt": int(now * 1000),
                    }
                }
            },
        }

        await self._forward_to_backend(sid, payload)
        session["android_state_last_sent"] = now
    
    def __init__(self, namespace="/lsp"):
        super().__init__(namespace)
        global _LSP_NAMESPACE_INSTANCE
        _LSP_NAMESPACE_INSTANCE = self
        # sid -> key (language_id, project_root)
        self.sid_to_key: Dict[str, Tuple[str, str]] = {}

        # Long-lived backend sessions keyed by (language_id, project_root).
        self.backend_sessions: Dict[Tuple[str, str], dict] = {}

        # Pending messages per sid while initialization wiring is happening.
        self.pending_messages: Dict[str, list] = {}
        self.session_ready: Dict[str, asyncio.Event] = {}
        _lsp_debug(f"[LSP WS] Namespace initialized: {namespace}")

    async def _is_session_healthy(self, session: dict) -> bool:
        """Return True if the session's shell + pipe process are still alive.

        Users can manually exit LSP servers (or they can crash). In that case we
        must respawn on the next initialize rather than keeping a dead session
        around forever.
        """

        if not session or session.get("dead"):
            return False

        # The stdout bridge must be alive; if it crashed/never started, clients will
        # hang forever waiting for responses even though the subprocess is "running".
        try:
            task = session.get("reader_task")
            if not task or task.done():
                return False
        except Exception:
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
            # Whether we've forwarded the post-initialize "initialized" notification to the backend.
            # Some servers (notably pyright) may not fully serve requests until they receive it.
            "backend_initialized_notified": False,
            # Latest diagnostics forwarded from backend (per URI), used for safe TE2-side merges.
            "diagnostics_by_uri": {},
            "dead": False,
        }
        # Important: publish session before spawning the bridge task. The bridge
        # looked up sessions by key, and creating the task before storing caused
        # a race where the task could start, see no session, and exit permanently.
        self.backend_sessions[key] = session

        task = asyncio.create_task(self._bridge_backend_output(key))
        session["reader_task"] = task

        # Always surface reader crashes; otherwise the frontend will just time out forever.
        def _on_done(t: asyncio.Task) -> None:
            try:
                exc = t.exception()
            except asyncio.CancelledError:
                return
            except Exception as e:
                _lsp_error(f"[LSP WS] Reader task error (introspect failed): {e}")
                return
            if exc:
                _lsp_error(f"[LSP WS] Reader task crashed: {exc}")
                try:
                    session["dead"] = True
                except Exception:
                    pass

        try:
            task.add_done_callback(_on_done)
        except Exception:
            pass
        return session
    
    async def on_connect(self, sid, environ):
        _lsp_debug(f"[LSP WS] Client connected: {sid}")
        self.pending_messages[sid] = []
        self.session_ready[sid] = asyncio.Event()
    
    async def on_disconnect(self, sid):
        _lsp_debug(f"[LSP WS] Client disconnected: {sid}")
        key = self.sid_to_key.pop(sid, None)
        if key is not None:
            session = self.backend_sessions.get(key)
            if session and session.get("current_sid") == sid:
                session["current_sid"] = None

        self.pending_messages.pop(sid, None)
        self.session_ready.pop(sid, None)
    
    async def on_initialize(self, sid, data):
        """Client sends: { languageId: 'python', projectRoot: '/path/to/project' }"""
        _lsp_debug(f"[LSP WS] on_initialize called: sid={sid} data={data}")
        
        language_id = data.get("languageId")
        project_root = data.get("projectRoot", ".")
        
        if not language_id:
            await self.emit("lsp:error", {"error": "Missing languageId"}, to=sid)
            return
        
        _lsp_debug(f"[LSP WS] Initialize: {sid} lang={language_id} root={project_root}")

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
            _lsp_debug(f"[LSP WS] Processing {len(pending)} pending messages for {sid}")
            for msg in pending:
                await self._handle_client_message(sid, msg)
            self.pending_messages[sid] = []

        await self.emit("lsp_initialized", {"shellId": session.get("shell_id")}, to=sid)
    
    async def on_lsp_client_to_server(self, sid, message):
        """Receive JSON LSP message from client, forward to shell stdin."""
        _lsp_debug(f"[LSP WS] on_lsp_client_to_server: sid={sid} msg={str(message)[:200]}")

        key = self.sid_to_key.get(sid)
        session = self.backend_sessions.get(key) if key else None
        if not session:
            _lsp_debug(f"[LSP WS] Session not ready, queuing message for {sid}")
            if sid in self.pending_messages:
                self.pending_messages[sid].append(message)
            return

        await self._handle_client_message(sid, message)

    async def _handle_client_message(self, sid: str, message: dict) -> None:
        """Apply broker rules, then forward (or short-circuit)."""
        key = self.sid_to_key.get(sid)
        session = self.backend_sessions.get(key) if key else None
        if not session:
            return

        # Enforce single-attached-client: drop writes from stale sids.
        if session.get("current_sid") != sid:
            return

        if isinstance(message, dict):
            method = message.get("method")
            # Minimal always-on trace for the main regression gauge: document symbols.
            # This helps distinguish "pyright never responded" vs "response didn't reach the iframe".
            if method == "textDocument/documentSymbol":
                try:
                    req_id = message.get("id")
                    uri = ((message.get("params") or {}).get("textDocument") or {}).get("uri")
                    session["last_document_symbol_request_id"] = req_id
                    # Enable temporary read tracing so we can confirm whether the backend
                    # ever outputs a response frame for this request (big responses can be
                    # delayed, and this helps isolate where it is getting lost).
                    session["symbol_trace_until"] = time.time() + 35.0
                    session["symbol_trace_bytes"] = 0
                    session["symbol_trace_chunks"] = 0
                    _lsp_error(f"[LSP WS] documentSymbol request id={req_id} sid={sid} uri={uri}")
                except Exception:
                    pass
            elif method == "textDocument/didOpen":
                try:
                    uri = ((message.get("params") or {}).get("textDocument") or {}).get("uri")
                    lang = ((message.get("params") or {}).get("textDocument") or {}).get("languageId")
                    _lsp_error(f"[LSP WS] didOpen sid={sid} uri={uri} lang={lang}")
                except Exception:
                    pass

                # For Android Kotlin LSP, push current repo/dirty state on open.
                try:
                    if session.get("language_id") == "kotlin-android":
                        await self._send_android_state(sid, force=False)
                except Exception:
                    pass
            if method == "initialize":
                if session.get("initialized") and session.get("init_result_template") is not None:
                    _lsp_debug(f"[LSP WS] Short-circuit initialize for sid={sid}")
                    await self._emit_initialize_response(sid, message.get("id"), session.get("init_result_template"))
                    return
                if session.get("init_request_id") is None and message.get("id") is not None:
                    session["init_request_id"] = message.get("id")
                # Inject Android-specific initializationOptions for kotlin-android LSP
                if session.get("language_id") == "kotlin-android":
                    params = message.setdefault("params", {})
                    init_opts = params.setdefault("initializationOptions", {})

                    # Default to GeckoDebug variant (most common for Termux Android dev)
                    init_opts.setdefault("module", "app")
                    init_opts.setdefault("variant", "GeckoDebug")

                    # Stable per-project id (SSOT: ProjectSidecar.lsp.project_id)
                    try:
                        project_root = str(session.get("project_root") or "")
                        if project_root:
                            sidecar = ProjectSidecar.load_or_create(project_root)
                            pid = sidecar.get_or_create_lsp_project_id()
                            try:
                                sidecar.save()
                            except Exception:
                                pass
                            init_opts.setdefault("lspProjectId", pid)
                    except Exception:
                        pass

                    # TE2-controlled cache root (LSP will own per-project caches under this root)
                    try:
                        cache_root = (os.getenv("TE2_ANDROID_LSP_CACHE_ROOT") or "").strip()
                        if not cache_root:
                            cache_root = str(Path.home() / ".cache" / "te2_android_lsp")
                        init_opts.setdefault("cacheRoot", cache_root)
                    except Exception:
                        pass

                    _lsp_debug(f"[LSP WS] Injected Android initializationOptions: {init_opts}")
            elif method == "initialized":
                # Only forward the first "initialized" per backend session.
                if session.get("backend_initialized_notified"):
                    return
                session["backend_initialized_notified"] = True
            elif method == "textDocument/didSave":
                # For Android Kotlin LSP, push current repo/dirty state before save-driven compile logic.
                try:
                    if session.get("language_id") == "kotlin-android":
                        _lsp_error(f"[LSP WS] didSave -> sending te2Android state sid={sid}")
                        await self._send_android_state(sid, force=True)
                except Exception:
                    pass
            elif method in ("shutdown", "exit"):
                return

        await self._forward_to_backend(sid, message)

        # If the request never produces a response, emit a summary after the trace window.
        try:
            if isinstance(message, dict) and message.get("method") == "textDocument/documentSymbol":
                want_id = message.get("id")

                async def _trace_timeout() -> None:
                    await asyncio.sleep(36.0)
                    s2 = self.backend_sessions.get(key)
                    if not s2:
                        return
                    if s2.get("last_document_symbol_request_id") != want_id:
                        return
                    until = float(s2.get("symbol_trace_until") or 0.0)
                    if until and time.time() < until:
                        return
                    bytes_read = int(s2.get("symbol_trace_bytes") or 0)
                    chunks_read = int(s2.get("symbol_trace_chunks") or 0)
                    proc = (s2.get("pipe_state") or {}).process if isinstance(s2.get("pipe_state"), object) else None
                    try:
                        pipe_state = s2.get("pipe_state")
                        proc = getattr(pipe_state, "process", None) if pipe_state else None
                        rc = getattr(proc, "returncode", None) if proc else None
                    except Exception:
                        rc = None
                    pid = None
                    try:
                        pid = getattr(proc, "pid", None) if proc else None
                    except Exception:
                        pid = None
                    _lsp_error(
                        f"[LSP WS] documentSymbol timeout id={want_id} bytes_read={bytes_read} "
                        f"chunks_read={chunks_read} returncode={rc} pid={pid}"
                    )
                    try:
                        s2["symbol_trace_until"] = 0
                    except Exception:
                        pass

                asyncio.create_task(_trace_timeout())
        except Exception:
            pass
    
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
        key = self.sid_to_key.get(sid)
        session = self.backend_sessions.get(key) if key else None
        if not session:
            return
        
        pipe_state = session.get("pipe_state")
        if not pipe_state or not pipe_state.process or not pipe_state.process.stdin:
            _lsp_error(f"[LSP WS] No pipe state or stdin for session {sid}")
            return
        
        # Add LSP framing (Content-Length header)
        body = json.dumps(message).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
        
        lock = _get_pipe_lock(session.get("shell_id") or "")
        async with lock:
            try:
                pipe_state.process.stdin.write(header + body)
                await pipe_state.process.stdin.drain()
                # Confirm writes for key methods; helps distinguish "never wrote" vs "no response".
                try:
                    if isinstance(message, dict):
                        m = message.get("method")
                        mid = message.get("id")
                        if m in (
                            "initialize",
                            "initialized",
                            "textDocument/didOpen",
                            "textDocument/didSave",
                            "workspace/didChangeConfiguration",
                            "textDocument/documentSymbol",
                        ):
                            _lsp_error(f"[LSP WS] wrote method={m} id={mid} bytes={len(body)} sid={sid}")
                except Exception:
                    pass
            except Exception as e:
                _lsp_error(f"[LSP WS] Write error: {e}")
                try:
                    session["dead"] = True
                except Exception:
                    pass
    
    async def _bridge_backend_output(self, key: Tuple[str, str]):
        """Read from backend stdout forever; deliver to current sid (session broker)."""
        session = self.backend_sessions.get(key)
        shell_id = session.get("shell_id") if session else None
        pid = None
        try:
            pipe_state = session.get("pipe_state") if session else None
            pid = getattr(getattr(pipe_state, "process", None), "pid", None) if pipe_state else None
        except Exception:
            pid = None
        _lsp_error(f"[LSP WS] Bridge start key={key} shell_id={shell_id} pid={pid}")
        if not session:
            _lsp_error(f"[LSP WS] Bridge exit key={key} reason=no_session")
            return
        
        parser: LSPFrameParser = session["parser"]
        pipe_state: PipeState = session["pipe_state"]
        proc = pipe_state.process
        
        try:
            while not pipe_state.stop.is_set():
                if proc.stdout is None:
                    _lsp_error(f"[LSP WS] No stdout for {key}")
                    _lsp_error(f"[LSP WS] Bridge exit key={key} reason=no_stdout")
                    break
                
                try:
                    chunk = await asyncio.wait_for(proc.stdout.read(4096), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                
                if not chunk:
                    # EOF
                    _lsp_error(f"[LSP WS] EOF on {key}")
                    try:
                        session["dead"] = True
                    except Exception:
                        pass
                    _lsp_error(f"[LSP WS] Bridge exit key={key} reason=eof")
                    break

                # Temporary tracing window after documentSymbol requests.
                try:
                    until = session.get("symbol_trace_until") or 0
                    if until and time.time() < float(until):
                        session["symbol_trace_bytes"] = int(session.get("symbol_trace_bytes") or 0) + len(chunk)
                        session["symbol_trace_chunks"] = int(session.get("symbol_trace_chunks") or 0) + 1
                except Exception:
                    pass

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

                    # Minimal always-on trace for symbol responses.
                    try:
                        want_id = session.get("last_document_symbol_request_id")
                        if want_id is not None and isinstance(msg, dict) and msg.get("id") == want_id and "result" in msg:
                            res = msg.get("result")
                            res_len = len(res) if isinstance(res, list) else None
                            try:
                                bytes_read = int(session.get("symbol_trace_bytes") or 0)
                                chunks_read = int(session.get("symbol_trace_chunks") or 0)
                                _lsp_error(f"[LSP WS] documentSymbol trace bytes={bytes_read} chunks={chunks_read}")
                            except Exception:
                                pass
                            try:
                                session["symbol_trace_until"] = 0
                            except Exception:
                                pass
                            _lsp_error(f"[LSP WS] documentSymbol response id={want_id} result_len={res_len}")
                    except Exception:
                        pass

                    # Log + cache publishDiagnostics for debugging + safe TE2-side merges.
                    try:
                        if isinstance(msg, dict) and msg.get("method") == "textDocument/publishDiagnostics":
                            params = msg.get("params") or {}
                            diag_uri = params.get("uri", "?")
                            diags = params.get("diagnostics") or []
                            diag_count = len(diags)
                            _lsp_error(f"[LSP WS] publishDiagnostics uri={diag_uri} count={diag_count}")
                            try:
                                cache = session.get("diagnostics_by_uri")
                                if not isinstance(cache, dict):
                                    cache = {}
                                    session["diagnostics_by_uri"] = cache
                                if isinstance(diag_uri, str) and diag_uri:
                                    cache[diag_uri] = list(diags) if isinstance(diags, list) else []
                            except Exception:
                                pass
                    except Exception:
                        pass

                    current_sid = session.get("current_sid")
                    if not current_sid:
                        continue
                    await self.emit("lsp_server_to_client", msg, to=current_sid)
            if pipe_state.stop.is_set():
                _lsp_error(f"[LSP WS] Bridge exit key={key} reason=stop_set")
        except asyncio.CancelledError:
            _lsp_error(f"[LSP WS] Bridge exit key={key} reason=cancelled")
            pass
        except Exception as e:
            _lsp_error(f"[LSP WS] Reader error: {e}")
            try:
                session = self.backend_sessions.get(key)
                if session:
                    session["dead"] = True
            except Exception:
                pass
            _lsp_error(f"[LSP WS] Bridge exit key={key} reason=exception")
    
    # Note: on_disconnect is defined earlier in the class
