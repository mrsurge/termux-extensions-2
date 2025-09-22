"""Backend blueprint for the Distro app."""

from __future__ import annotations

import json
import os
import subprocess
import shlex
from pathlib import Path
from typing import Dict, List

from flask import Blueprint, jsonify, request, current_app

from app.framework_shells import FrameworkShellManager

from .plugins import get_plugin

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config" / "containers.json"
STATE_PATH = BASE_DIR / "state.json"

framework_shells = FrameworkShellManager()

distro_bp = Blueprint("distro", __name__)


def _run_script(script_name: str, args: list[str] | None = None):
    scripts_dir = Path(current_app.root_path).parent / 'scripts'
    script_path = scripts_dir / script_name
    if args is None:
        args = []
    try:
        subprocess.run(['chmod', '+x', str(script_path)], check=True)
        result = subprocess.run([str(script_path)] + args, capture_output=True, text=True, check=True)
        return result.stdout, None
    except Exception as exc:
        return None, str(exc)


# ---------------------------------------------------------------------------
# Config / state helpers

def _save_config(containers: List[Dict]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(containers, indent=2), encoding='utf-8')

def _load_config() -> List[Dict]:
    if not CONFIG_PATH.exists():
        return []
    try:
        with CONFIG_PATH.open('r', encoding='utf-8') as fh:
            data = json.load(fh)
        if isinstance(data, list):
            return data
        raise ValueError('Container config must be a JSON array')
    except json.JSONDecodeError as exc:
        raise ValueError(f'Failed to parse container config: {exc}')


def _load_state() -> Dict:
    if not STATE_PATH.exists():
        return {"containers": {}}
    try:
        with STATE_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return {"containers": {}}
        data.setdefault("containers", {})
        return data
    except json.JSONDecodeError:
        return {"containers": {}}


def _save_state(state: Dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _get_state_entry(container_id: str) -> Dict:
    state = _load_state()
    return state["containers"].get(container_id, {})


def _update_container_state(container_id: str, updates: Dict) -> None:
    state = _load_state()
    containers_state = state.setdefault('containers', {})
    entry = containers_state.get(container_id, {})
    if not isinstance(entry, dict):
        entry = {}
    for key, value in updates.items():
        if value is None:
            entry.pop(key, None)
        else:
            entry[key] = value
    containers_state[container_id] = entry
    _save_state(state)


def _clear_state_entry(container_id: str) -> None:
    state = _load_state()
    if state.setdefault("containers", {}).pop(container_id, None) is not None:
        _save_state(state)


# ---------------------------------------------------------------------------
# Utility helpers

def _expand_path(value: str | None) -> str | None:
    if not value:
        return value
    return os.path.abspath(os.path.expanduser(value))


def _first(ls: List[str] | None) -> str | None:
    if not ls:
        return None
    return ls[0]


def _get_shell_record(shell_id: str | None):
    if not shell_id:
        return None
    return framework_shells.get_shell(shell_id)


def _describe_shell(shell_id: str | None) -> Dict | None:
    record = _get_shell_record(shell_id)
    if not record:
        return None
    return framework_shells.describe(record)


def _shell_is_running(shell_id: str | None) -> bool:
    record = _get_shell_record(shell_id)
    if not record:
        return False
    stats = framework_shells.describe(record).get("stats") or {}
    return stats.get("alive", False)


def _determine_state(plugin, shell_id: str | None) -> str:
    record = _get_shell_record(shell_id)
    if record:
        stats = framework_shells.describe(record).get("stats") or {}
        if stats.get("alive"):
            return "running"
        exit_code = record.exit_code
        if exit_code not in (None, 0):
            return "error"
    try:
        if plugin.is_mounted():
            return "mounted"
    except Exception:
        pass
    return "offline"


def _run_command(command: List[str], *, env: Dict[str, str] | None = None) -> subprocess.CompletedProcess:
    env_map = os.environ.copy()
    if env:
        env_map.update(env)
    return subprocess.run(command, capture_output=True, text=True, env=env_map, check=False)


def _respond_error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def _normalize_container_payload(data: Dict, *, existing: Dict | None = None) -> Dict:
    if not isinstance(data, dict):
        raise ValueError('Payload must be an object')
    allowed_keys = {'id', 'type', 'label', 'rootfs', 'environment', 'mounts', 'auto_start', 'notes', 'cwd'}
    result = dict(existing or {})
    for key in allowed_keys:
        if key in data:
            result[key] = data[key]
    if not result.get('id'):
        raise ValueError('"id" is required')
    if existing is None:
        if not isinstance(result['id'], str):
            raise ValueError('"id" must be a string')
        result['id'] = result['id'].strip()
    result['type'] = (result.get('type') or 'chroot-distro').strip()
    if result['type'] not in {'chroot-distro'}:
        raise ValueError('Unsupported container type')
    env = result.get('environment') or {}
    if not isinstance(env, dict):
        raise ValueError('"environment" must be an object')
    result['environment'] = env
    mounts = result.get('mounts') or []
    if not isinstance(mounts, list):
        raise ValueError('"mounts" must be an array')
    result['mounts'] = mounts
    if isinstance(result.get('rootfs'), str) and 'CHROOT_DISTRO_PATH' not in env:
        rootfs_parent = os.path.dirname(os.path.expanduser(result['rootfs'].rstrip('/')))
        if rootfs_parent:
            env.setdefault('CHROOT_DISTRO_PATH', rootfs_parent)
    if 'auto_start' in result:
        result['auto_start'] = bool(result['auto_start'])
    return result


def _ensure_unique_id(containers: List[Dict], container_id: str, *, skip_index: int | None = None) -> None:
    for idx, item in enumerate(containers):
        if skip_index is not None and idx == skip_index:
            continue
        if item.get('id') == container_id:
            raise ValueError('Container ID already exists')


def _list_sessions():
    output, error = _run_script('list_sessions.sh')
    if error:
        raise RuntimeError(error)
    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'Failed to parse sessions: {exc}')


