from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

from flask import Blueprint, current_app, jsonify, request

from app.framework_shells import _manager as get_framework_shell_manager

termux_lm_bp = Blueprint("termux_lm", __name__)

CACHE_ROOT = Path.home() / ".cache" / "termux_lm"
MODELS_DIR = CACHE_ROOT / "models"
STATE_PATH = CACHE_ROOT / "state.json"

CACHE_ROOT.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

def _model_dir(model_id: str) -> Path:
    return MODELS_DIR / model_id


def _manifest_path(model_id: str) -> Path:
    return _model_dir(model_id) / "model.json"


def _sessions_dir(model_id: str) -> Path:
    directory = _model_dir(model_id) / "sessions"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _session_path(model_id: str, session_id: str) -> Path:
    return _sessions_dir(model_id) / f"{session_id}.json"


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    tmp.replace(path)


def _read_json(path: Path) -> Dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:  # pragma: no cover - best effort logging
        current_app.logger.warning("termux_lm: failed to read %s: %s", path, exc)
        return None


def _write_model_manifest(model: Dict[str, Any]) -> Dict[str, Any]:
    model_id = model["id"]
    path = _manifest_path(model_id)
    manifest = {
        "id": model_id,
        "type": model.get("type", "local"),
        "name": model.get("name") or model_id,
        "path": model.get("path"),
        "provider": model.get("provider"),
        "api_key": model.get("api_key"),
        "endpoint": model.get("endpoint"),
        "context_window": model.get("context_window") or 4096,
        "threads": model.get("threads"),
        "gpu_layers": model.get("gpu_layers"),
        "batch_size": model.get("batch_size"),
        "host": model.get("host", "127.0.0.1"),
        "port": model.get("port", 8081),
        "created_at": model.get("created_at") or time.time(),
        "updated_at": time.time(),
    }
    _write_json(path, manifest)
    return manifest


def _load_model(model_id: str) -> Dict[str, Any] | None:
    manifest = _read_json(_manifest_path(model_id))
    if manifest:
        manifest["id"] = model_id
    return manifest


def _load_models() -> List[Dict[str, Any]]:
    manifests: List[Dict[str, Any]] = []
    for manifest_path in MODELS_DIR.glob("*/model.json"):
        model_id = manifest_path.parent.name
        data = _load_model(model_id)
        if data:
            manifests.append(data)
    return sorted(manifests, key=lambda item: item.get("updated_at", 0), reverse=True)


def _load_state() -> Dict[str, Any]:
    payload = _read_json(STATE_PATH) or {}
    payload.setdefault("active_model_id", None)
    payload.setdefault("active_session_id", None)
    payload.setdefault("shell_id", None)
    payload.setdefault("run_mode", "chat")
    return payload


def _save_state(state: Dict[str, Any]) -> None:
    _write_json(STATE_PATH, state)


def _cleanup_state(manager, state: Dict[str, Any]) -> Dict[str, Any]:
    shell_id = state.get("shell_id")
    if not shell_id:
        return state
    record = manager.get_shell(shell_id)
    if not record:
        state["shell_id"] = None
        _save_state(state)
        return state
    description = manager.describe(record)
    stats = description.get("stats") or {}
    if not stats.get("alive"):
        try:
            manager.remove_shell(shell_id, force=True)
        except Exception as exc:  # pragma: no cover - defensive logging
            current_app.logger.warning("termux_lm: failed to remove stale shell %s: %s", shell_id, exc)
        state["shell_id"] = None
        _save_state(state)
    return state


def _generate_session_id() -> str:
    return f"sess_{int(time.time())}_{uuid.uuid4().hex[:6]}"


def _load_session(model_id: str, session_id: str) -> Dict[str, Any] | None:
    payload = _read_json(_session_path(model_id, session_id))
    if not payload:
        return None
    payload.setdefault("messages", [])
    payload.setdefault("title", "Session")
    payload.setdefault("run_mode", "chat")
    payload.setdefault("created_at", time.time())
    payload.setdefault("updated_at", time.time())
    payload["id"] = session_id
    return payload


