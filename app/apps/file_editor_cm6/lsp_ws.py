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
import uuid
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


def _label_for_language_root(language_id: str, project_root: Path) -> str:
    try:
        root_str = str(project_root.expanduser().resolve(strict=False))
    except Exception:
        root_str = str(project_root)
    digest = hashlib.sha1(root_str.encode("utf-8")).hexdigest()[:8]
    return f"lsp:{language_id}:{digest}"


def _find_pyright_config_root(file_path: Path, project_root: Path) -> tuple[Path | None, Path | None]:
    """Find nearest Pyright config root + file path between file_path and project_root."""
    try:
        start_dir = file_path if file_path.is_dir() else file_path.parent
    except Exception:
        start_dir = file_path.parent

    markers = ("pyrightconfig.json", "pyproject.toml")
    try:
        current = start_dir.expanduser().resolve(strict=False)
        stop_root = project_root.expanduser().resolve(strict=False)
    except Exception:
        current = start_dir
        stop_root = project_root

    visited = set()
    while True:
        if current in visited:
            break
        visited.add(current)
        try:
            for name in markers:
                candidate = current / name
                if candidate.exists():
                    return current, candidate
        except Exception:
            pass
        if current == stop_root:
            break
        if current.parent == current:
            break
        current = current.parent
    return None, None


async def _broadcast_lsp_busy(*, project_path: str, payload: dict) -> None:
    try:
        from app.apps.file_editor_cm6.explorer_ws import manager as _explorer_manager

        await _explorer_manager.broadcast(str(project_path), {"type": "lsp:busy", "payload": payload})
    except Exception:
        return


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
    has_drafts: bool = False,
) -> bool:
    """Publish TE2-generated draft diagnostics with intelligent arbitration.

    CM6 overwrites diagnostics per-URI on each publish. We merge draft diagnostics
    with backend diagnostics and apply arbitration rules to suppress ghost errors
    when the user has unsaved changes.

    Args:
        language_id: LSP language identifier.
        project_root: Project root path.
        uri: File URI.
        draft_diagnostics: TE2-generated draft diagnostics.
        has_drafts: Whether this specific file has unsaved changes.
    """

    ns = _LSP_NAMESPACE_INSTANCE
    if ns is None:
        return False

    key = (str(language_id), str(project_root))
    session = ns.backend_sessions.get(key)
    if not session:
        return False

    # Persist TE2 draft diagnostics on the session so that subsequent backend
    # publishDiagnostics (e.g. kotlin-android syntax diags on didChange) can be
    # merged before reaching CM6, avoiding "blink" where squiggles disappear.
    try:
        dd = session.get("draft_diagnostics_by_uri")
        if not isinstance(dd, dict):
            dd = {}
            session["draft_diagnostics_by_uri"] = dd
        dd[uri] = draft_diagnostics if isinstance(draft_diagnostics, list) else []
        hd = session.get("draft_has_drafts_by_uri")
        if not isinstance(hd, dict):
            hd = {}
            session["draft_has_drafts_by_uri"] = hd
        hd[uri] = bool(has_drafts)
    except Exception:
        pass

    sid = session.get("current_sid")
    if not sid:
        return False

    backend = []
    try:
        cache = session.get("diagnostics_by_uri")
        if isinstance(cache, dict):
            backend = cache.get(uri) or []
    except Exception:
        backend = []

    # Filter out previous TE2 draft diagnostics from backend
    try:
        backend_no_draft = [
            d
            for d in (backend if isinstance(backend, list) else [])
            if (d or {}).get("source") != "te2-android:draft"
        ]
    except Exception:
        backend_no_draft = backend if isinstance(backend, list) else []

    # Apply arbitration rules (Sprint C)
    try:
        from app.apps.file_editor_cm6.android_lang.diagnostic_arbitration import merge_android_diagnostics

        merged = merge_android_diagnostics(
            backend=backend_no_draft,
            draft=draft_diagnostics if isinstance(draft_diagnostics, list) else [],
            has_drafts=has_drafts,
        )
    except Exception:
        # Fallback to simple concatenation if arbitration fails
        merged = backend_no_draft + (draft_diagnostics if isinstance(draft_diagnostics, list) else [])

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


