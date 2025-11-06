"""Standalone IPC microservice.

Provides synchronous REST endpoints and an SSE stream that other services can
use to communicate with the Termux Extensions framework without depending on
its ASGI event loop. The service acts as a lightweight control plane that can
forward control commands (e.g., shutdown, agent spawn) to the framework and
broadcast status updates to connected listeners.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import threading
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Set

import requests
from flask import Flask, Response, jsonify, request

from .control import FrameworkError, spawn_agent

LOGGER = logging.getLogger("te.ipc")
FRAMEWORK_URL = os.environ.get("TE_FRAMEWORK_URL", "http://127.0.0.1:8088")
FRAMEWORK_TOKEN = os.environ.get("TE_FRAMEWORK_SHELL_TOKEN")

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


def create_app() -> Flask:
    app = Flask(__name__)

    @app.after_request
    def _apply_cors(response):  # type: ignore[override]
        return _cors_headers(response)

    @app.route("/health", methods=["GET"])
    def health() -> Dict[str, str]:
        return {"status": "ok"}

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
        if request.method == "OPTIONS":
            return ("", 204)
        headers = {}
        if FRAMEWORK_TOKEN:
            headers["X-Framework-Key"] = FRAMEWORK_TOKEN
        target = f"{FRAMEWORK_URL.rstrip('/')}/api/framework/runtime/shutdown"
        try:
            resp = requests.post(target, headers=headers, timeout=5.0)
            data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            if resp.status_code >= 400 or not data.get("ok", True):
                LOGGER.warning("shutdown request failed: %s", data)
                return jsonify({"ok": False, "error": data.get("error") or resp.text}), resp.status_code
            LOGGER.info("forwarded shutdown request to framework")
            event = {"event": "shutdown", "status": "forwarded"}
            _broadcast(event)
            return jsonify({"ok": True, "data": data.get("data")})
        except requests.RequestException as exc:
            LOGGER.error("shutdown request error: %s", exc)
            return jsonify({"ok": False, "error": str(exc)}), 502

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
    create_app().run(host=args.host, port=args.port, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