def _save_session(model_id: str, session: Dict[str, Any]) -> Dict[str, Any]:
    session_id = session["id"]
    session["updated_at"] = time.time()
    payload = dict(session)
    payload.pop("id", None)
    _write_json(_session_path(model_id, session_id), payload)
    session["id"] = session_id
    return session


def _list_sessions(model_id: str) -> List[Dict[str, Any]]:
    sessions: List[Dict[str, Any]] = []
    for path in _sessions_dir(model_id).glob("*.json"):
        session_id = path.stem
        data = _load_session(model_id, session_id)
        if data:
            messages = data.get("messages") or []
            data["message_count"] = len(messages)
            last = messages[-1]["content"] if messages else ""
            data["last_message"] = last[-160:] if isinstance(last, str) else ""
            sessions.append(data)
    return sorted(sessions, key=lambda item: item.get("updated_at", 0), reverse=True)


def _create_session(model_id: str, title: str | None, run_mode: str = "chat") -> Dict[str, Any]:
    session_id = _generate_session_id()
    session = {
        "id": session_id,
        "title": title or "New Chat",
        "messages": [],
        "run_mode": run_mode,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    return _save_session(model_id, session)


def _append_message(model_id: str, session_id: str, role: str, content: str) -> Dict[str, Any] | None:
    session = _load_session(model_id, session_id)
    if not session:
        return None
    messages = session.setdefault("messages", [])
    messages.append({
        "role": role,
        "content": content,
        "created_at": time.time(),
    })
    return _save_session(model_id, session)


def _state_payload(manager, state: Dict[str, Any]) -> Dict[str, Any]:
    shell_id = state.get("shell_id")
    shell_payload = None
    if shell_id:
        record = manager.get_shell(shell_id)
        if record:
            shell_payload = manager.describe(record)
        else:
            state["shell_id"] = None
            _save_state(state)
    return {
        "active_model_id": state.get("active_model_id"),
        "active_session_id": state.get("active_session_id"),
        "shell": shell_payload,
        "run_mode": state.get("run_mode", "chat"),
    }


def _build_llama_command(model: Dict[str, Any]) -> List[str]:
    model_path = Path(model.get("path", "")).expanduser()
    command = ["llama-server", "--model", str(model_path)]
    host = model.get("host") or "127.0.0.1"
    port = model.get("port") or 8081
    command.extend(["--host", str(host), "--port", str(port)])
    command.extend(["--ctx-size", str(int(model.get("context_window") or 4096))])
    if isinstance(model.get("threads"), int):
        command.extend(["--threads", str(int(model["threads"]))])
    if isinstance(model.get("gpu_layers"), int):
        command.extend(["--gpu-layers", str(int(model["gpu_layers"]))])
    if isinstance(model.get("batch_size"), int):
        command.extend(["--batch-size", str(int(model["batch_size"]))])
    extra = model.get("server_args")
    if isinstance(extra, list):
        command.extend(str(arg) for arg in extra)
    return command


def _terminate_shell(manager, shell_id: str) -> None:
    try:
        manager.remove_shell(shell_id, force=True)
    except KeyError:
        pass
    except Exception as exc:  # pragma: no cover
        current_app.logger.warning("termux_lm: failed to terminate shell %s: %s", shell_id, exc)


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


@termux_lm_bp.route("/models", methods=["GET"])
def list_models() -> Any:
    return jsonify({"ok": True, "data": _load_models()})


@termux_lm_bp.route("/models", methods=["POST"])
def create_model() -> Any:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "JSON object required"}), 400

    model_type = payload.get("type")
    if model_type not in {"local", "remote"}:
        return jsonify({"ok": False, "error": "type must be 'local' or 'remote'"}), 400

    model_id = payload.get("id") or str(uuid.uuid4())
    payload["id"] = model_id

    if model_type == "local":
        raw_path = payload.get("path")
        if not isinstance(raw_path, str) or not raw_path.strip():
            return jsonify({"ok": False, "error": "local model requires 'path'"}), 400
        payload["path"] = str(Path(raw_path).expanduser())
    else:
        api_key = payload.get("api_key")
        if not isinstance(api_key, str) or not api_key.strip():
            return jsonify({"ok": False, "error": "remote model requires 'api_key'"}), 400

    manifest = _write_model_manifest(payload)
    return jsonify({"ok": True, "data": manifest})


