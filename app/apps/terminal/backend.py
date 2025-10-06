from __future__ import annotations

import os
import shlex
import threading
import shutil
from typing import Any

from flask import Blueprint, jsonify, request

# Reuse the core framework shells manager/config
from app.framework_shells import _manager

bp = Blueprint("terminal_app", __name__)


def mgr():
    return _manager()


def _default_shell_command() -> list[str]:
    # Prefer bash with login+interactive; fallback to sh -i
    if os.path.basename((os.environ.get("SHELL") or "")).endswith("bash") or shutil.which("bash"):
        return ["bash", "-l", "-i"]
    return ["sh", "-i"]


@bp.route("/shells", methods=["GET"]) 
def list_shells() -> Any:
    """List framework shells created by this app (label == 'terminal-app')."""
    m = mgr()
    records = [m.describe(r) for r in m.list_shells() if r.label == "terminal-app"]
    return jsonify({"ok": True, "data": records})


@bp.route("/shells", methods=["POST"]) 
def create_shell() -> Any:
    """Spawn a new PTY-backed interactive shell as a framework shell.

    Body (JSON): { shell?: string[], cwd?: string }
    """
    payload = request.get_json(silent=True) or {}
    shell_cmd = payload.get("shell")
    if isinstance(shell_cmd, str):
        shell_cmd = shlex.split(shell_cmd)
    if not shell_cmd:
        shell_cmd = _default_shell_command()
    cwd = str(payload.get("cwd") or "~")

    m = mgr()
    try:
        record = m.spawn_shell_pty(shell_cmd, cwd=cwd, env={}, label="terminal-app", autostart=True)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Failed to spawn shell: {exc}"}), 500

    data = m.describe(record)
    return jsonify({"ok": True, "data": data}), 201


@bp.route("/shells/<shell_id>", methods=["GET"]) 
def get_shell(shell_id: str) -> Any:
    m = mgr()
    rec = m.get_shell(shell_id)
    if not rec:
        return jsonify({"ok": False, "error": "Shell not found"}), 404
    tail = 0
    try:
        if request.args.get("tail"):
            tail = max(0, int(request.args.get("tail") or 0))
    except Exception:
        tail = 0
    include_logs = (request.args.get("logs", "false").lower() in {"1", "true", "yes"})
    data = m.describe(rec, include_logs=include_logs, tail_lines=tail)
    return jsonify({"ok": True, "data": data})


@bp.route("/shells/<shell_id>/input", methods=["POST"]) 
def send_input(shell_id: str) -> Any:
    """Send input (string) to the PTY of a shell.

    Body: { data: string, newline?: boolean }
    """
    m = mgr()
    rec = m.get_shell(shell_id)
    if not rec:
        return jsonify({"ok": False, "error": "Shell not found"}), 404

    payload = request.get_json(silent=True) or {}
    data = payload.get("data")
    add_newline = bool(payload.get("newline", True))
    if data is None:
        return jsonify({"ok": False, "error": "data is required"}), 400

    text = str(data)
    if add_newline:
        text += "\n"
    try:
        m.write_to_pty(shell_id, text)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to write to PTY: {e}"}), 500
    return jsonify({"ok": True, "data": {"id": shell_id}})


@bp.route("/shells/<shell_id>/resize", methods=["POST"]) 
def resize_shell(shell_id: str) -> Any:
    payload = request.get_json(silent=True) or {}
    cols = int(payload.get("cols") or 80)
    rows = int(payload.get("rows") or 24)
    try:
        mgr().resize_pty(shell_id, cols, rows)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Resize failed: {e}"}), 400
    return jsonify({"ok": True, "data": {"id": shell_id, "cols": cols, "rows": rows}})


@bp.route("/shells/<shell_id>/action", methods=["POST"]) 
def shell_action(shell_id: str) -> Any:
    payload = request.get_json(silent=True) or {}
    action = str(payload.get("action") or "").lower()
    m = mgr()
    try:
        if action in {"stop", "terminate"}:
            record = m.terminate_shell(shell_id, force=False)
        elif action in {"kill", "force"}:
            record = m.terminate_shell(shell_id, force=True)
        elif action == "restart":
            record = m.restart_shell(shell_id)
        else:
            return jsonify({"ok": False, "error": f"Unsupported action '{action}'"}), 400
    except KeyError:
        return jsonify({"ok": False, "error": "Shell not found"}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Shell action failed: {exc}"}), 500
    return jsonify({"ok": True, "data": m.describe(record)})


@bp.route("/shells/<shell_id>", methods=["DELETE"]) 
def delete_shell(shell_id: str) -> Any:
    m = mgr()
    try:
        m.remove_shell(shell_id, force=True)
    except KeyError:
        return jsonify({"ok": False, "error": "Shell not found"}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Failed to remove shell: {exc}"}), 500
    return jsonify({"ok": True, "data": {"id": shell_id}})


# WebSocket wiring for streaming PTY output and receiving input
# This registers with the app-level Sock instance exposed via app.config["SOCK"].

def register_ws_routes(app):
    sock = app.config.get("SOCK")
    if not sock:
        return

    @sock.route("/api/app/terminal/ws/<shell_id>")
    def terminal_ws(ws, shell_id: str):  # type: ignore[no-redef]
        m = _manager()
        try:
            q = m.subscribe_output(shell_id)
        except Exception:
            ws.close()
            return
        stop = threading.Event()

        def sender():
            import queue as _q
            while not stop.is_set():
                try:
                    chunk = q.get(timeout=0.5)
                except _q.Empty:
                    continue
                try:
                    ws.send(chunk)
                except Exception:
                    stop.set()
                    break

        t = threading.Thread(target=sender, daemon=True)
        t.start()
        try:
            while not stop.is_set():
                msg = ws.receive()
                if msg is None:
                    break
                try:
                    m.write_to_pty(shell_id, msg)
                except Exception:
                    pass
        finally:
            stop.set()
            try:
                t.join(timeout=1.0)
            except Exception:
                pass
            m.unsubscribe_output(shell_id, q)
