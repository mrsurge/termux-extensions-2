"""Typed Aria Downloader domain handlers; transport lives in http_app.py."""

from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Iterable
from typing import Protocol, Self, cast
from urllib.parse import quote

from starlette.exceptions import HTTPException

from framework_shells import ShellRecord
from framework_shells import get_manager as get_framework_shell_manager

from app.te2_paths import te2_app_data_home

APP_ID = str(os.environ.get('TE_APP_ID') or 'aria_downloader').strip() or 'aria_downloader'

DEFAULT_RPC_URL = 'http://127.0.0.1:6800/jsonrpc'
MAX_RESULT_ITEMS = 200
RPC_TIMEOUT_SECONDS = 10

JsonValue = object
JsonObject = dict[str, object]
RpcResult = tuple[object | None, str | None]


class HttpResponse(Protocol):
    def __enter__(self) -> Self: ...
    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None: ...
    def read(self) -> bytes: ...


class ShellManager(Protocol):
    async def list_shells(self) -> list[ShellRecord]: ...
    async def get_shell(self, shell_id: str) -> ShellRecord | None: ...
    async def describe(self, record: ShellRecord, *, include_logs: bool = False, tail_lines: int = 0) -> JsonObject: ...
    async def remove_shell(self, shell_id: str, force: bool = False) -> bool: ...
    async def terminate_shell(self, shell_id: str, force: bool = False) -> None: ...
    async def spawn_shell(self, command: Iterable[str], *, cwd: str | None = None, env: dict[str, str] | None = None,
                          label: str | None = None, subgroups: list[str] | None = None, autostart: bool = True) -> ShellRecord: ...


def _object(value: object) -> JsonObject:
    return cast(JsonObject, value) if isinstance(value, dict) else {}


def _items(value: object) -> list[object]:
    return cast(list[object], value) if isinstance(value, list) else []


DEFAULT_ARIA2_COMMAND = [
    'aria2c',
    '--enable-rpc',
    '--rpc-listen-all=false',
    '--rpc-allow-origin-all',
]
DEFAULT_ARIA2_LABEL = 'aria2'
DEFAULT_SHELL_CWD = '~/services/aria2'
DEFAULT_LOG_TAIL_LINES = 200
STATE_DIR = te2_app_data_home(APP_ID)
STATE_FILE = STATE_DIR / 'framework_shell.json'


def _framework_url() -> str:
    explicit = str(os.environ.get('TE_FRAMEWORK_URL') or '').strip()
    if explicit:
        return explicit.rstrip('/')
    port = str(os.environ.get('TE_PORT') or '8089').strip() or '8089'
    return f'http://127.0.0.1:{port}'


def _post_serving_readiness() -> None:
    body = {
        'app_id': APP_ID,
        'status': 'ready',
        'phase': 'serving',
        'source': 'aria_downloader_backend',
    }
    endpoint = f"{_framework_url()}/api/apps/{quote(APP_ID, safe='')}/readiness"
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with cast(HttpResponse, urllib.request.urlopen(req, timeout=5)) as resp:
        resp.read()


async def te2_app_backend_serving() -> None:
    try:
        await asyncio.to_thread(_post_serving_readiness)
    except Exception as exc:
        print(f"[aria_downloader] readiness post failed: {exc}", flush=True)


def _rpc_config() -> tuple[str, str | None]:
    """Read RPC endpoint configuration from environment."""
    url = os.getenv('ARIA2_RPC_URL', DEFAULT_RPC_URL)
    secret = os.getenv('ARIA2_RPC_SECRET')
    return url, secret


