from __future__ import annotations

import copy
import json
import socket
import subprocess
import time
from collections import deque, defaultdict
from pathlib import Path
import os
from typing import Any, Dict, Optional
from urllib.parse import quote as urlquote

from flask import Blueprint, current_app, jsonify, request, render_template_string

from app.libs.framework_shells import _manager

from .history_store import HistoryStore
from .preferences_store import PreferencesStore


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

_BRIDGE_EVENT_LIMIT = 512
_BRIDGE_EVENTS: deque[dict[str, Any]] = deque(maxlen=_BRIDGE_EVENT_LIMIT)
_BRIDGE_SEQ = 0
_BRIDGE_COMMANDS: deque[dict[str, Any]] = deque()
_BRIDGE_DOC_CACHE: Dict[str, Dict[str, Any]] = {}

history_store = HistoryStore()
preferences_store = PreferencesStore()


_GIT_SETTINGS: dict[str, Any] = {
    "enabled": True,
    "ttl": 4.0,
}

_GIT_STATUS_CACHE: Dict[str, Dict[str, Any]] = {}


def _empty_bridge_summary() -> Dict[str, Any]:
    return {
        "active_editor": None,
        "workspace_folders": [],
        "explorer_tree": {},
        "chat_providers": [],
        "state": {},
        "bridge": {},
        "errors": [],
    }


_BRIDGE_STATE_CACHE: Dict[str, Any] = {
    "timestamp": 0.0,
    "last_seq": 0,
    "summary": _empty_bridge_summary(),
}


def _reset_bridge_state() -> None:
    global _BRIDGE_SEQ
    _BRIDGE_EVENTS.clear()
    _BRIDGE_COMMANDS.clear()
    _BRIDGE_DOC_CACHE.clear()
    _clear_git_cache()
    _BRIDGE_SEQ = 0
    _BRIDGE_STATE_CACHE["timestamp"] = 0.0
    _BRIDGE_STATE_CACHE["last_seq"] = 0
    _BRIDGE_STATE_CACHE["summary"] = _empty_bridge_summary()


def _normalize_project_path(path: str) -> str:
    try:
        return str(Path(path).expanduser().resolve(strict=False))
    except Exception:
        return str(path)


def _normalize_file_path(path: str) -> str:
    try:
        return str(Path(path).expanduser().resolve(strict=False))
    except Exception:
        return str(path)


def _is_executable_file(path: Optional[str]) -> bool:
    if not path:
        return False
    try:
        resolved = Path(path)
        return resolved.is_file() and os.access(resolved, os.X_OK)
    except Exception:
        return False


def _git_enabled() -> bool:
    return bool(_GIT_SETTINGS.get("enabled", True))


def _git_cache_ttl() -> float:
    try:
        ttl = float(_GIT_SETTINGS.get("ttl", 4.0) or 0)
    except (TypeError, ValueError):
        ttl = 4.0
    return max(1.0, ttl)


def _clear_git_cache(project_path: Optional[str] = None) -> None:
    if project_path:
        normalized = _normalize_project_path(project_path)
        _GIT_STATUS_CACHE.pop(normalized, None)
        return
    _GIT_STATUS_CACHE.clear()


def _probe_git_repository(project_path: str) -> tuple[bool, bool, Optional[str]]:
    """Return (git_available, is_repo, error_code)."""

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=project_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=4,
            check=True,
        )
    except FileNotFoundError:
        return False, False, "git-not-found"
    except subprocess.TimeoutExpired:
        return True, False, "timeout"
    except subprocess.CalledProcessError:
        return True, False, "not-a-repo"

    return True, result.stdout.strip().lower() == "true", None


def _classify_git_status(code: str) -> Dict[str, Any]:
    code = (code or "  ")[:2]
    staged_flag = code[0] not in {" ", "?", "!"}
    unstaged_flag = code[1] not in {" ", "?", "!"}

    label = "modified"
    if code == "??":
        label = "untracked"
    elif code == "!!":
        label = "ignored"
    elif "U" in code:
        label = "conflict"
    elif "D" in code:
        label = "deleted"
    elif "R" in code or "C" in code:
        label = "renamed"
    elif staged_flag and not unstaged_flag:
        label = "staged"

    return {
        "code": code,
        "label": label,
        "staged": staged_flag,
        "unstaged": unstaged_flag,
        "untracked": label == "untracked",
        "ignored": label == "ignored",
        "conflict": label == "conflict",
        "deleted": label == "deleted",
        "renamed": label == "renamed",
    }


