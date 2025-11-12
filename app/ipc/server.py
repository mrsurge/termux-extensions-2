"""Standalone IPC microservice.

Provides synchronous REST endpoints and an SSE stream that other services can
use to communicate with the Termux Extensions framework without depending on
its ASGI event loop. The service acts as a lightweight control plane that can
forward control commands (e.g., shutdown, agent spawn) to the framework and
broadcast status updates to connected listeners.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import queue
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Set

import requests
from flask import Flask, Response, jsonify, request
from flask_socketio import SocketIO
from flask_socketio import Namespace, SocketIO, emit

from .control import FrameworkError, spawn_agent
from .process_manager import ProcessRegistry

LOGGER = logging.getLogger("te.ipc")
FRAMEWORK_URL = os.environ.get("TE_FRAMEWORK_URL", "http://127.0.0.1:8088")
FRAMEWORK_TOKEN = os.environ.get("TE_FRAMEWORK_SHELL_TOKEN")
_REGISTERED_IPC_MODULES: Set[str] = set()
_APPS_DIR = Path(__file__).resolve().parent.parent / "apps"

_listeners_lock = threading.Lock()
_listeners: Set[queue.Queue] = set()


def _broadcast(event: Dict[str, Any]) -> None:
    """Push an event to all connected SSE listeners."""
    with _listeners_lock:
        listeners = list(_listeners)
    for listener in listeners:
        try:
            listener.put_nowait(event)
        except Exception:
            with _listeners_lock:
                _listeners.discard(listener)


def _register_listener() -> queue.Queue:
    q: queue.Queue = queue.Queue()
    with _listeners_lock:
        _listeners.add(q)
    return q


def _unregister_listener(q: queue.Queue) -> None:
    with _listeners_lock:
        _listeners.discard(q)


def _cors_headers(response) -> Any:
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,X-Framework-Key"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response


def _log_prefix_enabled() -> bool:
    return os.environ.get("IPC_LOG_PREFIX") == "1"


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format=("[ipc] %(message)s" if _log_prefix_enabled() else "%(message)s"),
    )


def _load_ipc_modules(app: Flask, socketio: SocketIO) -> None:
    """Discover and register app-level IPC stacks."""
    if not _APPS_DIR.exists():
        LOGGER.debug("IPC module scan skipped; %s missing", _APPS_DIR)
        return

    for app_dir in _APPS_DIR.iterdir():
        if not app_dir.is_dir():
            continue
        manifest_path = app_dir / "manifest.json"
        if not manifest_path.exists():
            continue

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            LOGGER.error("Failed to parse manifest %s: %s", manifest_path, exc)
            continue

        modules = manifest.get("ipc_modules") or []
        if not isinstance(modules, list):
            continue

        for module_path in modules:
            if not isinstance(module_path, str):
                continue
            if module_path in _REGISTERED_IPC_MODULES:
                continue
            try:
                module = importlib.import_module(module_path)
                register = getattr(module, "register_ipc_routes", None)
                if callable(register):
                    register(app, socketio)
                    _REGISTERED_IPC_MODULES.add(module_path)
                    LOGGER.info("Loaded IPC module %s", module_path)
            except Exception as exc:
                LOGGER.error("Failed to load IPC module %s: %s", module_path, exc)


def create_app() -> Flask:
    app = Flask(__name__)
    
    # Create global process registry
    process_registry = ProcessRegistry()

    @app.after_request
    def _apply_cors(response):  # type: ignore[override]
        return _cors_headers(response)

    @app.route("/health", methods=["GET"])
    def health() -> Dict[str, str]:
        return {"status": "ok"}
    
    @app.route("/processes/register", methods=["POST", "OPTIONS"])
    def register_process() -> Any:
        """Register a process with IPC."""
        if request.method == "OPTIONS":
            return ("", 204)
        
        payload = request.get_json(silent=True) or {}
        pid = payload.get("pid")
        type = payload.get("type")
        
        if not pid or not type:
            return jsonify({"ok": False, "error": "pid and type required"}), 400
        
        try:
            record = process_registry.register(
                pid=int(pid),
                type=str(type),
                label=payload.get("label"),
                parent_pid=payload.get("parent_pid"),
                metadata=payload.get("metadata", {}),
            )
            LOGGER.info("Registered process: pid=%d type=%s label=%s", pid, type, record.label)
            return jsonify({"ok": True, "data": record.to_dict()})
        except Exception as exc:
            LOGGER.error("Failed to register process: %s", exc)
            return jsonify({"ok": False, "error": str(exc)}), 500
    
    @app.route("/processes/unregister", methods=["POST", "OPTIONS"])
    def unregister_process() -> Any:
        """Unregister a process."""
        if request.method == "OPTIONS":
            return ("", 204)
        
        payload = request.get_json(silent=True) or {}
        pid = payload.get("pid")
        
        if not pid:
            return jsonify({"ok": False, "error": "pid required"}), 400
        
        removed = process_registry.unregister(int(pid))
        if removed:
            LOGGER.info("Unregistered process: pid=%d", pid)
        return jsonify({"ok": True, "removed": removed})
    
    @app.route("/processes/list", methods=["GET"])
    def list_processes() -> Any:
        """List all tracked processes."""
        processes = process_registry.list_all()
        return jsonify({
            "ok": True,
            "data": {
                "processes": [p.to_dict() for p in processes],
                "count": len(processes),
            }
        })
    
    @app.route("/processes/ping", methods=["POST", "OPTIONS"])
    def ping_process() -> Any:
        """Update process health ping."""
        if request.method == "OPTIONS":
            return ("", 204)
        
        payload = request.get_json(silent=True) or {}
        pid = payload.get("pid")
        
        if not pid:
            return jsonify({"ok": False, "error": "pid required"}), 400
        
        success = process_registry.ping(int(pid))
        return jsonify({"ok": True, "pinged": success})
    
    @app.route("/actions/shutdown-all", methods=["POST", "OPTIONS"])
    def shutdown_all_processes() -> Any:
        """Shutdown all registered processes (SIGTERM → wait → SIGKILL)."""
        if request.method == "OPTIONS":
            return ("", 204)
        
        payload = request.get_json(silent=True) or {}
        timeout = payload.get("timeout", 5.0)
        
        LOGGER.info("=== IPC SHUTDOWN INITIATED ===")
        stats = process_registry.shutdown_all(timeout=timeout, logger=LOGGER)
        LOGGER.info(f"=== IPC SHUTDOWN COMPLETE: {stats} ===")
        
        return jsonify({"ok": True, "data": stats})

    @app.route("/messages", methods=["POST", "OPTIONS"])
    def dispatch_message() -> Any:
        if request.method == "OPTIONS":
            return ("", 204)
        payload = request.get_json(silent=True) or {}
        LOGGER.info("received message: %s", payload)
        _broadcast({"event": "message", "payload": payload})
        return jsonify({"ok": True, "echo": payload})

    @app.route("/actions/shutdown", methods=["POST", "OPTIONS"])
    def runtime_shutdown() -> Any:
        """Shutdown the framework (now orchestrated by IPC)."""
        if request.method == "OPTIONS":
            return ("", 204)
        
        payload = request.get_json(silent=True) or {}
        timeout = payload.get("timeout", 5.0)
        
        # New behavior: IPC shuts down all registered processes
        LOGGER.info("Shutdown request received - initiating IPC-orchestrated shutdown")
        stats = process_registry.shutdown_all(timeout=timeout, logger=LOGGER)
        
        _broadcast({"event": "shutdown", "status": "complete", "stats": stats})
        return jsonify({"ok": True, "data": stats})

    @app.route("/actions/agent-spawn", methods=["POST", "OPTIONS"])
    def spawn_agent_route() -> Any:
        if request.method == "OPTIONS":
            return ("", 204)
        payload = request.get_json(silent=True) or {}
        agent = payload.get("agent", "codex")
        cwd = payload.get("cwd")
        session_id = payload.get("session_id")
        LOGGER.info("spawn agent request: agent=%s session=%s cwd=%s", agent, session_id, cwd)
        _broadcast({"event": "agent_spawn", "status": "queued", "agent": agent, "session_id": session_id})
        try:
            result = spawn_agent(agent, cwd=cwd, session_id=session_id)
            event = {
                "event": "agent_spawn",
                "status": "running",
                "agent": agent,
                "session_id": session_id,
                "shell": result,
            }
            _broadcast(event)
            return jsonify({"ok": True, "data": result})
        except FrameworkError as exc:
            LOGGER.error("agent spawn failed: %s", exc)
            _broadcast({
                "event": "agent_spawn",
                "status": "error",
                "agent": agent,
                "session_id": session_id,
                "error": str(exc),
            })
            return jsonify({"ok": False, "error": str(exc)}), 502
        except Exception as exc:  # pragma: no cover - defensive
            LOGGER.exception("unexpected agent spawn failure")
            _broadcast({
                "event": "agent_spawn",
                "status": "error",
                "agent": agent,
                "session_id": session_id,
                "error": str(exc),
            })
            return jsonify({"ok": False, "error": str(exc)}), 500

    @app.route("/stream", methods=["GET"])
    def stream() -> Response:
        def event_stream() -> Iterable[str]:
            listener = _register_listener()
            try:
                yield "data: {\"event\": \"connected\"}\n\n"
                while True:
                    try:
                        event = listener.get(timeout=5.0)
                        yield f"data: {json.dumps(event)}\n\n"
                    except queue.Empty:
                        yield ": ping\n\n"
            finally:
                _unregister_listener(listener)

        return Response(event_stream(), mimetype="text/event-stream")

    return app


app = create_app()


def _init_socketio(app: Flask) -> SocketIO:
    preferred_modes = ["gevent", "eventlet", "threading"]
    last_error: Optional[Exception] = None
    for mode in preferred_modes:
        try:
            LOGGER.info("initializing Socket.IO server (async_mode=%s)", mode)
            return SocketIO(app, cors_allowed_origins="*", async_mode=mode)
        except ValueError as exc:
            LOGGER.warning("async_mode '%s' unavailable: %s", mode, exc)
            last_error = exc
        except Exception as exc:  # pragma: no cover - defensive
            LOGGER.error("failed to init Socket.IO with mode %s: %s", mode, exc)
            last_error = exc
    raise RuntimeError(f"Unable to initialize Socket.IO: {last_error}")


socketio = _init_socketio(app)
_load_ipc_modules(app, socketio)


@dataclass
class IPCServerConfig:
    host: str = "127.0.0.1"
    port: int = 9123
    log_level: str = "INFO"


def main() -> None:
    """Entrypoint used when running ``python -m app.ipc.server``."""
    import argparse

    parser = argparse.ArgumentParser(description="TE IPC microservice")
    parser.add_argument("--host", default=IPCServerConfig.host)
    parser.add_argument("--port", default=IPCServerConfig.port, type=int)
    parser.add_argument("--log-level", default=IPCServerConfig.log_level)
    args = parser.parse_args()

    _setup_logging(args.log_level)
    LOGGER.info("starting IPC service on %s:%s", args.host, args.port)
    run_kwargs = {
        "host": args.host,
        "port": args.port,
        "use_reloader": False,
    }
    if getattr(socketio, "async_mode", None) == "threading":
        LOGGER.warning(
            "Socket.IO is running in 'threading' mode; enabling allow_unsafe_werkzeug."
        )
        run_kwargs["allow_unsafe_werkzeug"] = True
    socketio.run(app, **run_kwargs)


if __name__ == "__main__":
    main()