def call_rpc(method: str, *params: JsonValue) -> RpcResult:
    """Call aria2 JSON-RPC and return (result, error_message)."""
    url, secret = _rpc_config()
    rpc_params: list[object] = list(params)
    if secret:
        rpc_params.insert(0, f'token:{secret}')

    payload = json.dumps({
        'jsonrpc': '2.0',
        'id': 'aria_downloader',
        'method': method,
        'params': rpc_params,
    }).encode('utf-8')

    request_obj = urllib.request.Request(
        url,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with cast(HttpResponse, urllib.request.urlopen(request_obj, timeout=RPC_TIMEOUT_SECONDS)) as response:
            response_body = response.read().decode('utf-8')
    except urllib.error.HTTPError as exc:
        return None, f'aria2 RPC HTTP error {exc.code}: {exc.reason}'
    except urllib.error.URLError as exc:
        reason = getattr(exc, 'reason', None)
        return None, f'Failed to reach aria2 RPC: {reason or exc}'
    except Exception as exc:  # pragma: no cover - defensive safety
        return None, f'Unexpected error contacting aria2 RPC: {exc}'

    try:
        payload_json: object = json.loads(response_body)
    except json.JSONDecodeError:
        return None, 'aria2 RPC returned malformed JSON'

    if isinstance(payload_json, dict) and 'error' in payload_json:
        payload_json = _object(payload_json)
        error_obj = _object(payload_json)['error']
        if isinstance(error_obj, dict):
            error_obj = _object(error_obj)
            code = error_obj.get('code')
            message = error_obj.get('message') or 'aria2 returned an unknown error'
            if code is not None:
                return None, f'aria2 error {code}: {message}'
            return None, f'aria2 error: {message}'
        return None, f'aria2 error: {error_obj}'

    result = None
    if isinstance(payload_json, dict):
        result = _object(payload_json).get('result')
    return result, None


def _coerce_int(value: object) -> int:
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    try:
        return int(str(value), 10)
    except (TypeError, ValueError):
        return 0


def _guess_name(task: JsonObject) -> str:
    bt_info = _object(task.get('bittorrent'))
    info = _object(bt_info.get('info'))
    if isinstance(info, dict):
        name = _object(info).get('name')
        if isinstance(name, str) and name:
            return name

    files = _items(task.get('files'))
    for file_entry in files:
        if not isinstance(file_entry, dict):
            continue
        file_entry = _object(file_entry)
        path = file_entry.get('path')
        if isinstance(path, str) and path:
            return os.path.basename(path)
        uris = file_entry.get('uris')
        if isinstance(uris, list):
            for uri_obj in _items(uris):
                if not isinstance(uri_obj, dict):
                    continue
                uri = _object(uri_obj).get('uri')
                if isinstance(uri, str) and uri:
                    return uri.rsplit('/', 1)[-1]
    gid = task.get('gid', '')
    return gid if isinstance(gid, str) else ''


def _simplify_task(task: JsonObject) -> JsonObject:
    total = _coerce_int(task.get('totalLength'))
    completed = _coerce_int(task.get('completedLength'))
    download_speed = _coerce_int(task.get('downloadSpeed'))
    upload_speed = _coerce_int(task.get('uploadSpeed'))

    progress = 0.0
    if total > 0:
        progress = min(max(completed / total, 0.0), 1.0)

    return {
        'gid': task.get('gid'),
        'status': task.get('status'),
        'name': _guess_name(task),
        'totalLength': total,
        'completedLength': completed,
        'downloadSpeed': download_speed,
        'uploadSpeed': upload_speed,
        'connections': _coerce_int(task.get('connections')),
        'progress': progress,
        'dir': task.get('dir'),
        'errorMessage': task.get('errorMessage'),
        'followedBy': task.get('followedBy'),
        'verifiedLength': _coerce_int(task.get('verifiedLength')),
    }


def _call_and_wrap(method: str, *params: JsonValue) -> RpcResult:
    result, error = call_rpc(method, *params)
    return result, error





# ----------------------------------------------------------------------
# Framework shell helpers


def _load_shell_state() -> JsonObject | None:
    try:
        value: object = json.loads(STATE_FILE.read_text())
        return _object(value) or None
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        return None
    except Exception:
        return None


def _save_shell_state(data: JsonObject) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = STATE_FILE.with_suffix('.tmp')
    with tmp_path.open('w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=2)
    tmp_path.replace(STATE_FILE)


def _clear_shell_state() -> None:
    try:
        STATE_FILE.unlink()
    except FileNotFoundError:
        return
    except Exception:
        return


async def _framework_manager() -> ShellManager:
    return cast(ShellManager, await get_framework_shell_manager())


def _wrap_shell_response(record: JsonObject | None, config: JsonObject | None) -> JsonObject:
    if not record:
        return {'shell': None}
    payload: JsonObject = {'record': record, 'tracked': bool(config)}
    if config:
        payload['config'] = config
    return {'shell': payload}


# ----------------------------------------------------------------------
# API endpoints


def root_status() -> JsonObject:
    return {'ok': True, 'data': {'message': 'Aria Downloader API ready'}}


def status() -> JsonObject:
    version, error = _call_and_wrap('aria2.getVersion')
    if error:
        raise HTTPException(status_code=502, detail=error)

    stats, error = _call_and_wrap('aria2.getGlobalStat')
    if error:
        raise HTTPException(status_code=502, detail=error)

    data = {
        'version': version,
        'globalStat': stats,
    }
    return {'ok': True, 'data': data}


def downloads() -> JsonObject:
    active, error = _call_and_wrap('aria2.tellActive')
    if error:
        raise HTTPException(status_code=502, detail=error)

    waiting, error = _call_and_wrap('aria2.tellWaiting', 0, MAX_RESULT_ITEMS)
    if error:
        raise HTTPException(status_code=502, detail=error)

    stopped, error = _call_and_wrap('aria2.tellStopped', 0, MAX_RESULT_ITEMS)
    if error:
        raise HTTPException(status_code=502, detail=error)

    def _simplify(items: object) -> list[JsonObject]:
        simplified: list[JsonObject] = []
        for task in _items(items):
            if isinstance(task, dict):
                simplified.append(_simplify_task(_object(task)))
        return simplified

    data = {
        'active': _simplify(active),
        'waiting': _simplify(waiting),
        'stopped': _simplify(stopped),
    }
    return {'ok': True, 'data': data}


def add_download(payload: JsonObject) -> JsonObject:
    url = payload.get('url')
    if not url or not isinstance(url, str):
        raise HTTPException(status_code=400, detail='"url" is required')

    options = _object(payload.get('options'))
    directory = payload.get('directory')
    filename = payload.get('filename')

    if directory:
        options = {**options, 'dir': directory}
    if filename:
        options = {**options, 'out': filename}

    params: list[object] = [[url]]
    if options:
        params.append(options)

    result, error = _call_and_wrap('aria2.addUri', *params)
    if error:
        raise HTTPException(status_code=502, detail=error)

    return {'ok': True, 'data': {'gid': result}}


ACTION_METHOD_MAP = {
    'pause': 'aria2.forcePause',
    'resume': 'aria2.unpause',
    'remove': 'aria2.forceRemove',
}

BULK_ACTIONS = {
    'pauseAll': 'aria2.pauseAll',
    'resumeAll': 'aria2.unpauseAll',
    'purge': 'aria2.purgeDownloadResult',
}


def control(payload: JsonObject) -> JsonObject:
    action = payload.get('action')
    if not isinstance(action, str):
        raise HTTPException(400, 'Unsupported action')
    gids = payload.get('gids')

    if action in ACTION_METHOD_MAP:
        if not gids or not isinstance(gids, list):
            raise HTTPException(status_code=400, detail='"gids" array is required for this action')
        processed: list[str] = []
        errors: list[str] = []
        method = ACTION_METHOD_MAP[action]
        for gid in _items(gids):
            if not isinstance(gid, str):
                errors.append('Invalid GID in list')
                continue
            _, error = _call_and_wrap(method, gid)
            if error:
                errors.append(f'{gid}: {error}')
            else:
                processed.append(gid)
        if errors:
            raise HTTPException(status_code=502, detail='; '.join(errors))
        return {'ok': True, 'data': {'processed': processed}}

    if action in BULK_ACTIONS:
        method = BULK_ACTIONS[action]
        result, error = _call_and_wrap(method)
        if error:
            raise HTTPException(status_code=502, detail=error)
        return {'ok': True, 'data': {'result': result}}

    raise HTTPException(status_code=400, detail='Unsupported action')


def settings(payload: JsonObject) -> JsonObject:
    global_opts = _object(payload.get('global'))
    per_download = _object(payload.get('perDownload'))
    gid = payload.get('gid')

    if global_opts:
        _, error = _call_and_wrap('aria2.changeGlobalOption', global_opts)
        if error:
            raise HTTPException(status_code=502, detail=error)

    if per_download:
        if not gid or not isinstance(gid, str):
            raise HTTPException(status_code=400, detail='A valid "gid" is required for per-download settings')
        _, error = _call_and_wrap('aria2.changeOption', gid, per_download)
        if error:
            raise HTTPException(status_code=502, detail=error)

    if not global_opts and not per_download:
        raise HTTPException(status_code=400, detail='No settings provided')

    return {'ok': True, 'data': {'updated': True}}


# ----------------------------------------------------------------------
# Framework shell endpoints


def _sanitize_env(env: JsonObject) -> tuple[dict[str, str] | None, str | None]:
    sanitized: dict[str, str] = {}
    for key, value in env.items():
        if not isinstance(key, str):
            return None, 'Environment keys must be strings'
        sanitized[key] = str(value)
    return sanitized, None


async def list_framework_shells() -> JsonObject:
    mgr = await _framework_manager()
    records = await mgr.list_shells()
    shells = []
    for record in records:
        shells.append(await mgr.describe(record))
    return {'ok': True, 'data': {'shells': shells}}


async def get_tracked_shell(logs: bool = False, tail: int = DEFAULT_LOG_TAIL_LINES) -> JsonObject:
    state = _load_shell_state()
    if not state or 'id' not in state:
        return {'ok': True, 'data': {'shell': None}}

    include_logs = logs
    shell_id = str(state.get('id'))
    mgr = await _framework_manager()
    record = await mgr.get_shell(shell_id)
    if not record:
        _clear_shell_state()
        return {'ok': True, 'data': {'shell': None}}
    tail_lines = tail
    described = await mgr.describe(record, include_logs=include_logs, tail_lines=tail_lines if include_logs else 0)
    return {'ok': True, 'data': _wrap_shell_response(described, state)}


async def spawn_shell(payload: JsonObject) -> JsonObject:
    force = bool(payload.get('force'))
    current_state = _load_shell_state()
    if current_state and not force:
        raise HTTPException(status_code=409, detail='An aria2 framework shell is already tracked. Stop or remove it before spawning a new one.')
    mgr = await _framework_manager()
    if current_state and force:
        shell_id = current_state.get('id')
        if shell_id:
            try:
                await mgr.remove_shell(str(shell_id), force=True)
            except Exception:
                pass
        _clear_shell_state()

    if 'command' in payload:
        command = payload.get('command')
        if isinstance(command, str):
            command = [command]
        if not isinstance(command, list) or not all(isinstance(part, str) for part in command):
            raise HTTPException(status_code=400, detail='"command" must be a list of strings or a string')
    else:
        binary = payload.get('binary', 'aria2c')
        if not isinstance(binary, str) or not binary.strip():
            raise HTTPException(status_code=400, detail='"binary" must be a non-empty string')
        extra_args = payload.get('args') or []
        if not isinstance(extra_args, list) or not all(isinstance(arg, str) for arg in extra_args):
            raise HTTPException(status_code=400, detail='"args" must be a list of strings')
        command = [binary, *DEFAULT_ARIA2_COMMAND[1:], *extra_args]
        command[0] = binary
        secret = payload.get('secret')
        if isinstance(secret, str) and secret:
            command.append(f'--rpc-secret={secret}')

    cwd = payload.get('cwd') or payload.get('directory') or DEFAULT_SHELL_CWD
    if not isinstance(cwd, str):
        raise HTTPException(status_code=400, detail='"cwd" must be a string')
    env_payload = payload.get('env') or {}
    if not isinstance(env_payload, dict):
        raise HTTPException(status_code=400, detail='"env" must be an object')
    env, env_error = _sanitize_env(_object(env_payload))
    if env_error:
        raise HTTPException(status_code=400, detail=env_error)
    raw_label = payload.get('label')
    label = raw_label if isinstance(raw_label, str) else DEFAULT_ARIA2_LABEL
    autostart = bool(payload.get('autostart', False))

    try:
        record = await mgr.spawn_shell(
            cast(list[str], command),
            cwd=cwd,
            env=env or {},
            label=label,
            subgroups=["aria_downloader", "aria2"],
            # Explicit Start must launch now. The saved compatibility field is
            # not the manager's launch-now switch (False creates only a record).
            autostart=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Failed to spawn shell: {exc}')

    described = await mgr.describe(record)
    shell_config: JsonObject = {
        'id': record.id,
        'label': label,
        'command': command,
        'cwd': cwd,
        'autostart': autostart,
        'env': env or {},
        'saved_at': time.time(),
    }
    if record.created_at is not None:
        shell_config['created_at'] = record.created_at
    _save_shell_state(shell_config)

    return {'ok': True, 'data': _wrap_shell_response(described, shell_config)}


async def shell_action(payload: JsonObject) -> JsonObject:
    raw_action = payload.get('action')
    action = raw_action.strip().lower() if isinstance(raw_action, str) else ''
    if not action:
        raise HTTPException(status_code=400, detail='"action" is required')

    if action == 'adopt':
        shell_id = payload.get('id')
        if not isinstance(shell_id, str) or not shell_id:
            raise HTTPException(status_code=400, detail='"id" is required when adopting a shell')
        mgr = await _framework_manager()
        record = await mgr.get_shell(shell_id)
        if not record:
            raise HTTPException(status_code=404, detail='Shell not found')
        described = await mgr.describe(record)
        config = {
            'id': shell_id,
            'label': described.get('label') or DEFAULT_ARIA2_LABEL,
            'command': described.get('command'),
            'cwd': described.get('cwd'),
            'autostart': bool(described.get('autostart', False)),
            'saved_at': time.time(),
        }
        _save_shell_state(config)
        return {'ok': True, 'data': _wrap_shell_response(described, config)}

    state = _load_shell_state()
    if action == 'remove':
        if not state or 'id' not in state:
            _clear_shell_state()
            return {'ok': True, 'data': {'shell': None}}
        mgr = await _framework_manager()
        try:
            await mgr.remove_shell(str(state['id']), force=bool(payload.get('force')))
        except KeyError:
            pass
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f'Failed to remove shell: {exc}')
        _clear_shell_state()
        return {'ok': True, 'data': {'shell': None}}

    if not state or 'id' not in state:
        raise HTTPException(status_code=404, detail='No aria2 framework shell is currently tracked.')

    shell_id = str(state['id'])
    mgr = await _framework_manager()
    try:
        if action in {'stop', 'terminate'}:
            await mgr.terminate_shell(shell_id, force=False)
            record = await mgr.get_shell(shell_id)
        elif action in {'kill', 'force'}:
            await mgr.terminate_shell(shell_id, force=True)
            record = await mgr.get_shell(shell_id)
        elif action == 'restart':
            command = _items(state.get('command'))
            if not command or not all(isinstance(part, str) for part in command):
                raise HTTPException(400, 'Tracked shell has no restartable command')
            await mgr.terminate_shell(shell_id, force=False)
            record = await mgr.spawn_shell(cast(list[str], command),
                cwd=str(state.get('cwd') or DEFAULT_SHELL_CWD),
                env={key: str(value) for key, value in _object(state.get('env')).items()},
                label=str(state.get('label') or DEFAULT_ARIA2_LABEL),
                subgroups=['aria_downloader', 'aria2'],
                autostart=True)
            state['id'] = record.id
        else:
            raise HTTPException(status_code=400, detail=f'Unsupported action "{action}"')
    except HTTPException:
        raise
    except KeyError:
        _clear_shell_state()
        raise HTTPException(status_code=404, detail='Shell not found')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Shell action failed: {exc}')

    if record is None:
        _clear_shell_state()
        return {'ok': True, 'data': {'shell': None}}

    if isinstance(state, dict):
        if action == 'restart' and hasattr(record, 'created_at') and record.created_at is not None:
            state['created_at'] = record.created_at
        state['last_action'] = action
        state['updated_at'] = time.time()
        _save_shell_state(state)

    described = await mgr.describe(record)
    return {'ok': True, 'data': _wrap_shell_response(described, state)}


from .http_app import AriaDownloaderASGI

TE2_ASGI_APP = AriaDownloaderASGI()
