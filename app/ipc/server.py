"""Minimal IPC control service for TE2.

This service exists only to provide:
- a small process registry used by shutdown orchestration
- sleep / wake / exit control around the framework supervisor
- a last-resort shutdown path when the framework is hung
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, List

import signal
import subprocess

from werkzeug.serving import make_server

from flask import Flask, jsonify, request

from .process_manager import ProcessRegistry

LOGGER = logging.getLogger("te.ipc")

_PROCESS_REGISTRY = ProcessRegistry()


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
    
    # Create global process registry
    process_registry = _PROCESS_REGISTRY

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
    
    @app.route("/actions/shutdown", methods=["POST", "OPTIONS"])
    def runtime_shutdown() -> Any:
        """Shutdown the framework (IPC-orchestrated)."""
        if request.method == "OPTIONS":
            return ("", 204)
        
        # All shutdowns go through IPC now
        LOGGER.info("Shutdown request - initiating IPC shutdown")
        stats = process_registry.shutdown_all(logger=LOGGER)
        
        return jsonify({"ok": True, "data": stats})

    return app


app = create_app()


@dataclass
class SleepState:
    enabled: bool = False
    sleep_port: int = 9100
    supervisor_proc: Optional[subprocess.Popen] = None


_SLEEP_STATE = SleepState()


def _framework_args_from_env() -> List[str]:
    raw = os.environ.get("TE_FRAMEWORK_ARGS_JSON")
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list) and all(isinstance(x, str) for x in data):
                return data
        except Exception:
            pass
    return []


def _framework_port_from_args(args: List[str]) -> Optional[int]:
    """Extract --port <n> from args (best-effort)."""
    try:
        for i, item in enumerate(args):
            if item == "--port" and i + 1 < len(args):
                return int(args[i + 1])
    except Exception:
        return None
    return None


def _framework_url() -> Optional[str]:
    """Return framework URL based on current env/args.

    Prefer explicit TE_FRAMEWORK_URL, otherwise derive from framework args (--port).
    """
    explicit = os.environ.get("TE_FRAMEWORK_URL")
    if explicit:
        return explicit
    port = _framework_port_from_args(_framework_args_from_env())
    if port:
        return f"http://127.0.0.1:{port}"
    return None


def _framework_running() -> bool:
    return bool(_SLEEP_STATE.supervisor_proc and _SLEEP_STATE.supervisor_proc.poll() is None)


def _start_supervisor() -> Optional[int]:
    if _framework_running():
        return _SLEEP_STATE.supervisor_proc.pid

    args = _framework_args_from_env()
    env = os.environ.copy()
    env.setdefault("TE_IPC_PERSIST", "1")

    cmd = [env.get("PYTHON_BIN", "python"), "-m", "app.supervisor", *args]
    try:
        proc = subprocess.Popen(cmd, env=env, preexec_fn=os.setsid)
    except Exception as exc:
        LOGGER.error("failed to start supervisor: %s", exc)
        return None

    _SLEEP_STATE.supervisor_proc = proc
    return proc.pid


def _stop_supervisor() -> bool:
    proc = _SLEEP_STATE.supervisor_proc
    if not proc or proc.poll() is not None:
        return True
    try:
        os.kill(proc.pid, signal.SIGTERM)
        return True
    except ProcessLookupError:
        return True
    except Exception as exc:
        LOGGER.error("failed to stop supervisor: %s", exc)
        return False


def _kill_framework_records(sig: signal.Signals) -> bool:
    ok = True
    for record in _PROCESS_REGISTRY.list_by_type("framework"):
        try:
            os.kill(record.pid, sig)
        except ProcessLookupError:
            continue
        except Exception as exc:
            LOGGER.error("failed to signal framework pid=%s with %s: %s", record.pid, sig.name, exc)
            ok = False
    return ok


@app.route("/actions/wake", methods=["POST", "OPTIONS"])
def wake_framework() -> Any:
    if request.method == "OPTIONS":
        return ("", 204)
    pid = _start_supervisor()
    if not pid:
        return jsonify({"ok": False, "error": "failed to start supervisor"}), 500
    return jsonify({"ok": True, "data": {"supervisor_pid": pid}})


@app.route("/actions/sleep", methods=["POST", "OPTIONS"])
def sleep_framework() -> Any:
    if request.method == "OPTIONS":
        return ("", 204)
    ok = _stop_supervisor()
    return jsonify({"ok": ok})


def _schedule_process_exit(delay: float = 0.25) -> None:
    """Exit IPC after responding to the request."""
    def _do_exit() -> None:
        time.sleep(delay)
        os._exit(0)

    threading.Thread(target=_do_exit, name="ipc-exit", daemon=True).start()


@app.route("/actions/exit", methods=["POST", "OPTIONS"])
def exit_ipc() -> Any:
    """Ask IPC to stop the framework tree and then terminate itself.

    This is intended to be the definitive "exit" action when running under
    `scripts/run_framework.sh`: kill framework shells + registered processes
    in a deterministic order, then exit IPC.
    """
    if request.method == "OPTIONS":
        return ("", 204)

    # IMPORTANT: Do not exit IPC until shutdown work is done. Otherwise, the
    # supervisor may lose its "last resort" killer, and orphaned shells can
    # survive because they are started with start_new_session=True.
    ok = True
    try:
        stats = _PROCESS_REGISTRY.shutdown_all(logger=LOGGER)
    except Exception as exc:
        ok = False
        LOGGER.exception("exit shutdown failed: %s", exc)

    # Allow the supervisor (if running) to observe the framework exit before
    # IPC terminates. This avoids noisy "IPC connection refused" fallback logs.
    try:
        proc = _SLEEP_STATE.supervisor_proc
        if proc and proc.poll() is None:
            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline and proc.poll() is None:
                time.sleep(0.1)
    except Exception:
        pass

    _schedule_process_exit()
    return jsonify({"ok": ok})


@dataclass
class IPCServerConfig:
    host: str = "127.0.0.1"
    port: int = 9099
    log_level: str = "INFO"


def main() -> None:
    """Entrypoint used when running ``python -m app.ipc.server``."""
    import argparse

    parser = argparse.ArgumentParser(description="TE IPC microservice")
    parser.add_argument("--host", default=IPCServerConfig.host)
    parser.add_argument("--port", default=IPCServerConfig.port, type=int)
    parser.add_argument("--log-level", default=IPCServerConfig.log_level)
    parser.add_argument("--sleep", action="store_true", help="Enable sleep listener (does not auto-start framework)")
    parser.add_argument("--sleep-port", type=int, default=9100, help="Sleep listener port (default: 9100)")
    args = parser.parse_args()

    _setup_logging(args.log_level)

    if args.sleep:
        _SLEEP_STATE.enabled = True
        _SLEEP_STATE.sleep_port = int(args.sleep_port)

        sleep_app = Flask("te.ipc.sleep")

        @sleep_app.after_request
        def _apply_sleep_cors(response):  # type: ignore[override]
            return _cors_headers(response)

        @sleep_app.route("/health", methods=["GET"])
        def sleep_health() -> Any:
            return jsonify({"ok": True, "sleep": True, "framework_running": _framework_running()})

        @sleep_app.route("/actions/wake", methods=["POST", "OPTIONS"])
        def sleep_wake() -> Any:
            if request.method == "OPTIONS":
                return ("", 204)
            pid = _start_supervisor()
            if not pid:
                return jsonify({"ok": False, "error": "failed to start supervisor"}), 500
            return jsonify({"ok": True, "data": {"supervisor_pid": pid}})

        @sleep_app.route("/actions/sleep", methods=["POST", "OPTIONS"])
        def sleep_sleep() -> Any:
            if request.method == "OPTIONS":
                return ("", 204)
            ok = _stop_supervisor()
            return jsonify({"ok": ok})

        @sleep_app.route("/actions/exit", methods=["POST", "OPTIONS"])
        def sleep_exit() -> Any:
            if request.method == "OPTIONS":
                return ("", 204)
            ok = True
            if not _stop_supervisor():
                ok = False
            try:
                proc = _SLEEP_STATE.supervisor_proc
                if proc and proc.poll() is None:
                    deadline = time.monotonic() + 45.0
                    while time.monotonic() < deadline and proc.poll() is None:
                        time.sleep(0.1)
            except Exception:
                ok = False

            proc = _SLEEP_STATE.supervisor_proc
            if proc and proc.poll() is None:
                LOGGER.warning("sleep_exit: supervisor still running after grace period; forcing framework fallback termination")
                if not _kill_framework_records(signal.SIGTERM):
                    ok = False
                time.sleep(1.0)
                if not _kill_framework_records(signal.SIGKILL):
                    ok = False
                try:
                    os.kill(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except Exception as exc:
                    LOGGER.error("sleep_exit: failed to SIGKILL supervisor pid=%s: %s", proc.pid, exc)
                    ok = False
            _schedule_process_exit()
            return jsonify({"ok": ok})

        def _run_sleep_listener() -> None:
            server = make_server(args.host, int(args.sleep_port), sleep_app)
            server.serve_forever()

        t = threading.Thread(target=_run_sleep_listener, name="ipc-sleep", daemon=True)
        t.start()
        LOGGER.info("sleep listener enabled on %s:%s", args.host, args.sleep_port)

    LOGGER.info("starting IPC service on %s:%s", args.host, args.port)
    app.run(host=args.host, port=args.port, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