def _run_in_session(sid: str, command: str):
    return _run_script('run_in_session.sh', [sid, command])


# ---------------------------------------------------------------------------
# Routes

def _serialize_container(container: Dict, *, shell_map=None) -> Dict:
    container_id = container.get("id")
    try:
        plugin = get_plugin(container)
    except Exception as exc:
        payload = {
            'id': container_id,
            'label': container.get('label') or container_id,
            'type': container.get('type'),
            'rootfs': _expand_path(container.get('rootfs')),
            'state': 'error',
            'error': str(exc),
        }
        return payload
    saved = _get_state_entry(container_id)
    shell_id = saved.get("shell_id") if isinstance(saved, dict) else None
    shell_record = _get_shell_record(shell_id)
    if not shell_record and shell_map is not None:
        record = shell_map.get(f'distro:{container_id}')
        if record:
            shell_record = record
            shell_id = record.id
            _update_container_state(container_id, {'shell_id': shell_id})
    shell_info = framework_shells.describe(shell_record) if shell_record else None
    state = _determine_state(plugin, shell_id)

    payload = {
        "id": container_id,
        "label": container.get("label") or container_id,
        "type": container.get("type"),
        "rootfs": _expand_path(container.get("rootfs"))
    }
    payload["state"] = state
    payload["shell_id"] = shell_id
    payload["attachments"] = saved.get('attachments', []) if isinstance(saved, dict) else []
    if shell_info:
        payload["shell"] = shell_info
    return payload


@distro_bp.post('/containers')
def create_container():
    payload = request.get_json(silent=True) or {}
    try:
        containers = _load_config()
    except ValueError as exc:
        return _respond_error(str(exc), status=500)
    try:
        container = _normalize_container_payload(payload)
        _ensure_unique_id(containers, container['id'])
        get_plugin(container)
    except ValueError as exc:
        return _respond_error(str(exc))
    except Exception as exc:
        return _respond_error(str(exc), status=400)
    containers.append(container)
    _save_config(containers)
    return jsonify({'ok': True, 'data': _serialize_container(container)})