@termux_lm_bp.route("/models/<model_id>", methods=["PUT"])
def update_model(model_id: str) -> Any:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "JSON object required"}), 400

    model = _load_model(model_id)
    if not model:
        return jsonify({"ok": False, "error": "model not found"}), 404

    model.update(payload)
    manifest = _write_model_manifest(model)
    return jsonify({"ok": True, "data": manifest})


@termux_lm_bp.route("/models/<model_id>", methods=["DELETE"])
def delete_model(model_id: str) -> Any:
    directory = _model_dir(model_id)
    if not directory.exists():
        return jsonify({"ok": False, "error": "model not found"}), 404
    shutil.rmtree(directory, ignore_errors=True)

    state = _load_state()
    if state.get("active_model_id") == model_id:
        manager = get_framework_shell_manager()
        shell_id = state.get("shell_id")
        if shell_id:
            _terminate_shell(manager, shell_id)
        state["active_model_id"] = None
        state["active_session_id"] = None
        state["shell_id"] = None
        _save_state(state)

    return jsonify({"ok": True, "data": {"deleted": model_id}})


@termux_lm_bp.route("/models/<model_id>/load", methods=["POST"])
def load_model(model_id: str) -> Any:
    model = _load_model(model_id)
    if not model:
        return jsonify({"ok": False, "error": "model not found"}), 404

    manager = get_framework_shell_manager()
    state = _cleanup_state(manager, _load_state())

    current_shell = state.get("shell_id")
    if current_shell:
        _terminate_shell(manager, current_shell)
        state["shell_id"] = None

    if model.get("type") == "local":
        model_path = Path(model.get("path", "")).expanduser()
        if not model_path.exists():
            return jsonify({"ok": False, "error": "Model file not found"}), 400
        try:
            record = manager.spawn_shell(
                _build_llama_command(model),
                cwd=str(model_path.parent),
                env={
                    "TERMUX_LM_MODEL_ID": model_id,
                    "TERMUX_LM_MODEL_PATH": str(model_path),
                    "MODEL_ID": model_id,
                },
                label=f"termux-lm:{model_id}",
                autostart=True,
            )
        except Exception as exc:
            current_app.logger.error("termux_lm: failed to spawn llama-server for %s: %s", model_id, exc)
            return jsonify({"ok": False, "error": f"Failed to start llama-server: {exc}"}), 500
        state["shell_id"] = record.id
    else:
        state["shell_id"] = None

    state["active_model_id"] = model_id
    _save_state(state)

    payload = _state_payload(manager, state)
    return jsonify({"ok": True, "data": payload})


@termux_lm_bp.route("/models/<model_id>/unload", methods=["POST"])
def unload_model(model_id: str) -> Any:
    manager = get_framework_shell_manager()
    state = _cleanup_state(manager, _load_state())
    if state.get("active_model_id") == model_id:
        shell_id = state.get("shell_id")
        if shell_id:
            _terminate_shell(manager, shell_id)
        state["active_model_id"] = None
        state["active_session_id"] = None
        state["shell_id"] = None
        _save_state(state)
    payload = _state_payload(manager, state)
    return jsonify({"ok": True, "data": payload})


