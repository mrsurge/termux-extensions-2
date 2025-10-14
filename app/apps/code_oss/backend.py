from __future__ import annotations

import json
import socket
import subprocess
from pathlib import Path
import os
from typing import Optional

from flask import Blueprint, current_app, jsonify, request, render_template_string

from app.libs.framework_shells import _manager


code_oss_bp = Blueprint(
    "code_oss_backend",
    __name__,
)


DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 13337

TEMPLATE_FULLPAGE = Path(__file__).with_name("templates") / "fullpage.html"
BRIDGE_SRC = Path(__file__).with_name("bridge_extension")
BRIDGE_PACKAGE = BRIDGE_SRC / "package.json"

_SHELL_STATE: dict[str, Optional[str]] = {
    "shell_id": None,
    "port": None,
    "project_path": None,
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
    logs = base / "logs"
    # Add user-data and extensions directories for persistence
    user_data = base / "user-data"
    extensions = base / "extensions"
    config = base / "config"
    
    base.mkdir(parents=True, exist_ok=True)
    for path in (logs, user_data, extensions, config):
        path.mkdir(parents=True, exist_ok=True)
    
    return {
        "base": base,
        "logs": logs,
        "user_data": user_data,
        "extensions": extensions,
        "config": config,
    }


def _bridge_manifest() -> dict:
    if not BRIDGE_PACKAGE.exists():
        return {}
    try:
        return json.loads(BRIDGE_PACKAGE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _bridge_vsix_path(manifest: dict) -> Path:
    name = manifest.get("name") or "mobile-bridge"
    version = manifest.get("version") or "0.0.0"
    return BRIDGE_SRC / f"{name}-{version}.vsix"


def _bridge_extension_id(manifest: dict) -> str:
    publisher = manifest.get("publisher") or "termux"
    name = manifest.get("name") or "mobile-bridge"
    return f"{publisher}.{name}"


def _cli_env() -> dict:
    env = os.environ.copy()
    env.update(
        {
            "HOME": str(Path.home()),
            "CODE_SERVER_PARENT": "termux_extensions",
        }
    )
    return env


def _installed_extensions() -> set[str]:
    try:
        runtime = _runtime_dirs()
        result = subprocess.run(
            [
                str(_wrapper_script()),
                "--extensions-dir", str(runtime["extensions"]),
                "--list-extensions"
            ],
            check=True,
            capture_output=True,
            text=True,
            env=_cli_env(),
        )
    except Exception:  # pragma: no cover - defensive
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def _is_bridge_installed(manifest: Optional[dict] = None) -> bool:
    manifest = manifest or _bridge_manifest()
    if not manifest:
        return False
    extension_id = _bridge_extension_id(manifest)
    installed = _installed_extensions()
    return extension_id in installed


def _ensure_bridge_extension(force: bool = False) -> None:
    manifest = _bridge_manifest()
    if not manifest:
        return
    vsix_path = _bridge_vsix_path(manifest)
    if not vsix_path.exists():
        current_app.logger.warning("Bridge VSIX not found at %s", vsix_path)
        return
    if not force and _is_bridge_installed(manifest):
        return
    
    runtime = _runtime_dirs()
    command = [
        str(_wrapper_script()), 
        "--extensions-dir", str(runtime["extensions"]),
        "--install-extension", str(vsix_path)
    ]
    if force:
        command.insert(3, "--force")
    try:
        subprocess.run(command, check=True, env=_cli_env())
    except Exception:  # pragma: no cover - defensive
        current_app.logger.exception("Failed to install mobile bridge extension via CLI")


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
    project = _SHELL_STATE.get("project_path")

    try:
        _ensure_bridge_extension()
    except Exception:  # pragma: no cover - defensive
        current_app.logger.exception("Failed to ensure mobile bridge extension")

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
        # Disable workspace trust prompts
        "--disable-workspace-trust",
    ]
    if project:
        command.append(project)

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
    manifest = _bridge_manifest()
    return jsonify(
        {
            "ok": True,
            "data": {
                "running": running,
                "host": DEFAULT_HOST if running else None,
                "port": port,
                "project_path": _SHELL_STATE.get("project_path"),
                "bridge_installed": _is_bridge_installed(manifest),
                "bridge_version": manifest.get("version") if manifest else None,
            },
        }
    )


@code_oss_bp.get("/fullpage")
def fullpage():
    seed_state = _seed_state()
    if not seed_state.get("project_id") and _SHELL_STATE.get("project_path"):
        seed_state["project_id"] = _SHELL_STATE["project_path"]

    try:
        _ensure_running()
    except Exception as exc:  # pragma: no cover
        current_app.logger.exception("Failed to ensure code-server running")
        template_source = TEMPLATE_FULLPAGE.read_text(encoding="utf-8")
        return render_template_string(template_source, seed_state=seed_state)

    template_source = TEMPLATE_FULLPAGE.read_text(encoding="utf-8")
    return render_template_string(template_source, seed_state=seed_state)


@code_oss_bp.post("/start")
def start():
    try:
        _ensure_running()
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:  # pragma: no cover - defensive
        current_app.logger.exception("Failed to start code-server")
        return jsonify({"ok": False, "error": str(exc)}), 500

    port = _SHELL_STATE.get("port")
    url = f"http://{DEFAULT_HOST}:{port}" if port else None
    manifest = _bridge_manifest()
    return jsonify(
        {
            "ok": True,
            "data": {
                "host": DEFAULT_HOST,
                "port": port,
                "url": url,
                "project_path": _SHELL_STATE.get("project_path"),
                "bridge_installed": _is_bridge_installed(manifest),
                "bridge_version": manifest.get("version") if manifest else None,
            },
        }
    )


@code_oss_bp.post("/stop")
def stop():
    stopped = _stop_shell()
    return jsonify({"ok": True, "data": {"stopped": stopped}})


@code_oss_bp.get("/file")
def read_file():
    """Read a file's content for the document viewer."""
    file_path = request.args.get("path")
    if not file_path:
        return jsonify({"ok": False, "error": "Missing path parameter"}), 400
    
    try:
        # Resolve path
        resolved_path = Path(file_path).expanduser().resolve()
        
        # Basic security check - ensure file is under home directory
        if not str(resolved_path).startswith(str(Path.home())):
            return jsonify({"ok": False, "error": "Access denied"}), 403
        
        if not resolved_path.exists():
            return jsonify({"ok": False, "error": "File not found"}), 404
        
        if not resolved_path.is_file():
            return jsonify({"ok": False, "error": "Not a file"}), 400
        
        # Read file content
        try:
            content = resolved_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            # Try as binary if text fails
            content = f"[Binary file - {resolved_path.stat().st_size} bytes]"
        
        return jsonify({
            "ok": True,
            "data": {
                "path": str(resolved_path),
                "content": content,
                "size": resolved_path.stat().st_size
            }
        })
        
    except Exception as e:
        current_app.logger.exception("Failed to read file")
        return jsonify({"ok": False, "error": str(e)}), 500


@code_oss_bp.post("/project")
def set_project():
    payload = request.get_json(silent=True) or {}
    raw_path = payload.get("path")
    if not raw_path:
        return jsonify({"ok": False, "error": "Missing project path"}), 400

    folder = Path(raw_path).expanduser()
    if not folder.exists():
        return jsonify({"ok": False, "error": f"Path does not exist: {folder}"}), 404
    if not folder.is_dir():
        return jsonify({"ok": False, "error": f"Not a directory: {folder}"}), 400

    _stop_shell()
    _SHELL_STATE["project_path"] = str(folder)

    try:
        _ensure_running()
    except Exception as exc:  # pragma: no cover - defensive
        current_app.logger.exception("Failed to launch code-server for project")
        return jsonify({"ok": False, "error": str(exc)}), 500

    port = _SHELL_STATE.get("port")
    manifest = _bridge_manifest()
    return jsonify(
        {
            "ok": True,
            "data": {
                "host": DEFAULT_HOST,
                "port": port,
                "project_path": _SHELL_STATE.get("project_path"),
                "url": f"http://{DEFAULT_HOST}:{port}" if port else None,
                "bridge_installed": _is_bridge_installed(manifest),
                "bridge_version": manifest.get("version") if manifest else None,
            },
        }
    )


@code_oss_bp.post("/bridge/install")
def install_bridge():
    try:
        _ensure_bridge_extension(force=True)
    except Exception as exc:  # pragma: no cover - defensive
        current_app.logger.exception("Failed to install mobile bridge extension")
        return jsonify({"ok": False, "error": str(exc)}), 500

    manifest = _bridge_manifest()
    return jsonify(
        {
            "ok": True,
            "data": {
                "bridge_installed": _is_bridge_installed(manifest),
                "bridge_version": manifest.get("version") if manifest else None,
            },
        }
    )