def _gather_git_status(project_path: str) -> Dict[str, Any]:
    normalized = _normalize_project_path(project_path)
    available, is_repo, probe_error = _probe_git_repository(normalized)
    generated_at = time.time()

    summary = {
        "total": 0,
        "staged": 0,
        "unstaged": 0,
        "untracked": 0,
        "conflicts": 0,
        "deleted": 0,
    }

    payload: Dict[str, Any] = {
        "enabled": _git_enabled(),
        "git_available": available,
        "repository": bool(available and is_repo),
        "project": normalized,
        "generated_at": generated_at,
        "entries": {},
        "directories": {},
        "summary": summary,
    }

    if not available:
        payload["error"] = probe_error or "git-not-found"
        return payload

    if not is_repo:
        if probe_error:
            payload["error"] = probe_error
        return payload

    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=normalized,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
            check=False,
        )
    except subprocess.TimeoutExpired:
        payload["error"] = "timeout"
        return payload
    except FileNotFoundError:
        payload["git_available"] = False
        payload["repository"] = False
        payload["error"] = "git-not-found"
        return payload

    lines = result.stdout.splitlines()
    entries: Dict[str, Dict[str, Any]] = {}
    directory_totals: Dict[str, Dict[str, Any]] = {}
    repo_path = Path(normalized)

    for line in lines:
        if not line:
            continue
        if len(line) < 3:
            continue
        code = line[:2]
        rel = line[3:]
        if not rel:
            continue
        if " -> " in rel:
            rel = rel.split(" -> ", 1)[1]
        abs_path = _normalize_file_path(str(repo_path / rel))
        meta = _classify_git_status(code)
        exists = os.path.exists(abs_path)
        meta.update(
            {
                "path": abs_path,
                "relative": rel,
                "exists": exists,
                "executable": _is_executable_file(abs_path) if exists else False,
            }
        )
        entries[abs_path] = meta

        summary["total"] += 1
        if meta["staged"]:
            summary["staged"] += 1
        if meta["unstaged"]:
            summary["unstaged"] += 1
        if meta["label"] == "untracked":
            summary["untracked"] += 1
        if meta["label"] == "conflict":
            summary["conflicts"] += 1
        if meta["label"] == "deleted":
            summary["deleted"] += 1

        project_root = Path(normalized)
        parent = Path(abs_path).parent
        while parent and str(parent).startswith(normalized):
            try:
                parent.relative_to(project_root)
            except ValueError:
                break
            parent_str = str(parent)
            bucket = directory_totals.setdefault(
                parent_str,
                {
                    "total": 0,
                    "statuses": defaultdict(int),
                },
            )
            bucket["total"] += 1
            bucket["statuses"][meta["label"]] += 1
            if parent == project_root:
                break
            parent = parent.parent

    payload["entries"] = entries
    payload["directories"] = {
        directory: {
            "total": data["total"],
            "statuses": dict(data["statuses"]),
        }
        for directory, data in directory_totals.items()
    }

    return payload


def _load_git_metadata(project_path: Optional[str]) -> Optional[Dict[str, Any]]:
    if not project_path or not _git_enabled():
        if not _git_enabled():
            return {"enabled": False}
        return None

    normalized = _normalize_project_path(project_path)
    now = time.time()
    cache_entry = _GIT_STATUS_CACHE.get(normalized)
    ttl = _git_cache_ttl()
    if cache_entry and now - cache_entry.get("timestamp", 0) < ttl:
        return cache_entry.get("data")

    data = _gather_git_status(normalized)
    _GIT_STATUS_CACHE[normalized] = {"timestamp": now, "data": data}
    return data


def _annotate_entry_exec(entries: Optional[list]) -> None:
    if not entries:
        return
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        path = entry.get("path")
        entry["executable"] = _is_executable_file(path)
        children = entry.get("children")
        if isinstance(children, list) and children:
            _annotate_entry_exec(children)


