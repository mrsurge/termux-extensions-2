from __future__ import annotations

import json
import shutil
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context

from app.framework_shells import _manager as get_framework_shell_manager

termux_lm_bp = Blueprint("termux_lm", __name__)

CACHE_ROOT = Path.home() / ".cache" / "termux_lm"
MODELS_DIR = CACHE_ROOT / "models"
STATE_PATH = CACHE_ROOT / "state.json"
LOG_PATH = CACHE_ROOT / "stream.log"

CACHE_ROOT.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ----------------------------------------------------------------------------
# Persistence helpers
# ----------------------------------------------------------------------------

def _model_dir(model_id: str) -> Path:
    return MODELS_DIR / model_id


def _manifest_path(model_id: str) -> Path:
    return _model_dir(model_id) / "model.json"


def _sessions_dir(model_id: str) -> Path:
    path = _model_dir(model_id) / "sessions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _session_path(model_id: str, session_id: str) -> Path:
    return _sessions_dir(model_id) / f"{session_id}.json"


def _append_stream_log(model_id: str, session_id: str, message: str) -> None:
    prefix = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {model_id}/{session_id}: "
    try:
        with LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(prefix + message + "\n")
    except Exception as exc:  # pragma: no cover - logging best effort
        current_app.logger.warning("termux_lm: failed to write stream log: %s", exc)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    tmp.replace(path)


def _read_json(path: Path) -> Dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            return data
    except Exception as exc:  # pragma: no cover - best effort logging
        current_app.logger.warning("termux_lm: failed to read %s: %s", path, exc)
    return None


def _write_model_manifest(model: Dict[str, Any]) -> Dict[str, Any]:
    model_id = model["id"]
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
    _write_json(_manifest_path(model_id), manifest)
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
    state = _read_json(STATE_PATH) or {}
    state.setdefault("active_model_id", None)
    state.setdefault("active_session_id", None)
    state.setdefault("run_mode", "chat")
    state.setdefault("shell_id", None)
    return state


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


def _list_sessions(model_id: str) -> List[Dict[str, Any]]:
    sessions: List[Dict[str, Any]] = []
    for path in _sessions_dir(model_id).glob("*.json"):
        payload = _read_json(path)
        if not payload:
            continue
        payload.setdefault("messages", [])
        payload.setdefault("title", "Session")
        payload.setdefault("run_mode", "chat")
        payload.setdefault("created_at", time.time())
        payload.setdefault("updated_at", time.time())
        payload["id"] = path.stem
        sessions.append(payload)
    return sorted(sessions, key=lambda item: item.get("updated_at", 0), reverse=True)


def _save_session(model_id: str, session: Dict[str, Any]) -> Dict[str, Any]:
    session_id = session["id"]
    session["updated_at"] = time.time()
    payload = dict(session)
    payload.pop("id", None)
    _write_json(_session_path(model_id, session_id), payload)
    session["id"] = session_id
    return session


def _create_session(model_id: str, title: str | None, run_mode: str) -> Dict[str, Any]:
    session_id = f"sess_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    session = {
        "id": session_id,
        "title": title or "New Chat",
        "run_mode": run_mode,
        "messages": [],
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    return _save_session(model_id, session)


def _append_message(model_id: str, session_id: str, role: str, content: str) -> Dict[str, Any] | None:
    path = _session_path(model_id, session_id)
    payload = _read_json(path)
    if not payload:
        return None
    messages = payload.setdefault("messages", [])
    messages.append({
        "role": role,
        "content": content,
        "created_at": time.time(),
    })
    payload["updated_at"] = time.time()
    _write_json(path, payload)
    payload["id"] = session_id
    return payload


def _build_llama_command(model: Dict[str, Any]) -> List[str]:
    model_path = Path(model.get("path", "")).expanduser()
    command = ["llama-server", "--model", str(model_path)]
    host = model.get("host", "127.0.0.1")
    port = model.get("port", 8081)
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
    except Exception as exc:  # pragma: no cover - defensive logging
        current_app.logger.warning("termux_lm: failed to terminate shell %s: %s", shell_id, exc)


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
        "run_mode": state.get("run_mode", "chat"),
        "shell": shell_payload,
    }


