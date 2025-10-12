from __future__ import annotations

import socket
from pathlib import Path
from typing import Optional

from flask import Blueprint, current_app, jsonify, request, render_template_string

from app.libs.framework_shells import _manager


code_oss_bp = Blueprint(
    "code_oss_backend",
    __name__,
    static_folder=str(Path(__file__).resolve().with_name('static')),
    static_url_path='/api/app/code_oss/assets',
)


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 13337

TEMPLATE_FULLPAGE = Path(__file__).with_name("templates") / "fullpage.html"

_SHELL_STATE: dict[str, Optional[str]] = {
    "shell_id": None,
    "port": None,
}


def _seed_state() -> dict:
    params = request.args

    def _coerce_int(value: Optional[str]) -> Optional[int]:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    return {
        "project_id": params.get("project"),
        "file_path": params.get("file"),
        "view": params.get("view"),
        "line": _coerce_int(params.get("line")),
        "column": _coerce_int(params.get("col") or params.get("column")),
        "branch": params.get("branch"),
    }


def _wrapper_script() -> Path:
    # backend.py lives at <repo>/app/apps/code_oss/backend.py>
    repo_root = Path(__file__).resolve().parents[3]
    script = repo_root / "app" / "apps" / "code_oss" / "bin" / "code-server-wrapper.sh"
    if not script.exists():
        raise FileNotFoundError(f"Wrapper script not found at {script}")
    return script


def _runtime_dirs() -> dict[str, Path]:
    base = Path.home() / ".cache" / "termux_extensions" / "code_oss"
    data = base / "user-data"
    extensions = base / "extensions"
    logs = base / "logs"
    for path in (data, extensions, logs):
        path.mkdir(parents=True, exist_ok=True)
    return {
        "base": base,
        "user_data": data,
        "extensions": extensions,
        "logs": logs,
    }


def _is_shell_running() -> bool:
    shell_id = _SHELL_STATE.get("shell_id")
    if not shell_id:
        return False
    manager = _manager()
    shell = manager.get_shell(shell_id)
    if not shell or shell.status != "running":
        _SHELL_STATE["shell_id"] = None
        _SHELL_STATE["port"] = None
        return False
    return True


def _pick_port() -> int:
    if _SHELL_STATE.get("port"):
        return int(_SHELL_STATE["port"])  # type: ignore[arg-type]
    # Pick a free port once; reuse afterwards.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((DEFAULT_HOST, 0))
        port = s.getsockname()[1]
    _SHELL_STATE["port"] = port
    return port


def _spawn_shell() -> None:
    manager = _manager()
    binary = _wrapper_script()
    runtime = _runtime_dirs()
    port = _pick_port()

    command = [
        str(binary),
        "--bind-addr",
        f"{DEFAULT_HOST}:{port}",
        "--auth",
        "none",
        "--disable-telemetry",
        "--disable-update-check",
        "--user-data-dir",
        str(runtime["user_data"]),
        "--extensions-dir",
        str(runtime["extensions"]),
    ]

    env = {
        "CODE_SERVER_PARENT": "termux_extensions",
        "HOME": str(Path.home()),
    }

    shell = manager.spawn_shell(
        command,
        label="code-oss",
        cwd=str(runtime["base"]),
        env=env,
    )
    _SHELL_STATE["shell_id"] = shell.id


def _ensure_running() -> None:
    if _is_shell_running():
        return
    _spawn_shell()


def _stop_shell() -> bool:
    shell_id = _SHELL_STATE.get("shell_id")
    if not shell_id:
        return False
    manager = _manager()
    try:
        manager.remove_shell(shell_id, force=True)
    except Exception:
        return False
    else:
        _SHELL_STATE["shell_id"] = None
        _SHELL_STATE["port"] = None
        return True


@code_oss_bp.get("/status")
def status():
    running = _is_shell_running()
    port = _SHELL_STATE.get("port") if running else None
    return jsonify(
        {
            "ok": True,
            "data": {
                "running": running,
                "host": DEFAULT_HOST if running else None,
                "port": port,
            },
        }
    )


@code_oss_bp.get("/fullpage")
def fullpage():
    try:
        _ensure_running()
    except Exception as exc:  # pragma: no cover
        current_app.logger.exception("Failed to ensure code-server running")
        template_source = TEMPLATE_FULLPAGE.read_text(encoding="utf-8")
        return render_template_string(template_source, seed_state=_seed_state())

    template_source = TEMPLATE_FULLPAGE.read_text(encoding="utf-8")
    return render_template_string(template_source, seed_state=_seed_state())


@code_oss_bp.post("/start")
def start():
    try:
        _ensure_running()
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:  # pragma: no cover - defensive
        current_app.logger.exception("Failed to start code-server")
        return jsonify({"ok": False, "error": str(exc)}), 500

    port = int(_SHELL_STATE.get("port"))
    return jsonify(
        {
            "ok": True,
            "data": {
                "host": DEFAULT_HOST,
                "port": port,
                "url": f"http://{DEFAULT_HOST}:{port}",
            },
        }
    )


@code_oss_bp.post("/stop")
def stop():
    stopped = _stop_shell()
    return jsonify({"ok": True, "data": {"stopped": stopped}})