def _augment_explorer_event(event: Dict[str, Any]) -> Dict[str, Any]:
    project = _SHELL_STATE.get("project_path")
    if not project:
        entries = event.get("entries")
        if isinstance(entries, list):
            for entry in entries:
                if isinstance(entry, dict) and entry.get("path"):
                    path_candidate = entry["path"]
                    if entry.get("entryType") == "directory":
                        project = path_candidate
                    else:
                        project = str(Path(path_candidate).parent)
                    break
    metadata = _load_git_metadata(project)
    if metadata is None:
        return event

    augmented = copy.deepcopy(event)
    if "entries" in augmented:
        _annotate_entry_exec(augmented.get("entries"))
    augmented["git"] = metadata
    return augmented


def _augment_bridge_event(event: Dict[str, Any]) -> Dict[str, Any]:
    if event.get("type") == "explorerTree":
        return _augment_explorer_event(event)
    return event


def _update_current_project(path: Optional[str]) -> None:
    if not path:
        return
    normalized = _normalize_project_path(path)
    _SHELL_STATE["project_path"] = normalized
    history_store.touch_project(normalized)
    _clear_git_cache(normalized)


def _update_bridge_summary(event: Dict[str, Any]) -> None:
    summary = _BRIDGE_STATE_CACHE.setdefault("summary", _empty_bridge_summary())
    event_type = event.get("type")

    if event_type == "activeEditor":
        summary["active_editor"] = event.get("path")
    elif event_type == "workspaceFolders":
        folders = event.get("folders") or []
        summary["workspace_folders"] = folders
        for folder in folders:
            path = None
            if isinstance(folder, str):
                path = folder
            elif isinstance(folder, dict):
                path = folder.get("path") or folder.get("uri") or folder.get("url")
            if isinstance(path, str):
                if path.startswith("file://"):
                    path = path.replace("file://", "", 1)
                _update_current_project(path)
                break
    elif event_type == "explorerTree":
        # Store the most recent tree payload; consumers can diff if needed.
        summary["explorer_tree"] = {
            key: value
            for key, value in event.items()
            if key not in {"seq", "timestamp"}
        }
        if not event.get("parent"):
            entries = event.get("entries") or []
            for entry in entries:
                path = entry.get("path") if isinstance(entry, dict) else None
                if isinstance(path, str):
                    _update_current_project(path)
                    break
    elif event_type == "chatProviders":
        summary["chat_providers"] = event.get("providers") or []
    elif event_type == "state":
        summary["state"] = {
            "sidebarVisible": bool(event.get("sidebarVisible")),
            "panelVisible": bool(event.get("panelVisible")),
        }
    elif event_type == "doc_state":
        documents = summary.setdefault("documents", {})
        doc_id = event.get("doc_id")
        if doc_id:
            documents[doc_id] = {
                key: event.get(key)
                for key in ("doc_id", "rev", "languageId", "dirty", "timestamp")
            }
    elif event_type == "doc_changes":
        documents = summary.setdefault("documents", {})
        doc_id = event.get("doc_id")
        if doc_id:
            entry = documents.setdefault(doc_id, {"doc_id": doc_id})
            entry["rev"] = event.get("next_rev", entry.get("rev"))
    elif event_type in {"bridgeState", "bridgeActivated"}:
        bridge_state = summary.setdefault("bridge", {})
        bridge_state.update(
            {
                key: value
                for key, value in event.items()
                if key not in {"type", "seq", "timestamp"}
            }
        )
        bridge_state.setdefault("last_event", event_type)
        bridge_state["updated_at"] = event.get("timestamp", time.time())
    elif event_type == "error":
        errors = summary.setdefault("errors", [])
        errors.append(
            {
                "message": event.get("error"),
                "timestamp": event.get("timestamp", time.time()),
            }
        )
        # Keep error history bounded
        if len(errors) > 20:
            del errors[:-20]


def _next_bridge_seq(payload: Dict[str, Any]) -> Dict[str, Any]:
    global _BRIDGE_SEQ
    _BRIDGE_SEQ += 1
    payload["seq"] = _BRIDGE_SEQ
    payload.setdefault("timestamp", time.time())
    return payload