def get_diagnostics_summary_for_project(*, project_root: str) -> dict[str, dict]:
    """Return aggregated diagnostic counts per project-relative path.

    Returns:
        { "rel/path.kt": {"errors": N, "warnings": N}, ... }

    LSP severity: 1=Error, 2=Warning, 3=Information, 4=Hint
    We only count errors (1) and warnings (2).

    Note: This is rootRel-aware. LSP sessions may use an effective root that is
    a subdirectory of the base project root (e.g., <repo>/android for kotlin-android).
    We include those sessions and compute paths relative to the base project root.
    """

    project_root_str = str(project_root).rstrip("/")
    try:
        base_root_p = Path(project_root_str).expanduser().resolve(strict=False)
    except Exception:
        return {}

    # Always include persisted diagnostics cache (e.g. pyright workspace scan)
    # even if the LSP namespace isn't running.
    cached_summary: dict[str, dict] = {}
    try:
        from app.apps.file_editor_cm6.project_sidecar import ProjectSidecar

        sidecar = ProjectSidecar.load_or_create(project_root_str)
        cached_summary = sidecar.get_pyright_diagnostics_summary() or {}
    except Exception:
        cached_summary = {}

    ns = _LSP_NAMESPACE_INSTANCE

    result: dict[str, dict] = {}
    if ns is None:
        # No live LSP sessions; return cache only.
        return cached_summary if isinstance(cached_summary, dict) else {}

    # Iterate over all backend sessions whose root is the base project root
    # OR a subdirectory of it (rootRel-aware)
    for key, session in ns.backend_sessions.items():
        if not isinstance(session, dict):
            continue
        sess_root = session.get("project_root") or ""
        if not sess_root:
            continue

        # Check if session root matches or is a child of base project root
        try:
            sess_root_p = Path(sess_root).expanduser().resolve(strict=False)
            # Session root must be base_root or a descendant of it
            if sess_root_p != base_root_p:
                try:
                    sess_root_p.relative_to(base_root_p)
                except ValueError:
                    # Not a descendant, skip this session
                    continue
        except Exception:
            continue

        cache = session.get("diagnostics_by_uri")
        if not isinstance(cache, dict):
            continue

        for uri, diags in cache.items():
            if not isinstance(diags, list):
                continue

            # Convert file:// URI to absolute path
            abs_path = None
            if uri.startswith("file://"):
                abs_path = uri[7:]  # strip "file://"
            elif uri.startswith("/"):
                abs_path = uri
            else:
                continue

            # Convert to path relative to BASE project root (not session root)
            try:
                abs_p = Path(abs_path).expanduser().resolve(strict=False)
                if abs_p == base_root_p:
                    rel = "."
                else:
                    rel = str(abs_p.relative_to(base_root_p))
            except Exception:
                continue

            errors = 0
            warnings = 0
            for d in diags:
                if not isinstance(d, dict):
                    continue
                sev = d.get("severity")
                if sev == 1:
                    errors += 1
                elif sev in (2, 3, 4):
                    warnings += 1

            if errors > 0 or warnings > 0:
                existing = result.get(rel)
                if existing:
                    existing["errors"] = existing.get("errors", 0) + errors
                    existing["warnings"] = existing.get("warnings", 0) + warnings
                else:
                    result[rel] = {"errors": errors, "warnings": warnings}

    # Merge persisted diagnostics cache (avoid double-counting by using max).
    try:
        if isinstance(cached_summary, dict) and cached_summary:
            for rel, counts in cached_summary.items():
                if not isinstance(rel, str) or not rel:
                    continue
                if not isinstance(counts, dict):
                    continue
                e = int(counts.get("errors") or 0)
                w = int(counts.get("warnings") or 0)
                if e <= 0 and w <= 0:
                    continue
                existing = result.get(rel)
                if existing:
                    existing["errors"] = max(int(existing.get("errors") or 0), e)
                    existing["warnings"] = max(int(existing.get("warnings") or 0), w)
                else:
                    result[rel] = {"errors": e, "warnings": w}
    except Exception:
        pass

    return result


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

    # Android Kotlin LSP requires LSP JSON-RPC initialize() to have run before it can
    # handle didSave/didOpen/didChangeConfiguration (androidDiagnostics is lateinit).
    # TE2 server-side injections must be gated/queued to avoid crashing the server.
    try:
        if str(language_id) == "kotlin-android":
            ns = _LSP_NAMESPACE_INSTANCE
            if ns is None:
                return False

            root_key = str(project_root)
            try:
                root_key2 = str(project_root.expanduser().resolve(strict=False))
            except Exception:
                root_key2 = root_key

            session = None
            matched_root = root_key
            for rk in (root_key, root_key2):
                matched_root = rk
                session = getattr(ns, "backend_sessions", {}).get((str(language_id), rk))
                if session:
                    break

            # No connected client session yet (manual prewarm only). We can't safely inject
            # because the backend hasn't been initialized by the CM6 LSP client.
            if not session:
                return False

            if not session.get("initialized"):
                try:
                    pending = session.setdefault("pending_after_init", [])
                    if isinstance(pending, list):
                        pending.append(message)
                        # Keep queue bounded so a spammy save loop doesn't grow unbounded.
                        if len(pending) > 25:
                            del pending[:-25]
                    _lsp_error(
                        f"[LSP SAVE HOOK] queued until initialized lang={language_id} root={matched_root} method={message.get('method')}"
                    )
                except Exception:
                    pass
                return True
    except Exception:
        return False

    mgr = await get_manager()

    label = _label_for_language_root(str(language_id), project_root)
    rec = await mgr.find_shell_by_label(label, status="running")
    if not rec:
        legacy_label = f"lsp:{language_id}"
        if legacy_label != label:
            rec = await mgr.find_shell_by_label(legacy_label, status="running")
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
            stdin = pipe_state.process.stdin
            if stdin is None:
                return False
            stdin.write(header + body)
            await stdin.drain()
            return True
        except Exception:
            return False