def _llama_chat_completion(model: Dict[str, Any], session: Dict[str, Any], prompt: str) -> str:
    host = model.get("host", "127.0.0.1")
    port = model.get("port", 8081)
    url = f"http://{host}:{port}/v1/chat/completions"

    messages = list(session.get("messages") or [])
    messages.append({"role": "user", "content": prompt})
    payload = json.dumps({
        "model": model.get("name") or model.get("id"),
        "messages": messages,
        "stream": False,
    }).encode("utf-8")

    request_obj = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request_obj, timeout=120) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {exc.code}: {detail}")
    except Exception as exc:
        raise RuntimeError(str(exc))

    try:
        data = json.loads(body)
    except Exception as exc:
        raise RuntimeError(f"Failed to decode llama-server response: {exc}")

    choices = data.get("choices")
    if not choices:
        raise RuntimeError("llama-server returned no choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not isinstance(content, str):
        raise RuntimeError("llama-server response missing content")
    return content


def _llama_stream_completion(
    model: Dict[str, Any],
    session: Dict[str, Any],
    prompt: str,
) -> Iterable[Dict[str, Any]]:
    host = model.get("host", "127.0.0.1")
    port = model.get("port", 8081)
    url = f"http://{host}:{port}/v1/chat/completions"

    messages = list(session.get("messages") or [])
    messages.append({"role": "user", "content": prompt})
    payload = json.dumps(
        {
            "model": model.get("name") or model.get("id"),
            "messages": messages,
            "stream": True,
        }
    ).encode("utf-8")

    request_obj = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        response = urllib.request.urlopen(request_obj, timeout=600)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {exc.code}: {detail}")
    except Exception as exc:  # pragma: no cover - network failure path
        raise RuntimeError(str(exc))

    decoder = lambda chunk: chunk.decode("utf-8", errors="ignore")
    buffer = ""
    try:
        with response:
            while True:
                raw = response.readline()
                if not raw:
                    break
                piece = decoder(raw)
                buffer += piece
                while "\n\n" in buffer:
                    block, buffer = buffer.split("\n\n", 1)
                    line = block.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    payload_str = line[5:].strip()
                    if not payload_str:
                        continue
                    if payload_str == "[DONE]":
                        yield {"type": "done"}
                        continue
                    try:
                        data = json.loads(payload_str)
                    except json.JSONDecodeError:  # pragma: no cover - defensive
                        continue
                    choices = data.get("choices")
                    if not isinstance(choices, list) or not choices:
                        continue
                    delta = choices[0].get("delta")
                    if not isinstance(delta, dict):
                        continue
                    content = delta.get("content")
                    if isinstance(content, str) and content:
                        yield {"type": "token", "content": content}
    finally:  # pragma: no cover - ensure socket closes
        try:
            response.close()
        except Exception:
            pass


def _sse(payload: Dict[str, Any], event: Optional[str] = None) -> str:
    data = json.dumps(payload, ensure_ascii=False)
    if event:
        return f"event: {event}\ndata: {data}\n\n"
    return f"data: {data}\n\n"


# ----------------------------------------------------------------------------
# API endpoints
# ----------------------------------------------------------------------------


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


@termux_lm_bp.route("/models/<model_id>/sessions/<session_id>", methods=["GET", "DELETE"])
def sessions_detail(model_id: str, session_id: str) -> Any:
    path = _session_path(model_id, session_id)
    session = _read_json(path)
    if not session:
        return jsonify({"ok": False, "error": "session not found"}), 404
    session.setdefault("messages", [])
    session.setdefault("run_mode", "chat")
    session["id"] = session_id

    if request.method == 'GET':
        return jsonify({"ok": True, "data": session})

    # DELETE
    path.unlink(missing_ok=True)
    state = _load_state()
    if state.get("active_session_id") == session_id:
        state["active_session_id"] = None
        _save_state(state)
    return jsonify({"ok": True, "data": {"deleted": session_id}})


@termux_lm_bp.route("/models/<model_id>/sessions/<session_id>/activate", methods=["POST"])
def sessions_activate(model_id: str, session_id: str) -> Any:
    session = _read_json(_session_path(model_id, session_id))
    if not session:
        return jsonify({"ok": False, "error": "session not found"}), 404
    state = _load_state()
    state["active_model_id"] = model_id
    state["active_session_id"] = session_id
    state["run_mode"] = session.get("run_mode", "chat")
    _save_state(state)
    session.setdefault("messages", [])
    session["id"] = session_id
    return jsonify({"ok": True, "data": session})


@termux_lm_bp.route("/models/<model_id>/sessions/<session_id>/messages", methods=["POST"])
def sessions_message(model_id: str, session_id: str) -> Any:
    payload = request.get_json(silent=True) or {}
    text = payload.get("message")
    role = payload.get("role", "user")
    if not isinstance(text, str) or not text.strip():
        return jsonify({"ok": False, "error": "message is required"}), 400
    updated = _append_message(model_id, session_id, role, text.strip())
    if not updated:
        return jsonify({"ok": False, "error": "failed to record message"}), 500
    return jsonify({"ok": True, "data": updated})


@termux_lm_bp.route("/models/<model_id>/sessions/<session_id>/chat", methods=["POST"])
def sessions_chat(model_id: str, session_id: str) -> Any:
    model = _load_model(model_id)
    if not model:
        return jsonify({"ok": False, "error": "model not found"}), 404
    session = _read_json(_session_path(model_id, session_id))
    if not session:
        return jsonify({"ok": False, "error": "session not found"}), 404

    payload = request.get_json(silent=True) or {}
    prompt = payload.get("message")
    stream = bool(payload.get("stream"))
    if not isinstance(prompt, str) or not prompt.strip():
        return jsonify({"ok": False, "error": "message is required"}), 400

    clean_prompt = prompt.strip()
    user_added = _append_message(model_id, session_id, "user", clean_prompt)
    if not user_added:
        return jsonify({"ok": False, "error": "failed to record message"}), 500

    if not stream:
        try:
            assistant = _llama_chat_completion(model, user_added, clean_prompt)
        except RuntimeError as exc:
            current_app.logger.error("termux_lm: llama completion failed: %s", exc)
            return jsonify({"ok": False, "error": str(exc)}), 500

        updated = _append_message(model_id, session_id, "assistant", assistant)
        if not updated:
            return jsonify({"ok": False, "error": "failed to record assistant message"}), 500

        return jsonify({"ok": True, "data": updated})

    def generate() -> Iterable[str]:
        assistant_chunks: List[str] = []
        _append_stream_log(model_id, session_id, f"start:{clean_prompt}")
        try:
            for event in _llama_stream_completion(model, user_added, clean_prompt):
                if event.get("type") == "token":
                    token = event.get("content", "")
                    if token:
                        assistant_chunks.append(token)
                        _append_stream_log(model_id, session_id, f"token:{token}")
                        yield _sse({"type": "token", "content": token})
                elif event.get("type") == "done":
                    _append_stream_log(model_id, session_id, "done")
                    yield _sse({"type": "done"})
        except RuntimeError as exc:
            current_app.logger.error("termux_lm: llama streaming failed: %s", exc)
            _append_stream_log(model_id, session_id, f"error:{exc}")
            yield _sse({"type": "error", "message": str(exc)})
            return

        full_message = "".join(assistant_chunks).strip()
        if not full_message:
            _append_stream_log(model_id, session_id, "warning:empty_response")
            return
        _append_stream_log(model_id, session_id, f"assistant:{full_message}")
        updated = _append_message(model_id, session_id, "assistant", full_message)
        if not updated:
            yield _sse({"type": "error", "message": "failed to record assistant message"})

    response = Response(stream_with_context(generate()), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


@termux_lm_bp.route("/sessions/active", methods=["GET"])
def active_state() -> Any:
    manager = get_framework_shell_manager()
    state = _cleanup_state(manager, _load_state())
    payload = _state_payload(manager, state)
    return jsonify({"ok": True, "data": payload})


@termux_lm_bp.route("/shell/log", methods=["GET"])
def shell_log() -> Any:
    manager = get_framework_shell_manager()
    state = _cleanup_state(manager, _load_state())
    shell_id = state.get("shell_id")
    if not shell_id:
        return jsonify({"ok": True, "data": {"shell": None, "stdout": "", "stderr": ""}})

    record = manager.get_shell(shell_id)
    if not record:
        state["shell_id"] = None
        _save_state(state)
        return jsonify({"ok": True, "data": {"shell": None, "stdout": "", "stderr": ""}})

    details = manager.describe(record, include_logs=True, tail_lines=200)
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
