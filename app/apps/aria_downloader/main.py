"""Flask blueprint that proxies Aria Downloader app requests to aria2 JSON-RPC."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterable, List, Optional, Tuple
import urllib.error
import urllib.request

from flask import Blueprint, jsonify, request

aria_downloader_bp = Blueprint('aria_downloader', __name__)

DEFAULT_RPC_URL = 'http://127.0.0.1:6800/jsonrpc'
MAX_RESULT_ITEMS = 200
RPC_TIMEOUT_SECONDS = 10

JsonValue = Any
RpcResult = Tuple[Optional[JsonValue], Optional[str]]


def _rpc_config() -> Tuple[str, Optional[str]]:
    """Read RPC endpoint configuration from environment."""
    url = os.getenv('ARIA2_RPC_URL', DEFAULT_RPC_URL)
    secret = os.getenv('ARIA2_RPC_SECRET')
    return url, secret


def call_rpc(method: str, *params: JsonValue) -> RpcResult:
    """Call aria2 JSON-RPC and return (result, error_message)."""
    url, secret = _rpc_config()
    rpc_params: List[JsonValue] = list(params)
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
        with urllib.request.urlopen(request_obj, timeout=RPC_TIMEOUT_SECONDS) as response:
            response_body = response.read().decode('utf-8')
    except urllib.error.HTTPError as exc:
        return None, f'aria2 RPC HTTP error {exc.code}: {exc.reason}'
    except urllib.error.URLError as exc:
        reason = getattr(exc, 'reason', None)
        return None, f'Failed to reach aria2 RPC: {reason or exc}'
    except Exception as exc:  # pragma: no cover - defensive safety
        return None, f'Unexpected error contacting aria2 RPC: {exc}'

    try:
        payload_json = json.loads(response_body)
    except json.JSONDecodeError:
        return None, 'aria2 RPC returned malformed JSON'

    if isinstance(payload_json, dict) and 'error' in payload_json:
        error_obj = payload_json['error']
        if isinstance(error_obj, dict):
            code = error_obj.get('code')
            message = error_obj.get('message') or 'aria2 returned an unknown error'
            if code is not None:
                return None, f'aria2 error {code}: {message}'
            return None, f'aria2 error: {message}'
        return None, f'aria2 error: {error_obj}'

    result = None
    if isinstance(payload_json, dict):
        result = payload_json.get('result')
    return result, None


def _coerce_int(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    try:
        return int(str(value), 10)
    except (TypeError, ValueError):
        return 0


def _guess_name(task: Dict[str, Any]) -> str:
    bt_info = task.get('bittorrent') or {}
    info = bt_info.get('info') if isinstance(bt_info, dict) else None
    if isinstance(info, dict):
        name = info.get('name')
        if isinstance(name, str) and name:
            return name

    files = task.get('files') or []
    for file_entry in files:
        if not isinstance(file_entry, dict):
            continue
        path = file_entry.get('path')
        if isinstance(path, str) and path:
            return os.path.basename(path)
        uris = file_entry.get('uris')
        if isinstance(uris, list):
            for uri_obj in uris:
                if not isinstance(uri_obj, dict):
                    continue
                uri = uri_obj.get('uri')
                if isinstance(uri, str) and uri:
                    return uri.rsplit('/', 1)[-1]
    return task.get('gid', '')


def _simplify_task(task: Dict[str, Any]) -> Dict[str, Any]:
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


def _call_and_wrap(method: str, *params: JsonValue) -> Tuple[Optional[JsonValue], Optional[str]]:
    result, error = call_rpc(method, *params)
    return result, error


def _json_success(data: Any, status_code: int = 200):
    return jsonify({'ok': True, 'data': data}), status_code


def _json_error(message: str, status_code: int = 500):
    return jsonify({'ok': False, 'error': message}), status_code


@aria_downloader_bp.get('/')
def root_status():
    return _json_success({'message': 'Aria Downloader API ready'})


@aria_downloader_bp.get('/status')
def status():
    version, error = _call_and_wrap('aria2.getVersion')
    if error:
        return _json_error(error, 502)

    stats, error = _call_and_wrap('aria2.getGlobalStat')
    if error:
        return _json_error(error, 502)

    data = {
        'version': version,
        'globalStat': stats,
    }
    return _json_success(data)


@aria_downloader_bp.get('/downloads')
def downloads():
    active, error = _call_and_wrap('aria2.tellActive')
    if error:
        return _json_error(error, 502)

    waiting, error = _call_and_wrap('aria2.tellWaiting', 0, MAX_RESULT_ITEMS)
    if error:
        return _json_error(error, 502)

    stopped, error = _call_and_wrap('aria2.tellStopped', 0, MAX_RESULT_ITEMS)
    if error:
        return _json_error(error, 502)

    def _simplify(items: Iterable[Any]) -> List[Dict[str, Any]]:
        simplified: List[Dict[str, Any]] = []
        for task in items or []:
            if isinstance(task, dict):
                simplified.append(_simplify_task(task))
        return simplified

    data = {
        'active': _simplify(active),
        'waiting': _simplify(waiting),
        'stopped': _simplify(stopped),
    }
    return _json_success(data)


@aria_downloader_bp.post('/add')
def add_download():
    payload = request.get_json(silent=True) or {}
    url = payload.get('url')
    if not url or not isinstance(url, str):
        return _json_error('"url" is required', 400)

    options = payload.get('options') if isinstance(payload.get('options'), dict) else {}
    directory = payload.get('directory')
    filename = payload.get('filename')

    if directory:
        options = {**options, 'dir': directory}
    if filename:
        options = {**options, 'out': filename}

    params: List[Any] = [[url]]
    if options:
        params.append(options)

    result, error = _call_and_wrap('aria2.addUri', *params)
    if error:
        return _json_error(error, 502)

    return _json_success({'gid': result})


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


@aria_downloader_bp.post('/control')
def control():
    payload = request.get_json(silent=True) or {}
    action = payload.get('action')
    gids = payload.get('gids')

    if action in ACTION_METHOD_MAP:
        if not gids or not isinstance(gids, list):
            return _json_error('"gids" array is required for this action', 400)
        processed: List[str] = []
        errors: List[str] = []
        method = ACTION_METHOD_MAP[action]
        for gid in gids:
            if not isinstance(gid, str):
                errors.append('Invalid GID in list')
                continue
            _, error = _call_and_wrap(method, gid)
            if error:
                errors.append(f'{gid}: {error}')
            else:
                processed.append(gid)
        if errors:
            return _json_error('; '.join(errors), 502)
        return _json_success({'processed': processed})

    if action in BULK_ACTIONS:
        method = BULK_ACTIONS[action]
        result, error = _call_and_wrap(method)
        if error:
            return _json_error(error, 502)
        return _json_success({'result': result})

    return _json_error('Unsupported action', 400)


@aria_downloader_bp.post('/settings')
def settings():
    payload = request.get_json(silent=True) or {}
    global_opts = payload.get('global') if isinstance(payload.get('global'), dict) else None
    per_download = payload.get('perDownload') if isinstance(payload.get('perDownload'), dict) else None
    gid = payload.get('gid')

    if global_opts:
        _, error = _call_and_wrap('aria2.changeGlobalOption', global_opts)
        if error:
            return _json_error(error, 502)

    if per_download:
        if not gid or not isinstance(gid, str):
            return _json_error('A valid "gid" is required for per-download settings', 400)
        _, error = _call_and_wrap('aria2.changeOption', gid, per_download)
        if error:
            return _json_error(error, 502)

    if not global_opts and not per_download:
        return _json_error('No settings provided', 400)

    return _json_success({'updated': True})