async def send_android_did_save_for_path(*, project_root: Path, abs_path: Path) -> bool:
    """On successful save, push te2Android state + didSave into kotlin-android LSP."""

    try:
        repo_fp = await asyncio.to_thread(_compute_repo_fingerprint, project_root)
    except Exception:
        repo_fp = None

    # NOTE: Temporarily disable dirtyFiles propagation to kotlin-android until
    # Sprint E implements draft-buffer-backed unresolved diagnostics.
    # Otherwise the server may suppress or clear unresolved-import/reference
    # diagnostics for "dirty" files with no replacement, resulting in no squiggles.
    dirty_files: list[str] = []

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

    @staticmethod
    def _pyright_analysis_settings() -> dict:
        """Return python.analysis settings used for both config requests and change events."""
        return {
            "diagnosticMode": "workspace",
            "typeCheckingMode": "basic",
        }

    async def _send_pyright_settings(self, sid: str, *, force: bool = False) -> None:
        """Send workspace/didChangeConfiguration to pyright-langserver (best-effort).

        This makes the LSP emit the same class of diagnostics as the repo-wide
        pyright scan (workspace scope, non-off type checking).
        """
        key = self.sid_to_key.get(sid)
        session = self.backend_sessions.get(key) if key else None
        if not session or session.get("language_id") not in ("python", "pyright"):
            return

        now = time.time()
        last = float(session.get("pyright_settings_last_sent") or 0.0)
        if not force and (now - last) < 2.0:
            return

        try:
            await self._forward_to_backend(
                sid,
                {
                    "jsonrpc": "2.0",
                    "method": "workspace/didChangeConfiguration",
                    "params": {
                        "settings": {
                            "python": {
                                "analysis": self._pyright_analysis_settings(),
                            }
                        }
                    },
                },
            )
            session["pyright_settings_last_sent"] = now
        except Exception:
            return

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

        # NOTE: Temporarily disable dirtyFiles propagation to kotlin-android until
        # Sprint E implements draft-buffer-backed unresolved diagnostics.
        dirty_files: list[str] = []

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
        base_project_root = data.get("baseProjectRoot") or data.get("base_project_root")
        file_path = data.get("filePath") or data.get("file_path")
        pyright_cfg = data.get("pyrightConfigPath") or data.get("pyright_config_path")
        
        if not language_id:
            await self.emit("lsp:error", {"error": "Missing languageId"}, to=sid)
            return
        
        if str(language_id or "").lower() == "python":
            try:
                base_root = Path(base_project_root or project_root or ".")
                if pyright_cfg:
                    cfg_dir = Path(pyright_cfg).expanduser().resolve(strict=False).parent
                    if cfg_dir.exists():
                        project_root = str(cfg_dir)
                elif file_path:
                    cfg_root, _cfg_path = _find_pyright_config_root(Path(file_path), base_root)
                    if cfg_root and cfg_root.exists():
                        project_root = str(cfg_root)
                elif base_project_root:
                    project_root = str(base_root)
            except Exception:
                pass

        _lsp_debug(f"[LSP WS] Initialize: {sid} lang={language_id} root={project_root}")

        key = (str(language_id), str(project_root))
        self.sid_to_key[sid] = key

        session = await self._ensure_backend_session(language_id, project_root)
        if session is None:
            await self.emit("lsp:error", {"error": f"Failed to spawn LSP for {language_id}"}, to=sid)
            return

        # Single-attached-client policy: steal attachment on reconnect.
        session["current_sid"] = sid
        if base_project_root:
            session["base_project_root"] = str(base_project_root)

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

                # For Pyright, re-send config on didOpen so long-lived servers
                # converge even if they started before our config injection existed.
                try:
                    await self._send_pyright_settings(sid, force=False)
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
                    template = session.get("init_result_template")
                    await self._emit_initialize_response(
                        sid,
                        message.get("id"),
                        template if isinstance(template, dict) else None,
                    )
                    return
                if session.get("init_request_id") is None and message.get("id") is not None:
                    session["init_request_id"] = message.get("id")
                # For Pyright, force a real rootUri/workspaceFolders so it doesn't fall back
                # to "<default workspace root>" (and so config discovery works).
                if session.get("language_id") in ("python", "pyright"):
                    params = message.setdefault("params", {})
                    root_str = str(session.get("project_root") or session.get("base_project_root") or "").strip()
                    if root_str:
                        root_uri = f"file://{root_str}"
                        # Always override for Pyright so it never falls back to "<default workspace root>".
                        params["rootUri"] = root_uri
                        params["rootPath"] = root_str
                        params["workspaceFolders"] = [{"name": "root", "uri": root_uri}]
                # Inject Android-specific initializationOptions for kotlin-android LSP
                if session.get("language_id") == "kotlin-android":
                    params = message.setdefault("params", {})
                    init_opts = params.setdefault("initializationOptions", {})

                    # Module/variant come from project sidecar (preferred), fallback to defaults.
                    module = "app"
                    variant = "GeckoDebug"
                    try:
                        base_root = str(session.get("base_project_root") or session.get("project_root") or "")
                        if base_root:
                            from app.apps.file_editor_cm6.android_lang.android_lsp_config import get_android_lsp_config

                            cfg = get_android_lsp_config(Path(base_root))
                            module = str(cfg.get("module") or module)
                            variant = str(cfg.get("variant") or variant)
                    except Exception:
                        pass
                    init_opts.setdefault("module", module)
                    init_opts.setdefault("variant", variant)

                    # Stable per-project id (SSOT: ProjectSidecar.lsp.project_id)
                    try:
                        base_root = str(session.get("base_project_root") or session.get("project_root") or "")
                        if base_root:
                            sidecar = ProjectSidecar.load_or_create(base_root)
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
                # For pyright, inject workspace-wide diagnostics settings so the LSP
                # agrees with the repo-wide pyright scan behavior.
                try:
                    if session.get("language_id") in ("python", "pyright"):
                        await self._send_pyright_settings(sid, force=True)
                except Exception:
                    pass
            elif method == "textDocument/didSave":
                # For Android Kotlin LSP, push current repo/dirty state before save-driven compile logic.
                try:
                    if session.get("language_id") == "kotlin-android":
                        _lsp_error(f"[LSP WS] didSave -> sending te2Android state sid={sid}")
                        await self._send_android_state(sid, force=True)
                except Exception:
                    pass
                # Emit a host-side "busy" signal for save-triggered compile/analysis.
                # The kotlin-android backend often compiles or re-analyzes on didSave.
                try:
                    if session.get("language_id") == "kotlin-android":
                        uri = ((message.get("params") or {}).get("textDocument") or {}).get("uri")
                        if isinstance(uri, str) and uri:
                            base_root = str(session.get("base_project_root") or session.get("project_root") or "")
                            if base_root:
                                # Delay-start the fallback busy indicator to avoid flicker and avoid
                                # duplicating LSP $/progress (workDoneProgress) indicators.
                                pending_save = session.get("save_compile_pending_by_uri")
                                if not isinstance(pending_save, dict):
                                    pending_save = {}
                                    session["save_compile_pending_by_uri"] = pending_save

                                # Cancel prior per-URI pending timers.
                                try:
                                    prev = pending_save.get(uri)
                                    if isinstance(prev, dict):
                                        t = prev.get("timer_task")
                                        if isinstance(t, asyncio.Task):
                                            t.cancel()
                                except Exception:
                                    pass

                                task_id = uuid.uuid4().hex
                                started_at_ms = int(time.time() * 1000)
                                started_mono = time.monotonic()

                                async def _delayed_start() -> None:
                                    try:
                                        await asyncio.sleep(0.35)
                                        pend2 = session.get("save_compile_pending_by_uri")
                                        if not isinstance(pend2, dict):
                                            return
                                        rec2 = pend2.get(uri)
                                        if not isinstance(rec2, dict):
                                            return
                                        if str(rec2.get("task_id") or "") != task_id:
                                            return

                                        # If work progress is active, don't start fallback busy.
                                        wp = session.get("work_progress_tasks")
                                        if isinstance(wp, dict) and wp:
                                            pend2.pop(uri, None)
                                            return

                                        pend2.pop(uri, None)

                                        pending = session.get("compile_busy_by_uri")
                                        if not isinstance(pending, dict):
                                            pending = {}
                                            session["compile_busy_by_uri"] = pending

                                        # Cancel prior per-URI timers (we only show the latest save run).
                                        try:
                                            prev2 = pending.get(uri)
                                            if isinstance(prev2, dict):
                                                st = prev2.get("settle_task")
                                                tt = prev2.get("timeout_task")
                                                if isinstance(st, asyncio.Task):
                                                    st.cancel()
                                                if isinstance(tt, asyncio.Task):
                                                    tt.cancel()
                                        except Exception:
                                            pass

                                        pending[uri] = {
                                            "task_id": task_id,
                                            "base_root": base_root,
                                            "started_at_ms": started_at_ms,
                                            "started_mono": started_mono,
                                            "settle_task": None,
                                            "timeout_task": None,
                                        }

                                        await _broadcast_lsp_busy(
                                            project_path=base_root,
                                            payload={
                                                "taskId": task_id,
                                                "languageId": "kotlin-android",
                                                "busy": True,
                                                "activity": "gradle_compile",
                                                "detail": "Compiling (on save)…",
                                                "startedAtMs": started_at_ms,
                                                "uri": uri,
                                            },
                                        )

                                        async def _timeout_end() -> None:
                                            try:
                                                await asyncio.sleep(60.0)
                                                pend3 = session.get("compile_busy_by_uri")
                                                if not isinstance(pend3, dict):
                                                    return
                                                rec3 = pend3.get(uri)
                                                if not isinstance(rec3, dict):
                                                    return
                                                if str(rec3.get("task_id") or "") != task_id:
                                                    return
                                                pend3.pop(uri, None)
                                                dur_ms = max(
                                                    0,
                                                    int(
                                                        (time.monotonic() - float(rec3.get("started_mono") or time.monotonic()))
                                                        * 1000
                                                    ),
                                                )
                                                await _broadcast_lsp_busy(
                                                    project_path=base_root,
                                                    payload={
                                                        "taskId": task_id,
                                                        "languageId": "kotlin-android",
                                                        "busy": False,
                                                        "activity": "gradle_compile",
                                                        "detail": "Compiling (on save)…",
                                                        "ok": False,
                                                        "error": "timeout waiting for diagnostics",
                                                        "durationMs": dur_ms,
                                                        "uri": uri,
                                                    },
                                                )
                                            except Exception:
                                                return

                                        pending[uri]["timeout_task"] = asyncio.create_task(_timeout_end())
                                    except asyncio.CancelledError:
                                        return
                                    except Exception:
                                        return

                                timer_task = asyncio.create_task(_delayed_start())
                                pending_save[uri] = {
                                    "task_id": task_id,
                                    "timer_task": timer_task,
                                    "started_at_ms": started_at_ms,
                                    "started_mono": started_mono,
                                }
                except Exception:
                    pass
            elif method in ("shutdown", "exit"):
                return

        await self._forward_to_backend(sid, message)

        # If the request never produces a response, emit a summary after the trace window.
        try:
            if isinstance(message, dict) and message.get("method") == "textDocument/documentSymbol":
                want_id = message.get("id")
                if not key:
                    return
                key2 = key

                async def _trace_timeout() -> None:
                    await asyncio.sleep(36.0)
                    s2 = self.backend_sessions.get(key2)
                    if not s2:
                        return
                    if s2.get("last_document_symbol_request_id") != want_id:
                        return
                    until = float(s2.get("symbol_trace_until") or 0.0)
                    if until and time.time() < until:
                        return
                    bytes_read = int(s2.get("symbol_trace_bytes") or 0)
                    chunks_read = int(s2.get("symbol_trace_chunks") or 0)
                    proc = None
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
    
    async def _emit_initialize_response(self, sid: str, request_id: Any, template: dict | None) -> None:
        if request_id is None:
            return
        if template is None:
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

    async def _forward_session_to_backend(self, session: dict, message: dict) -> bool:
        """Forward a single message to a backend session without requiring a live sid.

        Used to flush queued server-side notifications after initialize.
        """

        if not session:
            return False
        pipe_state = session.get("pipe_state")
        if not pipe_state or not pipe_state.process or not pipe_state.process.stdin:
            return False

        body = json.dumps(message).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")

        lock = _get_pipe_lock(session.get("shell_id") or "")
        async with lock:
            try:
                pipe_state.process.stdin.write(header + body)
                await pipe_state.process.stdin.drain()
                return True
            except Exception:
                try:
                    session["dead"] = True
                except Exception:
                    pass
                return False
    
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
        pipe_state = session.get("pipe_state")
        if not pipe_state or not getattr(pipe_state, "process", None):
            _lsp_error(f"[LSP WS] Bridge exit key={key} reason=no_pipe_state")
            try:
                session["dead"] = True
            except Exception:
                pass
            return
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
                            # Flush any queued server-side notifications that were held until initialize.
                            try:
                                pending = session.pop("pending_after_init", None)
                            except Exception:
                                pending = None
                            if isinstance(pending, list) and pending:
                                _lsp_error(f"[LSP WS] flushing {len(pending)} queued notifications after initialize key={key}")
                                for qm in pending:
                                    try:
                                        await self._forward_session_to_backend(session, qm)
                                    except Exception:
                                        pass
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
                            # For kotlin-android, backend publishes diagnostics frequently (syntax on didChange).
                            # CM6 treats publishDiagnostics as replace-all, so we must merge in TE2 draft
                            # diagnostics (if any) before forwarding to avoid squiggle "blink".
                            try:
                                if (
                                    session.get("language_id") == "kotlin-android"
                                    and isinstance(diag_uri, str)
                                    and diag_uri
                                    and isinstance(diags, list)
                                ):
                                    dd = session.get("draft_diagnostics_by_uri")
                                    hd = session.get("draft_has_drafts_by_uri")
                                    draft_diags = dd.get(diag_uri) if isinstance(dd, dict) else None
                                    has_drafts = bool(hd.get(diag_uri)) if isinstance(hd, dict) else False

                                    if isinstance(draft_diags, list) and draft_diags:
                                        try:
                                            from app.apps.file_editor_cm6.android_lang.diagnostic_arbitration import (
                                                merge_android_diagnostics,
                                            )
                                            merged = merge_android_diagnostics(
                                                backend=diags,
                                                draft=draft_diags,
                                                has_drafts=has_drafts,
                                            )
                                        except Exception:
                                            merged = diags + draft_diags
                                        params["diagnostics"] = merged
                                        msg["params"] = params
                                        diags = merged
                            except Exception:
                                pass
                            try:
                                cache = session.get("diagnostics_by_uri")
                                if not isinstance(cache, dict):
                                    cache = {}
                                    session["diagnostics_by_uri"] = cache
                                if isinstance(diag_uri, str) and diag_uri:
                                    cache[diag_uri] = list(diags) if isinstance(diags, list) else []
                            except Exception:
                                pass

                            # For Pyright, keep the persisted explorer diagnostics cache in sync with
                            # live publishDiagnostics so dots can clear immediately when a file becomes clean.
                            try:
                                if session.get("language_id") in ("python", "pyright") and isinstance(diag_uri, str) and diag_uri:
                                    base_root = str(session.get("base_project_root") or session.get("project_root") or "")
                                    if base_root:
                                        # Convert URI -> rel path under base project root.
                                        abs_path = None
                                        if diag_uri.startswith("file://"):
                                            abs_path = diag_uri[7:]
                                        elif diag_uri.startswith("/"):
                                            abs_path = diag_uri
                                        if abs_path:
                                            try:
                                                base_p = Path(base_root).expanduser().resolve(strict=False)
                                                abs_p = Path(abs_path).expanduser().resolve(strict=False)
                                                rel = "." if abs_p == base_p else str(abs_p.relative_to(base_p))
                                            except Exception:
                                                rel = None
                                            if isinstance(rel, str) and rel and rel != ".":
                                                # Count errors/warnings (treat 2/3/4 as warnings like explorer).
                                                e = 0
                                                w = 0
                                                if isinstance(diags, list):
                                                    for d in diags:
                                                        if not isinstance(d, dict):
                                                            continue
                                                        sev = d.get("severity")
                                                        if sev == 1:
                                                            e += 1
                                                        elif sev in (2, 3, 4):
                                                            w += 1

                                                from app.apps.file_editor_cm6.project_sidecar import ProjectSidecar

                                                sidecar = ProjectSidecar.load_or_create(str(base_p))
                                                raw = sidecar.dump_raw()
                                                dc = raw.get("diagnostics_cache") or {}
                                                py = dc.get("pyright") or {}
                                                sb = py.get("summaryByRel") or {}
                                                if not isinstance(sb, dict):
                                                    sb = {}
                                                if e <= 0 and w <= 0:
                                                    sb.pop(rel, None)
                                                else:
                                                    sb[rel] = {"errors": int(e), "warnings": int(w)}

                                                # Persist back via API so types are normalized.
                                                sidecar.set_pyright_diagnostics_summary(
                                                    summary_by_rel=sb,
                                                    effective_root=str(session.get("project_root") or ""),
                                                    repo_fingerprint=str(py.get("repoFingerprint") or "") or None,
                                                )
                                                try:
                                                    sidecar.save()
                                                except Exception:
                                                    pass

                                                # Push updated explorer snapshot immediately (don't wait for 1s poll loop).
                                                try:
                                                    from app.apps.file_editor_cm6.explorer_ws import manager as _explorer_manager

                                                    summary = get_diagnostics_summary_for_project(project_root=str(base_p))
                                                    await _explorer_manager.broadcast(
                                                        str(base_p),
                                                        {"type": "explorer:updateDiagnostics", "payload": {"diagnostics": summary}},
                                                    )
                                                except Exception:
                                                    pass
                            except Exception:
                                pass

                            # Save-triggered compile/analysis: end busy after diagnostics settle for this URI.
                            try:
                                if session.get("language_id") == "kotlin-android" and isinstance(diag_uri, str) and diag_uri:
                                    pending = session.get("compile_busy_by_uri")
                                    if not isinstance(pending, dict):
                                        pending = {}
                                        session["compile_busy_by_uri"] = pending
                                    rec = pending.get(diag_uri)
                                    if isinstance(rec, dict) and rec.get("task_id"):
                                        task_id = str(rec.get("task_id"))
                                        base_root = str(rec.get("base_root") or session.get("base_project_root") or session.get("project_root") or "")
                                        if base_root:
                                            # Reset settle timer.
                                            try:
                                                st = rec.get("settle_task")
                                                if isinstance(st, asyncio.Task):
                                                    st.cancel()
                                            except Exception:
                                                pass

                                            sess: dict = session

                                            async def _settle_end() -> None:
                                                try:
                                                    await asyncio.sleep(0.75)
                                                    pend2 = sess.get("compile_busy_by_uri")
                                                    if not isinstance(pend2, dict):
                                                        return
                                                    pend2_dict: dict = pend2
                                                    rec2 = pend2_dict.get(diag_uri)
                                                    if not isinstance(rec2, dict):
                                                        return
                                                    if str(rec2.get("task_id") or "") != task_id:
                                                        return
                                                    pend2_dict.pop(diag_uri, None)
                                                    try:
                                                        tt = rec2.get("timeout_task")
                                                        if isinstance(tt, asyncio.Task):
                                                            tt.cancel()
                                                    except Exception:
                                                        pass
                                                    dur_ms = max(0, int((time.monotonic() - float(rec2.get("started_mono") or time.monotonic())) * 1000))
                                                    await _broadcast_lsp_busy(
                                                        project_path=base_root,
                                                        payload={
                                                            "taskId": task_id,
                                                            "languageId": "kotlin-android",
                                                            "busy": False,
                                                            "activity": "gradle_compile",
                                                            "detail": "Compiling (on save)…",
                                                            "ok": True,
                                                            "durationMs": dur_ms,
                                                            "uri": diag_uri,
                                                        },
                                                    )
                                                except Exception:
                                                    return

                                            rec["settle_task"] = asyncio.create_task(_settle_end())
                            except Exception:
                                pass
                    except Exception:
                        pass

                    # Pyright requests workspace/configuration for python.analysis; respond here
                    # since the CM6 client does not implement it.
                    try:
                        if (
                            isinstance(msg, dict)
                            and session.get("language_id") in ("python", "pyright")
                            and msg.get("method") == "workspace/configuration"
                        ):
                            req_id = msg.get("id")
                            params = msg.get("params") or {}
                            items = params.get("items")
                            analysis = self._pyright_analysis_settings()
                            result: list = []
                            if isinstance(items, list) and items:
                                for item in items:
                                    section = item.get("section") if isinstance(item, dict) else None
                                    if section == "python.analysis":
                                        result.append(dict(analysis))
                                    elif section == "python":
                                        result.append({"analysis": dict(analysis)})
                                    elif section in (None, ""):
                                        result.append({"python": {"analysis": dict(analysis)}})
                                    else:
                                        result.append(None)
                            else:
                                result = [{"python": {"analysis": dict(analysis)}}]

                            if req_id is not None:
                                await self._forward_session_to_backend(
                                    session,
                                    {"jsonrpc": "2.0", "id": req_id, "result": result},
                                )
                                continue
                    except Exception:
                        pass

                    # Work done progress ($/progress): surface longer backend work (compile/index) to host UI.
                    try:
                        if isinstance(msg, dict) and session.get("language_id") == "kotlin-android":
                            method = msg.get("method")
                            if method == "window/workDoneProgress/create":
                                # NOTE: This is a request in LSP (has an "id"). The browser client does
                                # not implement it, so we must ACK it here or the server may block and
                                # never emit $/progress.
                                try:
                                    params = msg.get("params") or {}
                                    token = params.get("token")
                                    wps = session.get("work_progress_known_tokens")
                                    if not isinstance(wps, set):
                                        wps = set()
                                        session["work_progress_known_tokens"] = wps
                                    if token is not None:
                                        wps.add(str(token))
                                except Exception:
                                    pass

                                try:
                                    req_id = msg.get("id")
                                    if req_id is not None:
                                        await self._forward_session_to_backend(
                                            session,
                                            {"jsonrpc": "2.0", "id": req_id, "result": None},
                                        )
                                        # Do not forward this request to the iframe.
                                        continue
                                except Exception:
                                    pass
                            elif method == "$/progress":
                                params = msg.get("params") or {}
                                token = params.get("token")
                                value = params.get("value") or {}
                                kind = (value.get("kind") or "").lower() if isinstance(value, dict) else ""

                                if token is not None and kind in {"begin", "report", "end"}:
                                    token_s = str(token)
                                    tasks = session.get("work_progress_tasks")
                                    if not isinstance(tasks, dict):
                                        tasks = {}
                                        session["work_progress_tasks"] = tasks

                                    base_root = str(session.get("base_project_root") or session.get("project_root") or "")
                                    title = str(value.get("title") or "")
                                    message2 = str(value.get("message") or "")
                                    detail = (title or message2 or "Working…").strip()
                                    # Label it "gradle_compile" when it looks like compile/build.
                                    dlow = detail.lower()
                                    activity = "work_progress"
                                    if any(x in dlow for x in ("gradle", "compile", "compil", "build")):
                                        activity = "gradle_compile"

                                    if kind == "begin":
                                        # Cancel fallback didSave busy for active file if progress is present.
                                        try:
                                            pend_save = session.get("save_compile_pending_by_uri")
                                            if isinstance(pend_save, dict):
                                                for u, rec in list(pend_save.items()):
                                                    try:
                                                        t = (rec or {}).get("timer_task")
                                                        if isinstance(t, asyncio.Task):
                                                            t.cancel()
                                                    except Exception:
                                                        pass
                                                    try:
                                                        pend_save.pop(u, None)
                                                    except Exception:
                                                        pass
                                        except Exception:
                                            pass

                                        task_id = f"wp:{token_s}"
                                        tasks[token_s] = {
                                            "task_id": task_id,
                                            "started_mono": time.monotonic(),
                                            "started_at_ms": int(time.time() * 1000),
                                            "detail": detail,
                                            "activity": activity,
                                            "base_root": base_root,
                                        }
                                        if base_root:
                                            await _broadcast_lsp_busy(
                                                project_path=base_root,
                                                payload={
                                                    "taskId": task_id,
                                                    "languageId": "kotlin-android",
                                                    "busy": True,
                                                    "activity": activity,
                                                    "detail": detail,
                                                    "startedAtMs": int(time.time() * 1000),
                                                },
                                            )
                                    elif kind == "report":
                                        # Keep spinner up; optionally update detail (no toast spam).
                                        rec = tasks.get(token_s) if isinstance(tasks, dict) else None
                                        if isinstance(rec, dict):
                                            rec["detail"] = detail or rec.get("detail") or ""
                                            rec["activity"] = activity or rec.get("activity") or "work_progress"
                                    elif kind == "end":
                                        rec = tasks.pop(token_s, None) if isinstance(tasks, dict) else None
                                        if isinstance(rec, dict) and base_root:
                                            dur_ms = max(0, int((time.monotonic() - float(rec.get("started_mono") or time.monotonic())) * 1000))
                                            await _broadcast_lsp_busy(
                                                project_path=base_root,
                                                payload={
                                                    "taskId": str(rec.get("task_id") or f"wp:{token_s}"),
                                                    "languageId": "kotlin-android",
                                                    "busy": False,
                                                    "activity": str(rec.get("activity") or activity or "work_progress"),
                                                    "detail": str(rec.get("detail") or detail or ""),
                                                    "ok": True,
                                                    "durationMs": dur_ms,
                                                },
                                            )
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