@distro_bp.put('/containers/<container_id>')
def update_container(container_id: str):
    container, idx, containers, error = _find_container(container_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    try:
        updated = _normalize_container_payload(payload, existing=container)
        _ensure_unique_id(containers, updated['id'], skip_index=idx)
        get_plugin(updated)
    except ValueError as exc:
        return _respond_error(str(exc))
    except Exception as exc:
        return _respond_error(str(exc), status=400)
    containers[idx] = updated
    _save_config(containers)
    return jsonify({'ok': True, 'data': _serialize_container(updated)})


@distro_bp.delete('/containers/<container_id>')
def delete_container(container_id: str):
    container, idx, containers, error = _find_container(container_id)
    if error:
        return error
    containers.pop(idx)
    _save_config(containers)
    _clear_state_entry(container_id)
    return jsonify({'ok': True, 'data': {'id': container_id}})


@distro_bp.get("/containers")
def list_containers():
    try:
        containers = _load_config()
    except ValueError as exc:
        return _respond_error(str(exc), status=500)
    shell_map = {record.label: record for record in framework_shells.list_shells()}
    data = [_serialize_container(container, shell_map=shell_map) for container in containers]
    return jsonify({"ok": True, "data": data})


@distro_bp.post("/containers/<container_id>/mount")
def mount_container(container_id: str):
    container, _idx, _containers, error = _find_container(container_id)
    if error:
        return error
    plugin = get_plugin(container)
    try:
        plugin.mount()
        result = _run_command(plugin.mount_command(), env=plugin.environment())
        if result.returncode != 0:
            return _respond_error(result.stderr or "Failed to mount container", status=500)
    except Exception as exc:
        return _respond_error(str(exc), status=500)
    return jsonify({"ok": True, "data": _serialize_container(container)})


@distro_bp.post("/containers/<container_id>/unmount")
def unmount_container(container_id: str):
    container, _idx, _containers, error = _find_container(container_id)
    if error:
        return error
    plugin = get_plugin(container)
    try:
        _run_command(plugin.unmount_command(), env=plugin.environment())
        plugin.unmount()
    except Exception as exc:
        return _respond_error(str(exc), status=500)
    return jsonify({"ok": True, "data": _serialize_container(container)})


@distro_bp.post("/containers/<container_id>/start")
def start_container(container_id: str):
    container, idx, containers, error = _find_container(container_id)
    if error:
        return error
    try:
        plugin = get_plugin(container)
    except Exception as exc:
        return _respond_error(str(exc), status=400)
    saved = _get_state_entry(container_id)
    shell_id = saved.get('shell_id') if isinstance(saved, dict) else None
    if _shell_is_running(shell_id):
        return _respond_error('Container already running', status=409)
    try:
        _run_command(plugin.force_unmount_command(), env=plugin.environment())
    except Exception:
        pass
    try:
        plugin.unmount(force=True)
    except Exception:
        pass
    try:
        plugin.mount()
        _run_command(plugin.mount_command(), env=plugin.environment())
        record = framework_shells.spawn_shell(
            plugin.login_command(),
            cwd=_expand_path(container.get('cwd')) or os.path.expanduser('~'),
            env=plugin.environment(),
            label=f"distro:{container_id}",
            autostart=bool(container.get('auto_start')),
        )
    except Exception as exc:
        return _respond_error(str(exc), status=500)
    _update_container_state(container_id, {'shell_id': record.id})
    return jsonify({'ok': True, 'data': _serialize_container(container)})


@distro_bp.post("/containers/<container_id>/stop")
def stop_container(container_id: str):
    container, idx, containers, error = _find_container(container_id)
    if error:
        return error
    try:
        plugin = get_plugin(container)
    except Exception as exc:
        return _respond_error(str(exc), status=400)
    saved = _get_state_entry(container_id)
    shell_id = saved.get('shell_id') if isinstance(saved, dict) else None
    if not shell_id:
        return _respond_error('Container is not running', status=409)
    try:
        framework_shells.terminate_shell(shell_id, force=False)
    except Exception as exc:
        return _respond_error(str(exc), status=500)
    try:
        _run_command(plugin.force_unmount_command(), env=plugin.environment())
    except Exception:
        pass
    try:
        plugin.unmount(force=True)
    except Exception:
        pass
    _update_container_state(container_id, {'shell_id': None, 'attachments': []})
    return jsonify({'ok': True, 'data': _serialize_container(container)})

@distro_bp.post("/containers/<container_id>/attach")
def attach_container(container_id: str):
    container, idx, containers, error = _find_container(container_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    sid = str(payload.get('sid', '')).strip()
    if not sid:
        return _respond_error("'sid' is required", status=400)
    try:
        plugin = get_plugin(container)
    except Exception as exc:
        return _respond_error(str(exc), status=400)
    try:
        sessions = _list_sessions()
    except Exception as exc:
        return _respond_error(str(exc), status=500)
    session = next((s for s in sessions if s.get('sid') == sid), None)
    if not session:
        return _respond_error('Session not found', status=404)
    if session.get('busy'):
        return _respond_error('Session is busy', status=409)
    env_assign = ' '.join(f"{k}={shlex.quote(v)}" for k, v in (plugin.environment() or {}).items() if v)
    command_parts = plugin.login_command()
    command_str = ' '.join(shlex.quote(part) for part in command_parts)
    full_cmd = f"{env_assign} {command_str}".strip()
    _, error_msg = _run_in_session(sid, full_cmd)
    if error_msg:
        return _respond_error(error_msg, status=500)
    entry = _get_state_entry(container_id)
    attachments = entry.get('attachments', []) if isinstance(entry, dict) else []
    if sid not in attachments:
        attachments.append(sid)
    _update_container_state(container_id, {'attachments': attachments})


@distro_bp.post("/containers/<container_id>/detach")
def detach_container(container_id: str):
    container, idx, containers, error = _find_container(container_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    sid = str(payload.get('sid', '')).strip()
    if not sid:
        return _respond_error("'sid' is required", status=400)
    try:
        plugin = get_plugin(container)
    except Exception as exc:
        return _respond_error(str(exc), status=400)
    entry = _get_state_entry(container_id)
    attachments = entry.get('attachments', []) if isinstance(entry, dict) else []
    if sid in attachments:
        attachments = [s for s in attachments if s != sid]
    try:
        _run_in_session(sid, 'exit')
    except Exception:
        pass
    _update_container_state(container_id, {'attachments': attachments})
    return jsonify({'ok': True, 'data': _serialize_container(container)})


@distro_bp.get("/attachments")
def list_attachments():
    state = _load_state()
    mapping = {}
    for container_id, entry in state.get('containers', {}).items():
        if not isinstance(entry, dict):
            continue
        for sid in entry.get('attachments', []) or []:
            mapping.setdefault(sid, []).append(container_id)
    return jsonify({'ok': True, 'data': mapping})


@distro_bp.post("/containers/<container_id>/command")
def run_container_command(container_id: str):
    container, idx, containers, error = _find_container(container_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    command = payload.get("command")
    if not command:
        return _respond_error("'command' is required", status=400)
    plugin = get_plugin(container)
    result = _run_command(plugin.exec_command(command), env=plugin.environment())
    ok = result.returncode == 0
    body = {
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }
    return jsonify({"ok": ok, "data": body})


@distro_bp.get("/containers/<container_id>/logs")
def get_container_logs(container_id: str):
    container, idx, containers, error = _find_container(container_id)
    if error:
        return error
    tail = request.args.get("tail", default=200, type=int)
    saved = _get_state_entry(container_id)
    shell_id = saved.get("shell_id") if isinstance(saved, dict) else None
    record = _get_shell_record(shell_id)
    if not record:
        return _respond_error("No logs available", status=404)
    description = framework_shells.describe(record, include_logs=True, tail_lines=tail)
    return jsonify({"ok": True, "data": description.get("logs", {})})


# ---------------------------------------------------------------------------
# Helpers

def _find_container(container_id: str):
    try:
        containers = _load_config()
    except ValueError as exc:
        return None, None, None, _respond_error(str(exc), status=500)
    for idx, container in enumerate(containers):
        if container.get('id') == container_id:
            return container, idx, containers, None
    return None, None, containers, _respond_error('Container not found', status=404)


@distro_bp.route("/")
def status():
    return jsonify({"ok": True, "data": {"message": "Distro API ready"}})