@termux_lm_bp.route("/models/<model_id>/sessions", methods=["GET", "POST"])
def sessions_index(model_id: str) -> Any:
    model = _load_model(model_id)
    if not model:
        return jsonify({"ok": False, "error": "model not found"}), 404

    if request.method == 'GET':
        return jsonify({"ok": True, "data": _list_sessions(model_id)})

    payload = request.get_json(silent=True) or {}
    title = payload.get("title") if isinstance(payload, dict) else None
    run_mode = payload.get("run_mode") if isinstance(payload, dict) else "chat"
    session = _create_session(model_id, title, run_mode)

    state = _load_state()
    state["active_model_id"] = model_id
    state["active_session_id"] = session["id"]
    state["run_mode"] = run_mode
    _save_state(state)

    return jsonify({"ok": True, "data": session})


@termux_lm_bp.route("/models/<model_id>/sessions/<session_id>", methods=["GET"])
def sessions_show(model_id: str, session_id: str) -> Any:
    session = _load_session(model_id, session_id)
    if not session:
        return jsonify({"ok": False, "error": "session not found"}), 404
    return jsonify({"ok": True, "data": session})


@termux_lm_bp.route("/models/<model_id>/sessions/<session_id>", methods=["DELETE"])
def sessions_delete(model_id: str, session_id: str) -> Any:
    path = _session_path(model_id, session_id)
    if not path.exists():
        return jsonify({"ok": False, "error": "session not found"}), 404
    path.unlink(missing_ok=True)
    state = _load_state()
    if state.get("active_session_id") == session_id:
        state["active_session_id"] = None
        _save_state(state)
    return jsonify({"ok": True, "data": {"deleted": session_id}})


@termux_lm_bp.route("/models/<model_id>/sessions/<session_id>/activate", methods=["POST"])
def sessions_activate(model_id: str, session_id: str) -> Any:
    session = _load_session(model_id, session_id)
    if not session:
        return jsonify({"ok": False, "error": "session not found"}), 404
    state = _load_state()
    state["active_model_id"] = model_id
    state["active_session_id"] = session_id
    state["run_mode"] = session.get("run_mode", "chat")
    _save_state(state)
    return jsonify({"ok": True, "data": session})


@termux_lm_bp.route("/models/<model_id>/sessions/<session_id>/chat", methods=["POST"])
def sessions_chat(model_id: str, session_id: str) -> Any:
    model = _load_model(model_id)
    if not model:
        return jsonify({"ok": False, "error": "model not found"}), 404
    session = _load_session(model_id, session_id)
    if not session:
        return jsonify({"ok": False, "error": "session not found"}), 404

    payload = request.get_json(silent=True) or {}
    prompt = payload.get("message")
    if not isinstance(prompt, str) or not prompt.strip():
        return jsonify({"ok": False, "error": "message is required"}), 400

    updated = _append_message(model_id, session_id, "user", prompt.strip())
    if not updated:
        return jsonify({"ok": False, "error": "failed to append message"}), 500

    return jsonify({"ok": True, "data": updated})


@termux_lm_bp.route("/sessions/active", methods=["GET"])
def active_session() -> Any:
    manager = get_framework_shell_manager()
    state = _cleanup_state(manager, _load_state())
    payload = _state_payload(manager, state)
    return jsonify({"ok": True, "data": payload})


@termux_lm_bp.route("/shell/log", methods=["GET"])
def shell_log() -> Any:
    manager = get_framework_shell_manager()
    state = _cleanup_state(manager, _load_state())
    shell_id = state.get("shell_id")
    tail = request.args.get("tail", type=int) or 200
    if not shell_id:
        return jsonify({"ok": True, "data": {"shell": None, "stdout": "", "stderr": ""}})

    record = manager.get_shell(shell_id)
    if not record:
        state["shell_id"] = None
        _save_state(state)
        return jsonify({"ok": True, "data": {"shell": None, "stdout": "", "stderr": ""}})

    details = manager.describe(record, include_logs=True, tail_lines=tail)
    logs = details.get("logs") or {}
    stdout_tail = logs.get("stdout_tail") or []
    stderr_tail = logs.get("stderr_tail") or []
    return jsonify({
        "ok": True,
        "data": {
            "shell": details,
            "stdout": "\n".join(stdout_tail),
            "stderr": "\n".join(stderr_tail),
        },
    })
*** End of File