def _record_bridge_event(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    event = dict(payload)
    event.pop("_mobileBridge", None)
    event.setdefault("type", "event")

    event = _augment_bridge_event(event)

    event = _next_bridge_seq(event)

    _BRIDGE_EVENTS.append(event)
    _update_bridge_summary(event)

    _BRIDGE_STATE_CACHE["timestamp"] = event["timestamp"]
    _BRIDGE_STATE_CACHE["last_seq"] = event["seq"]

    event_type = event.get("type")
    if event_type == "doc_state":
        doc_id = event.get("doc_id")
        if doc_id:
            _BRIDGE_DOC_CACHE[doc_id] = {
                "doc_id": doc_id,
                "rev": event.get("rev"),
                "text": event.get("text"),
                "eol": event.get("eol") or "\n",
                "dirty": event.get("dirty"),
                "languageId": event.get("languageId"),
                "timestamp": event.get("timestamp"),
            }
    elif event_type == "doc_changes":
        doc_id = event.get("doc_id")
        if doc_id and doc_id in _BRIDGE_DOC_CACHE:
            entry = _BRIDGE_DOC_CACHE[doc_id]
            entry["rev"] = event.get("next_rev", entry.get("rev"))
            entry["timestamp"] = event.get("timestamp", entry.get("timestamp"))
    elif event_type == "ack":
        op_id = event.get("op_id")
        if op_id:
            _acknowledge_command(op_id, applied_rev=event.get("applied_rev"))

    return event


def _bridge_summary_snapshot() -> Dict[str, Any]:
    return copy.deepcopy(_BRIDGE_STATE_CACHE.get("summary", _empty_bridge_summary()))


def _bridge_state_payload(events: list[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "sequence": _BRIDGE_STATE_CACHE.get("last_seq", 0),
        "timestamp": _BRIDGE_STATE_CACHE.get("timestamp", 0.0),
        "events": events,
        "summary": _bridge_summary_snapshot(),
        "pending_commands": list(_BRIDGE_COMMANDS),
    }


def _enqueue_bridge_command(command: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(command, dict):
        raise ValueError("Command payload must be a dict")
    command = _next_bridge_seq(dict(command))
    _BRIDGE_COMMANDS.append(command)
    _BRIDGE_STATE_CACHE["timestamp"] = command["timestamp"]
    _BRIDGE_STATE_CACHE["last_seq"] = command["seq"]
    return command


def _acknowledge_command(op_id: str, *, applied_rev: Optional[int] = None) -> None:
    if not op_id:
        return
    kept: deque[dict[str, Any]] = deque()
    acknowledged = False
    while _BRIDGE_COMMANDS:
        cmd = _BRIDGE_COMMANDS.popleft()
        if cmd.get("op_id") == op_id:
            acknowledged = True
            continue
        kept.append(cmd)
    _BRIDGE_COMMANDS.extend(kept)
    if acknowledged:
        _BRIDGE_STATE_CACHE.setdefault("summary", {}).update(
            {
                "last_ack": {
                    "op_id": op_id,
                    "applied_rev": applied_rev,
                    "timestamp": time.time(),
                }
            }
        )


def _corsify_response(response):
    origin = request.headers.get("Origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
    else:
        response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Cache-Control"] = "no-store"
    return response


def _cors_preflight():
    response = current_app.make_response(("", 204))
    return _corsify_response(response)


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


def _build_server_url(host: Optional[str], port: Optional[int], project_path: Optional[str]) -> Optional[str]:
    if not host or not port:
        return None
    base = f"http://{host}:{port}"
    if project_path:
        encoded = urlquote(project_path, safe="/~")
        return f"{base}/?folder={encoded}"
    return base


def _spawn_shell() -> None:
    manager = _manager()
    binary = _wrapper_script()
    runtime = _runtime_dirs()
    port = _pick_port()
    project = _SHELL_STATE.get("project_path")

    _reset_bridge_state()

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
        _reset_bridge_state()
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
                "git_enabled": _git_enabled(),
            },
        }
    )


@code_oss_bp.route("/state", methods=["GET", "POST", "OPTIONS"])
def bridge_state():
    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method == "POST":
        payload = request.get_json(silent=True)
        if payload is None:
            response = jsonify({"ok": False, "error": "Expected JSON body"})
            response.status_code = 400
            return _corsify_response(response)

        events = payload.get("events")
        if events is None:
            if "type" in payload:
                events = [payload]
            else:
                events = []
        elif isinstance(events, dict):
            events = [events]
        elif isinstance(events, list):
            events = [event for event in events if isinstance(event, dict)]
        else:
            events = []

        accepted = 0
        for event in events:
            if _record_bridge_event(event):
                accepted += 1

        response = jsonify(
            {
                "ok": True,
                "data": {
                    "accepted": accepted,
                    "sequence": _BRIDGE_STATE_CACHE.get("last_seq", 0),
                },
            }
        )
        return _corsify_response(response)

    since_param = request.args.get("since")
    limit_param = request.args.get("limit")
    types_param = request.args.get("types")
    requested_types = {
        entry.strip() for entry in (types_param or "").split(",") if entry.strip()
    } or None

    since_seq: Optional[int] = None
    if since_param is not None:
        try:
            since_seq = int(since_param)
        except ValueError:
            since_seq = None

    limit: Optional[int] = None
    if limit_param is not None:
        try:
            limit = max(0, int(limit_param))
        except ValueError:
            limit = None

    events = [
        event
        for event in list(_BRIDGE_EVENTS)
        if since_seq is None or event.get("seq", 0) > since_seq
    ]

    commands = [
        command
        for command in list(_BRIDGE_COMMANDS)
        if since_seq is None or command.get("seq", 0) > since_seq
    ]

    combined = events + commands

    if requested_types:
        combined = [item for item in combined if item.get("type") in requested_types]

    combined.sort(key=lambda item: item.get("seq", 0))

    if limit is not None and limit > 0 and len(combined) > limit:
        combined = combined[-limit:]

    response = jsonify({"ok": True, "data": _bridge_state_payload(combined)})
    return _corsify_response(response)


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
    project_path = _SHELL_STATE.get("project_path")
    url = _build_server_url(DEFAULT_HOST, port, project_path)
    manifest = _bridge_manifest()
    return jsonify(
        {
            "ok": True,
            "data": {
                "host": DEFAULT_HOST,
                "port": port,
                "url": url,
                "project_path": project_path,
                "bridge_installed": _is_bridge_installed(manifest),
                "bridge_version": manifest.get("version") if manifest else None,
                "git_enabled": _git_enabled(),
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

    normalized = _normalize_project_path(str(folder))
    _stop_shell()
    _SHELL_STATE["project_path"] = normalized
    history_store.touch_project(normalized)

    try:
        _ensure_running()
    except Exception as exc:  # pragma: no cover - defensive
        current_app.logger.exception("Failed to launch code-server for project")
        return jsonify({"ok": False, "error": str(exc)}), 500

    port = _SHELL_STATE.get("port")
    manifest = _bridge_manifest()
    url = _build_server_url(DEFAULT_HOST, port, normalized)
    return jsonify(
        {
            "ok": True,
            "data": {
                "host": DEFAULT_HOST,
                "port": port,
                "project_path": normalized,
                "url": url,
                "bridge_installed": _is_bridge_installed(manifest),
                "bridge_version": manifest.get("version") if manifest else None,
                "git_enabled": _git_enabled(),
            },
        }
    )


@code_oss_bp.get("/preferences")
def get_preferences():
    project = request.args.get("project") or _SHELL_STATE.get("project_path")
    prefs = preferences_store.get_preferences(project)
    return jsonify({"ok": True, "data": prefs})


@code_oss_bp.post("/preferences")
def update_preferences():
    payload = request.get_json(silent=True) or {}
    editor = payload.get("editor") if isinstance(payload.get("editor"), dict) else None
    ui = payload.get("ui") if isinstance(payload.get("ui"), dict) else None
    project_payload = payload.get("project") if isinstance(payload.get("project"), dict) else None

    try:
        updated = preferences_store.update_preferences(
            editor=editor,
            ui=ui,
            project=project_payload,
        )
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    return jsonify({"ok": True, "data": updated})


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


@code_oss_bp.get("/history")
def get_history():
    project = request.args.get("project")
    if project:
        normalized = _normalize_project_path(project)
        files = history_store.list_files(normalized)
        return jsonify(
            {
                "ok": True,
                "data": {
                    "project_path": normalized,
                    "files": files,
                },
            }
        )
    return jsonify(
        {
            "ok": True,
            "data": {
                "recent_projects": history_store.list_projects(),
            },
        }
    )


@code_oss_bp.post("/history/project")
def touch_history_project():
    payload = request.get_json(silent=True) or {}
    path = payload.get("path")
    if not path:
        return jsonify({"ok": False, "error": "Missing project path"}), 400
    normalized = _normalize_project_path(path)
    entry = history_store.touch_project(normalized)
    return jsonify({"ok": True, "data": entry})


@code_oss_bp.post("/history/file")
def touch_history_file():
    payload = request.get_json(silent=True) or {}
    project_path = payload.get("project_path")
    file_path = payload.get("file_path")
    if not project_path or not file_path:
        return jsonify({"ok": False, "error": "Missing project_path or file_path"}), 400
    normalized_project = _normalize_project_path(project_path)
    normalized_file = _normalize_file_path(file_path)
    entry = history_store.touch_file(normalized_project, normalized_file)
    return jsonify({"ok": True, "data": entry})


@code_oss_bp.delete("/history/file")
def delete_history_file():
    payload = request.get_json(silent=True) or {}
    project_path = payload.get("project_path")
    file_path = payload.get("file_path")
    if not project_path or not file_path:
        return jsonify({"ok": False, "error": "Missing project_path or file_path"}), 400
    normalized_project = _normalize_project_path(project_path)
    normalized_file = _normalize_file_path(file_path)
    removed = history_store.remove_file(normalized_project, normalized_file)
    return jsonify({"ok": True, "data": {"removed": removed}})


@code_oss_bp.get("/git/settings")
def get_git_settings():
    project = _SHELL_STATE.get("project_path")
    cache_info = None
    if project:
        normalized = _normalize_project_path(project)
        cache_entry = _GIT_STATUS_CACHE.get(normalized)
        if cache_entry:
            data = cache_entry.get("data", {})
            cache_info = {
                "project": normalized,
                "generated_at": data.get("generated_at"),
                "summary": data.get("summary"),
            }
    return jsonify(
        {
            "ok": True,
            "data": {
                "enabled": _git_enabled(),
                "ttl": _git_cache_ttl(),
                "current_project": project,
                "last_scan": cache_info,
            },
        }
    )


@code_oss_bp.post("/git/settings")
def update_git_settings():
    payload = request.get_json(silent=True) or {}
    changed = False

    if "enabled" in payload:
        _GIT_SETTINGS["enabled"] = bool(payload.get("enabled"))
        changed = True

    if "ttl" in payload:
        try:
            ttl_value = float(payload.get("ttl"))
            if ttl_value > 0:
                _GIT_SETTINGS["ttl"] = max(1.0, min(ttl_value, 60.0))
                changed = True
        except (TypeError, ValueError):
            pass

    if changed:
        _clear_git_cache()

    return jsonify(
        {
            "ok": True,
            "data": {
                "enabled": _git_enabled(),
                "ttl": _git_cache_ttl(),
            },
        }
    )


@code_oss_bp.post("/edits")
def enqueue_edits():
    payload = request.get_json(silent=True) or {}
    doc_id = payload.get("doc_id")
    if not doc_id:
        return jsonify({"ok": False, "error": "Missing doc_id"}), 400

    base_rev = payload.get("base_rev")
    edits = payload.get("edits")
    text = payload.get("text")

    if edits and text is not None:
        return jsonify({"ok": False, "error": "Provide either edits or text, not both"}), 400
    if not edits and text is None:
        return jsonify({"ok": False, "error": "Missing edits/text payload"}), 400

    command_type = "apply_edits" if edits else "replace_full"
    op_id = payload.get("op_id") or f"op_{int(time.time() * 1000)}"

    command: Dict[str, Any] = {
        "type": command_type,
        "op_id": op_id,
        "doc_id": doc_id,
        "base_rev": base_rev,
    }

    if edits:
        command["edits"] = edits
    if text is not None:
        command["text"] = text

    try:
        _enqueue_bridge_command(command)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    return jsonify({"ok": True, "data": {"op_id": op_id, "queued": True}})
