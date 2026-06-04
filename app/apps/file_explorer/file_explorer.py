from __future__ import annotations

import anyio
import asyncio
import functools
import grp
import json
import os
import pwd
import shutil
import stat
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Tuple
from urllib import request as urllib_request
from urllib.parse import quote, urlencode

import socketio

from fastapi import APIRouter, Request, HTTPException, Body, Query
from fastapi.responses import JSONResponse, FileResponse

from app.libs.jobs import JobCancelled, register_job_handler

file_explorer_bp = APIRouter()

HOME_DIR = Path.home()
APP_ID = str(os.environ.get('TE_APP_ID') or 'file_explorer').strip() or 'file_explorer'
APP_BASE_URL = f'/app/{APP_ID}'
SIDEBAR_TOKEN_ID = str(os.environ.get('TE_SIDEBAR_TOKEN_ID') or APP_ID).strip() or APP_ID
SIDEBAR_IPC_NAMESPACE = '/sidebar_ipc'
SIDEBAR_IPC_SOCKET_PATH = '/ui_ipc_ws/socket.io'
SIDEBAR_IPC_RPC_EVENT = 'rpc'


def _framework_url() -> str:
    explicit = str(os.environ.get('TE_FRAMEWORK_URL') or '').strip()
    if explicit:
        return explicit.rstrip('/')
    port = str(os.environ.get('TE_PORT') or '8089').strip() or '8089'
    return f'http://127.0.0.1:{port}'


def _post_framework_readiness_sync(payload: Dict[str, Any]) -> None:
    body = dict(payload)
    body.setdefault('app_id', APP_ID)
    body.setdefault('status', 'ready')
    endpoint = f"{_framework_url()}/api/apps/{quote(APP_ID, safe='')}/readiness"
    req = urllib_request.Request(
        endpoint,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib_request.urlopen(req, timeout=5) as resp:
        resp.read()


async def _post_framework_readiness(payload: Dict[str, Any]) -> None:
    await asyncio.to_thread(_post_framework_readiness_sync, payload)


async def te2_app_backend_serving() -> None:
    try:
        await _post_framework_readiness({
            'app_id': APP_ID,
            'status': 'ready',
            'phase': 'serving',
            'source': 'file_explorer_backend',
        })
    except Exception as exc:
        print(f"[file_explorer] readiness post failed: {exc}", flush=True)


def _sidebar_backend_client_id() -> str:
    return f'{APP_ID}:backend:{os.getpid()}'


async def _call_sidebar_rpc(method: str, params: Dict[str, Any] | None = None, *, timeout: float = 5.0) -> Dict[str, Any]:
    safe_method = str(method or '').strip()
    if not safe_method:
        raise ValueError('method is required')
    client = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
    timeout_seconds = max(1, int(timeout))
    try:
        await client.connect(
            _framework_url(),
            namespaces=[SIDEBAR_IPC_NAMESPACE],
            socketio_path=SIDEBAR_IPC_SOCKET_PATH.lstrip('/'),
            transports=['websocket', 'polling'],
        )
        register = {
            'jsonrpc': '2.0',
            'id': f'{APP_ID}:register:{int(asyncio.get_running_loop().time() * 1000)}',
            'method': 'sidebar.register',
            'params': {
                'role': 'iframe',
                'app': APP_ID,
                'client_id': _sidebar_backend_client_id(),
                'capabilities': ['sidebar.windows'],
            },
        }
        await client.call(SIDEBAR_IPC_RPC_EVENT, register, namespace=SIDEBAR_IPC_NAMESPACE, timeout=timeout_seconds)
        request = {
            'jsonrpc': '2.0',
            'id': f'{APP_ID}:{int(asyncio.get_running_loop().time() * 1000)}',
            'method': safe_method,
            'params': params or {},
        }
        response = await client.call(
            SIDEBAR_IPC_RPC_EVENT,
            request,
            namespace=SIDEBAR_IPC_NAMESPACE,
            timeout=timeout_seconds,
        )
        if not isinstance(response, dict):
            raise RuntimeError('sidebar RPC returned a non-object response')
        error = response.get('error')
        if isinstance(error, dict):
            raise RuntimeError(str(error.get('message') or error))
        result = response.get('result')
        return result if isinstance(result, dict) else {'result': result}
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


def _resolve_sidebar_directory(path_value: object) -> Path:
    raw = str(path_value or '').strip() or str(HOME_DIR)
    try:
        path = Path(os.path.abspath(os.path.expanduser(raw))).resolve()
    except Exception as exc:
        raise HTTPException(status_code=400, detail='invalid path') from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail='directory not found')
    if not path.is_dir():
        raise HTTPException(status_code=400, detail='not a directory')
    return path


def _canonical_sidebar_url(host_id: str, token_id: str, path_value: str, delay_ms: int, console_worker_id: str = '') -> str:
    query = {
        'embed': '1',
        'te2_host_id': host_id,
        'path': path_value,
    }
    if token_id:
        query['te2_token_id'] = token_id
    if console_worker_id:
        query['te2_console_worker_id'] = console_worker_id
    if delay_ms:
        query['te2_readiness_delay_ms'] = str(delay_ms)
    return f"{APP_BASE_URL}?{urlencode(query)}"


def _clamp_delay_ms(value: object) -> int:
    try:
        delay = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(delay, 60_000))


async def _post_readiness_after_delay(payload: Dict[str, Any]) -> None:
    delay_ms = _clamp_delay_ms(payload.get('readiness_delay_ms') or payload.get('te2_readiness_delay_ms'))
    if delay_ms:
        await asyncio.sleep(delay_ms / 1000)
    readiness_payload = {
        'status': 'ready',
        'app_id': APP_ID,
        'phase': 'state_url_ready',
        'host_id': str(payload.get('host_id') or payload.get('hostId') or '').strip(),
        'token_id': str(payload.get('token_id') or payload.get('tokenId') or '').strip(),
        'console_worker_id': str(payload.get('console_worker_id') or payload.get('consoleWorkerId') or '').strip(),
        'url': str(payload.get('url') or '').strip(),
        'path': str(payload.get('path') or '').strip(),
        'source': 'file_explorer_backend',
        'details': {
            'state_kind': 'path',
            'readiness_delay_ms': delay_ms,
        },
    }
    try:
        await _post_framework_readiness(readiness_payload)
    except Exception as exc:
        print(f"[file_explorer] readiness post failed: {exc}", flush=True)


def _scandir_entries(path: Path, show_hidden: bool) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    with os.scandir(path) as iterator:
        for entry in iterator:
            name = entry.name
            if not show_hidden and name.startswith('.'):
                continue
            try:
                if entry.is_dir(follow_symlinks=False):
                    entry_type = 'directory'
                elif entry.is_symlink():
                    entry_type = 'symlink'
                else:
                    entry_type = 'file'
            except PermissionError:
                entry_type = 'unknown'
            size = None
            mtime = None
            mode = None
            uid = None
            gid = None
            owner = None
            group = None
            try:
                stat_info = entry.stat(follow_symlinks=False)
                size = stat_info.st_size
                mtime = int(stat_info.st_mtime)
                mode = stat_info.st_mode
                uid = stat_info.st_uid
                gid = stat_info.st_gid
                # Try to get owner and group names
                try:
                    owner = pwd.getpwuid(uid).pw_name
                except (KeyError, AttributeError):
                    owner = str(uid)
                try:
                    group = grp.getgrgid(gid).gr_name
                except (KeyError, AttributeError):
                    group = str(gid)
            except Exception:
                pass
            entries.append(
                {
                    'name': name,
                    'type': entry_type,
                    'path': os.path.join(str(path), name),
                    'size': size,
                    'mtime': mtime,
                    'mode': mode,
                    'owner': owner,
                    'group': group,
                }
            )
    return entries


def _scandir_with_sudo(path: Path, show_hidden: bool) -> List[Dict[str, Any]]:
    script = (
        "import json, os, sys, pwd, grp\n"
        f"path = {json.dumps(str(path))}\n"
        f"show_hidden = {repr(bool(show_hidden))}\n"
        "entries = []\n"
        "try:\n"
        "    with os.scandir(path) as iterator:\n"
        "        for entry in iterator:\n"
        "            name = entry.name\n"
        "            if not show_hidden and name.startswith('.'):\n"
        "                continue\n"
        "            try:\n"
        "                if entry.is_dir(follow_symlinks=False):\n"
        "                    entry_type = 'directory'\n"
        "                elif entry.is_symlink():\n"
        "                    entry_type = 'symlink'\n"
        "                else:\n"
        "                    entry_type = 'file'\n"
        "            except PermissionError:\n"
        "                entry_type = 'unknown'\n"
        "            size = None\n"
        "            mtime = None\n"
        "            mode = None\n"
        "            owner = None\n"
        "            group = None\n"
        "            try:\n"
        "                stat_info = entry.stat(follow_symlinks=False)\n"
        "                size = stat_info.st_size\n"
        "                mtime = int(stat_info.st_mtime)\n"
        "                mode = stat_info.st_mode\n"
        "                uid = stat_info.st_uid\n"
        "                gid = stat_info.st_gid\n"
        "                try:\n"
        "                    owner = pwd.getpwuid(uid).pw_name\n"
        "                except:\n"
        "                    owner = str(uid)\n"
        "                try:\n"
        "                    group = grp.getgrgid(gid).gr_name\n"
        "                except:\n"
        "                    group = str(gid)\n"
        "            except Exception:\n"
        "                pass\n"
        "            entries.append({\n"
        "                'name': name,\n"
        "                'type': entry_type,\n"
        "                'path': os.path.join(path, name),\n"
        "                'size': size,\n"
        "                'mtime': mtime,\n"
        "                'mode': mode,\n"
        "                'owner': owner,\n"
        "                'group': group\n"
        "            })\n"
        "    json.dump(entries, sys.stdout)\n"
        "except FileNotFoundError:\n"
        "    sys.stderr.write('Directory not found')\n"
        "    sys.exit(44)\n"
        "except PermissionError as exc:\n"
        "    sys.stderr.write(str(exc) or 'Permission denied')\n"
        "    sys.exit(13)\n"
        "except Exception as exc:\n"
        "    sys.stderr.write(str(exc))\n"
        "    sys.exit(99)\n"
    )
    result = subprocess.run(
        ['sudo', '-n', 'python3', '-c', script],
        capture_output=True,
        text=True,
    )
    if result.returncode == 44:
        raise FileNotFoundError('Directory not found')
    if result.returncode == 13:
        message = result.stderr.strip() or 'Permission denied'
        raise PermissionError(message)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or 'Failed to list directory'
        raise RuntimeError(message)
    try:
        return json.loads(result.stdout or '[]')
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise RuntimeError(f'Failed to parse sudo output: {exc}') from exc


def _run_sudo(argv: List[str]) -> None:
    result = subprocess.run(['sudo', '-n', *argv], capture_output=True, text=True)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or 'Permission denied'
        raise PermissionError(message)


def _mode_to_permissions(mode: int) -> Dict[str, Dict[str, bool]]:
    value = stat.S_IMODE(mode)
    def has(flag: int) -> bool:
        return (value & flag) == flag

    return {
        'owner': {
            'read': has(stat.S_IRUSR),
            'write': has(stat.S_IWUSR),
            'exec': has(stat.S_IXUSR),
        },
        'group': {
            'read': has(stat.S_IRGRP),
            'write': has(stat.S_IWGRP),
            'exec': has(stat.S_IXGRP),
        },
        'others': {
            'read': has(stat.S_IROTH),
            'write': has(stat.S_IWOTH),
            'exec': has(stat.S_IXOTH),
        },
    }


def _chmod_recursive_local(target: str, mode_value: int) -> None:
    if os.path.islink(target):
        os.chmod(target, mode_value)
        return
    for root, dirs, files in os.walk(target):
        for name in dirs:
            path = os.path.join(root, name)
            if os.path.islink(path):
                continue
            os.chmod(path, mode_value)
        for name in files:
            path = os.path.join(root, name)
            if os.path.islink(path):
                continue
            os.chmod(path, mode_value)
    os.chmod(target, mode_value)


@file_explorer_bp.get('/list')
async def list_directory(path: str = Query(str(HOME_DIR)), hidden: bool = Query(False)):
    """
    List directory contents.

    Example:
        GET /api/app/file_explorer/list?path=~
    """
    abs_path = Path(os.path.abspath(os.path.expanduser(path)))
    try:
        entries = await anyio.to_thread.run_sync(_scandir_entries, abs_path, hidden)
    except PermissionError:
        try:
            entries = await anyio.to_thread.run_sync(_scandir_with_sudo, abs_path, hidden)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail='Directory not found')
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc) or 'Permission denied')
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Directory not found')
    except NotADirectoryError:
        raise HTTPException(status_code=400, detail='Not a directory')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    entries.sort(key=lambda item: (item.get('type') != 'directory', (item.get('name') or '').lower()))
    return {"ok": True, "data": {"entries": entries, "path": str(abs_path)}}


@file_explorer_bp.post('/sidebar/window/open_url')
@file_explorer_bp.post('/sidebar/window/state')
async def publish_sidebar_window_url(payload: Dict[str, Any] | None = Body(None)):
    """
    Reference backend bridge for stateful sidebar app windows.
    The frontend publishes the current path state here after loading a directory;
    the backend records it over typed /sidebar_ipc RPC. The live iframe is not
    reloaded for ordinary state changes.
    """
    body = payload if isinstance(payload, dict) else {}
    host_id = str(body.get('host_id') or body.get('hostId') or '').strip()
    if not host_id:
        raise HTTPException(status_code=400, detail='host_id is required')
    directory = _resolve_sidebar_directory(body.get('path'))
    path_value = str(directory)
    delay_ms = _clamp_delay_ms(body.get('readiness_delay_ms') or body.get('te2_readiness_delay_ms'))
    console_worker_id = str(body.get('console_worker_id') or body.get('consoleWorkerId') or '').strip()
    token_id = str(body.get('token_id') or body.get('tokenId') or SIDEBAR_TOKEN_ID).strip()
    url_value = _canonical_sidebar_url(host_id, token_id, path_value, delay_ms, console_worker_id)
    params: Dict[str, Any] = {
        'lane': {
            'app_id': APP_ID,
            'base_url': APP_BASE_URL,
        },
        'app_id': APP_ID,
        'appId': APP_ID,
        'base_url': APP_BASE_URL,
        'baseUrl': APP_BASE_URL,
        'host_id': host_id,
        'hostId': host_id,
        'token_id': token_id,
        'tokenId': token_id,
        'console_worker_id': console_worker_id,
        'consoleWorkerId': console_worker_id,
        'state_kind': 'path',
        'stateKind': 'path',
        'path': path_value,
        'query_state': {'path': path_value},
        'queryState': {'path': path_value},
        'url': url_value,
        'label': path_value or 'File Explorer',
        'load': 'eager',
        'activate': body.get('activate', False),
        'source': 'file_explorer_backend',
    }
    try:
        rpc_result = await _call_sidebar_rpc(
            'sidebar.window.state.update',
            params,
            timeout=5,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'sidebar IPC update failed: {exc}') from exc

    readiness_payload = {**params, 'readiness_delay_ms': delay_ms}
    asyncio.create_task(_post_readiness_after_delay(readiness_payload))
    return {"ok": True, "data": {"queued_readiness": True, "sidebar": rpc_result}}


@file_explorer_bp.get('/download')
async def download_file(path: str = Query(...)):
    """
    Download a file.

    Example:
        GET /api/app/file_explorer/download?path=/tmp/test.txt
    """
    if not path:
        raise HTTPException(status_code=400, detail='Path is required')
    
    abs_path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail='File not found')
    
    # Check permissions (basic check, though FileResponse handles reading)
    if not os.access(abs_path, os.R_OK):
        raise HTTPException(status_code=403, detail='Permission denied')

    return FileResponse(abs_path, filename=os.path.basename(abs_path))


@file_explorer_bp.post('/mkdir')
async def make_directory(data: dict = Body(...)):
    """
    Create a directory.

    Example:
        POST /api/app/file_explorer/mkdir
        {"path":"/tmp","name":"test_dir"}
    """
    base = os.path.abspath(os.path.expanduser(data.get('path') or ''))
    name = (data.get('name') or '').strip()
    if not name or '/' in name or name in {'.', '..'}:
        raise HTTPException(status_code=400, detail='Invalid directory name')
    if not os.path.isdir(base):
        raise HTTPException(status_code=400, detail='Base path is not a directory')
    target = os.path.abspath(os.path.join(base, name))
    try:
        await anyio.to_thread.run_sync(functools.partial(os.makedirs, target, exist_ok=False))
    except FileExistsError:
        raise HTTPException(status_code=400, detail='A file or folder with that name already exists')
    except PermissionError:
        try:
            await anyio.to_thread.run_sync(_run_sudo, ['mkdir', '-p', target])
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc) or 'Permission denied')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True, "data": {'created': os.path.basename(target)}}


@file_explorer_bp.post('/delete')
async def delete_path(data: dict = Body(...)):
    target = data.get('path')
    if not target:
        raise HTTPException(status_code=400, detail='Path is required')
    abs_target = os.path.abspath(os.path.expanduser(target))
    if not os.path.exists(abs_target):
        raise HTTPException(status_code=404, detail='File not found')
    try:
        if os.path.isdir(abs_target) and not os.path.islink(abs_target):
            await anyio.to_thread.run_sync(shutil.rmtree, abs_target)
        else:
            await anyio.to_thread.run_sync(os.remove, abs_target)
    except PermissionError:
        try:
            await anyio.to_thread.run_sync(_run_sudo, ['rm', '-rf', abs_target])
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc) or 'Permission denied')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True, "data": {'deleted': abs_target}}


@file_explorer_bp.post('/rename')
async def rename_path(data: dict = Body(...)):
    source = data.get('path')
    new_name = (data.get('name') or '').strip()
    if not source or not new_name:
        raise HTTPException(status_code=400, detail='Source path and new name are required')
    src_abs = os.path.abspath(os.path.expanduser(source))
    dest_dir = os.path.dirname(src_abs)
    dest_abs = os.path.join(dest_dir, new_name)
    if os.path.exists(dest_abs):
        raise HTTPException(status_code=400, detail='A file or folder with that name already exists')
    try:
        await anyio.to_thread.run_sync(os.replace, src_abs, dest_abs)
    except PermissionError:
        try:
            await anyio.to_thread.run_sync(_run_sudo, ['mv', src_abs, dest_abs])
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc) or 'Permission denied')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True, "data": {'renamed': os.path.basename(src_abs), 'to': os.path.basename(dest_abs)}}


@file_explorer_bp.post('/copy')
async def copy_path(data: dict = Body(...)):
    source = data.get('source')
    dest = data.get('dest')
    if not source or not dest:
        raise HTTPException(status_code=400, detail='Source and destination are required')
    src_abs = os.path.abspath(os.path.expanduser(source))
    dest_abs = os.path.abspath(os.path.expanduser(dest))
    
    # Check if dest is a directory or a file path
    # If dest exists and is a directory, join with source basename
    # Otherwise, use dest as the full target path (from file picker saveFile)
    if os.path.exists(dest_abs) and os.path.isdir(dest_abs):
        # Destination is a directory, append source filename
        dest_abs = os.path.join(dest_abs, os.path.basename(src_abs))
        if os.path.exists(dest_abs):
            raise HTTPException(status_code=400, detail='Target already exists at destination')
    
    # Ensure parent directory exists
    dest_dir = os.path.dirname(dest_abs)
    if not os.path.exists(dest_dir):
        raise HTTPException(status_code=400, detail='Destination directory does not exist')
    
    try:
        if os.path.isdir(src_abs) and not os.path.islink(src_abs):
            await anyio.to_thread.run_sync(shutil.copytree, src_abs, dest_abs)
        else:
            await anyio.to_thread.run_sync(shutil.copy2, src_abs, dest_abs)
    except PermissionError:
        try:
            await anyio.to_thread.run_sync(_run_sudo, ['cp', '-r', src_abs, dest_abs])
        except PermissionError as exc:
            raise HTTPException(status_code=500, detail=str(exc) or 'Copy failed')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True, "data": {'copied': src_abs, 'to': dest_abs}}


@file_explorer_bp.post('/move')
async def move_path(data: dict = Body(...)):
    source = data.get('source')
    dest_dir = data.get('dest')
    if not source or not dest_dir:
        raise HTTPException(status_code=400, detail='Source and destination are required')
    src_abs = os.path.abspath(os.path.expanduser(source))
    dest_dir_abs = os.path.abspath(os.path.expanduser(dest_dir))
    if not os.path.isdir(dest_dir_abs):
        raise HTTPException(status_code=400, detail='Destination is not a directory')
    dest_abs = os.path.join(dest_dir_abs, os.path.basename(src_abs))
    if os.path.exists(dest_abs):
        raise HTTPException(status_code=400, detail='Target already exists at destination')
    try:
        await anyio.to_thread.run_sync(os.replace, src_abs, dest_abs)
    except PermissionError:
        try:
            await anyio.to_thread.run_sync(_run_sudo, ['mv', src_abs, dest_abs])
        except PermissionError as exc:
            raise HTTPException(status_code=500, detail=str(exc) or 'Move failed')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True, "data": {'moved': src_abs, 'to': dest_abs}}


@file_explorer_bp.get('/resolve_symlink')
async def resolve_symlink(path: str = Query(...)):
    """Resolve a symlink to its target path."""
    if not path:
        raise HTTPException(status_code=400, detail='Path is required')
    
    abs_path = os.path.abspath(os.path.expanduser(path))
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail='Path does not exist')
    
    if not os.path.islink(abs_path):
        # Not a symlink, return the path itself
        return {"ok": True, "data": {'path': abs_path, 'target': abs_path, 'is_symlink': False}}
    
    try:
        # Resolve the symlink
        target = await anyio.to_thread.run_sync(os.readlink, abs_path)
        # If target is relative, make it absolute based on symlink's directory
        if not os.path.isabs(target):
            symlink_dir = os.path.dirname(abs_path)
            target = os.path.abspath(os.path.join(symlink_dir, target))
        
        # Check if target exists and what type it is
        target_exists = await anyio.to_thread.run_sync(os.path.exists, target)
        target_type = 'unknown'
        if target_exists:
            if await anyio.to_thread.run_sync(os.path.isdir, target):
                target_type = 'directory'
            elif await anyio.to_thread.run_sync(os.path.isfile, target):
                target_type = 'file'
            elif await anyio.to_thread.run_sync(os.path.islink, target):
                target_type = 'symlink'  # Target is itself a symlink
        
        return {"ok": True, "data": {
            'path': abs_path,
            'target': target,
            'is_symlink': True,
            'target_exists': target_exists,
            'target_type': target_type
        }}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@file_explorer_bp.get('/properties')
async def get_properties(path: str = Query(...)):
    """
    Get file or directory properties.

    Example:
        GET /api/app/file_explorer/properties?path=/tmp/test_dir
    """
    if not path:
        raise HTTPException(status_code=400, detail='Path is required')

    abs_path = os.path.abspath(os.path.expanduser(path))
    if not os.path.exists(abs_path) and not os.path.islink(abs_path):
        raise HTTPException(status_code=404, detail='Path not found')

    try:
        stat_result = await anyio.to_thread.run_sync(os.lstat, abs_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Path not found')
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc) or 'Permission denied')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    mode_value = stat.S_IMODE(stat_result.st_mode)
    perms = _mode_to_permissions(mode_value)

    try:
        owner_name = (await anyio.to_thread.run_sync(pwd.getpwuid, stat_result.st_uid)).pw_name
    except KeyError:
        owner_name = stat_result.st_uid

    try:
        group_name = (await anyio.to_thread.run_sync(grp.getgrgid, stat_result.st_gid)).gr_name
    except KeyError:
        group_name = stat_result.st_gid

    info: Dict[str, Any] = {
        'path': abs_path,
        'name': os.path.basename(abs_path) or abs_path,
        'type': 'directory' if os.path.isdir(abs_path) else 'symlink' if os.path.islink(abs_path) else 'file' if os.path.isfile(abs_path) else 'unknown',
        'is_directory': os.path.isdir(abs_path),
        'is_symlink': os.path.islink(abs_path),
        'size': stat_result.st_size,
        'mtime': int(stat_result.st_mtime),
        'mode_octal': format(mode_value, '03o'),
        'mode_int': mode_value,
        'permissions': perms,
        'owner': owner_name,
        'group': group_name,
    }

    return {"ok": True, "data": info}


@file_explorer_bp.post('/chmod')
async def chmod_path(data: dict = Body(...)):
    target = data.get('path')
    mode_str = str(data.get('mode', '')).strip()
    if not target or not mode_str:
        raise HTTPException(status_code=400, detail='Path and mode are required')
    target_abs = os.path.abspath(os.path.expanduser(target))
    try:
        mode_value = int(mode_str, 8)
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid mode format')
    recursive = bool(data.get('recursive'))
    try:
        if recursive and os.path.isdir(target_abs) and not os.path.islink(target_abs):
            await anyio.to_thread.run_sync(_chmod_recursive_local, target_abs, mode_value)
        else:
            await anyio.to_thread.run_sync(os.chmod, target_abs, mode_value)
    except PermissionError:
        try:
            args = ['chmod']
            if recursive:
                args.append('-R')
            args.extend([format(mode_value, '03o'), target_abs])
            await anyio.to_thread.run_sync(_run_sudo, args)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc) or 'Permission denied')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True, "data": {'path': target_abs, 'mode': format(mode_value, '03o'), 'recursive': recursive}}


@file_explorer_bp.post('/extract')
async def extract_archive(data: dict = Body(...)):
    source = data.get('source')
    directory = data.get('directory')
    if not source or not directory:
        raise HTTPException(status_code=400, detail='Source and destination are required')

    source_abs = os.path.abspath(os.path.expanduser(source))
    dest_abs = os.path.abspath(os.path.expanduser(directory))

    if not os.path.isfile(source_abs):
        raise HTTPException(status_code=404, detail='Source archive not found')
    if not os.path.isdir(dest_abs):
        raise HTTPException(status_code=400, detail='Destination must be an existing directory')

    try:
        await anyio.to_thread.run_sync(shutil.unpack_archive, source_abs, dest_abs)
    except shutil.ReadError:
        raise HTTPException(status_code=400, detail='Unsupported or invalid archive format')
    except PermissionError:
        script = (
            'import shutil\n'
            f'source = {json.dumps(source_abs)}\n'
            f'dest = {json.dumps(dest_abs)}\n'
            'shutil.unpack_archive(source, dest)\n'
        )
        try:
            await anyio.to_thread.run_sync(_run_sudo, ['python3', '-c', script])
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc) or 'Permission denied')
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Source archive not found')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"ok": True, "data": {'extracted': source_abs, 'into': dest_abs}}


@file_explorer_bp.post('/chown')
async def chown_path(data: dict = Body(...)):
    target = data.get('path')
    user = (data.get('user') or '').strip()
    group = (data.get('group') or '').strip()
    if not target or (not user and not group):
        raise HTTPException(status_code=400, detail='Path and user/group required')
    target_abs = os.path.abspath(os.path.expanduser(target))
    spec = f"{user}:{group}" if user and group else (user if user else f":{group}")
    try:
        await anyio.to_thread.run_sync(shutil.chown, target_abs, user or None, group or None)
    except Exception:
        try:
            await anyio.to_thread.run_sync(_run_sudo, ['chown', spec, target_abs])
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc) or 'Permission denied')
    return {"ok": True, "data": {'path': target_abs, 'owner': user or 'unchanged', 'group': group or 'unchanged'}}






# ---------------------------------------------------------------------------
# Background job helpers
# ---------------------------------------------------------------------------



COPY_CHUNK_SIZE = 1024 * 1024  # 1 MiB per chunk


def _normalize_sources(raw_sources: List[Any]) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """Normalize raw source paths into absolute paths.

    Returns a tuple of (valid_sources, errors) so the caller can report
    unresolved inputs back to the user rather than aborting the whole job.
    """

    valid: List[Dict[str, str]] = []
    errors: List[Dict[str, str]] = []
    for entry in raw_sources:
        if not isinstance(entry, str) or not entry.strip():
            errors.append({'source': str(entry), 'error': 'Invalid source path'})
            continue
        abs_path = os.path.abspath(os.path.expanduser(entry))
        if not os.path.exists(abs_path):
            errors.append({'source': entry, 'error': 'Source not found'})
            continue
        valid.append({'raw': entry, 'source': abs_path, 'name': os.path.basename(abs_path) or abs_path})
    return valid, errors


def _measure_sources(paths: List[str], ctx) -> Tuple[int, int]:
    """Return (total_bytes, total_files) for the given paths."""

    total_bytes = 0
    total_files = 0
    for path in paths:
        ctx.check_cancelled()
        if os.path.islink(path):
            total_files += 1
            continue
        if os.path.isdir(path):
            for root, _, files in os.walk(path):
                ctx.check_cancelled()
                for filename in files:
                    file_path = os.path.join(root, filename)
                    total_files += 1
                    if os.path.islink(file_path):
                        continue
                    try:
                        total_bytes += os.path.getsize(file_path)
                    except OSError:
                        continue
        elif os.path.isfile(path):
            total_files += 1
            try:
                total_bytes += os.path.getsize(path)
            except OSError:
                continue
        else:
            total_files += 1
    return total_bytes, total_files


def _emit_progress(ctx, state: Dict[str, Any], detail: str) -> None:
    bytes_total = int(state.get('bytes_total') or 0)
    if bytes_total > 0:
        completed = min(int(state.get('bytes_done', 0)), bytes_total)
        total = bytes_total
    else:
        total = max(int(state.get('sources_total') or 1), 1)
        completed = min(int(state.get('sources_done', 0)), total)
    ctx.set_progress(completed=completed, total=total, detail=detail)


def _copy_symlink(ctx, source: str, destination: str, state: Dict[str, Any], detail: str) -> None:
    ctx.check_cancelled()
    parent = os.path.dirname(destination) or '.'
    os.makedirs(parent, exist_ok=True)
    if os.path.lexists(destination):
        raise FileExistsError(destination)
    target = os.readlink(source)
    os.symlink(target, destination)
    _emit_progress(ctx, state, detail)


def _copy_file_contents(ctx, source: str, destination: str, state: Dict[str, Any], detail: str) -> None:
    ctx.check_cancelled()
    parent = os.path.dirname(destination) or '.'
    os.makedirs(parent, exist_ok=True)
    with open(source, 'rb') as reader, open(destination, 'wb') as writer:
        while True:
            chunk = reader.read(COPY_CHUNK_SIZE)
            if not chunk:
                break
            writer.write(chunk)
            state['bytes_done'] = state.get('bytes_done', 0) + len(chunk)
            _emit_progress(ctx, state, detail)
            ctx.check_cancelled()
    try:
        shutil.copystat(source, destination, follow_symlinks=False)
    except (PermissionError, OSError):
        pass


def _copy_directory(ctx, source: str, destination: str, state: Dict[str, Any], label: str) -> None:
    if os.path.exists(destination):
        raise FileExistsError(destination)
    os.makedirs(destination, exist_ok=True)
    try:
        shutil.copystat(source, destination, follow_symlinks=False)
    except (PermissionError, OSError):
        pass

    for root, dirs, files in os.walk(source):
        ctx.check_cancelled()
        rel_root = os.path.relpath(root, source)
        dest_root = destination if rel_root in {'.', ''} else os.path.join(destination, rel_root)
        os.makedirs(dest_root, exist_ok=True)
        try:
            shutil.copystat(root, dest_root, follow_symlinks=False)
        except (PermissionError, OSError):
            pass

        # Handle directory symlinks explicitly; os.walk will not descend into them.
        for dirname in list(dirs):
            src_dir = os.path.join(root, dirname)
            dest_dir = os.path.join(dest_root, dirname)
            if os.path.islink(src_dir):
                rel_name = os.path.relpath(src_dir, source).replace(os.sep, '/')
                detail = f"{label}/{rel_name}" if rel_name not in {'.', ''} else label
                _copy_symlink(ctx, src_dir, dest_dir, state, detail)

        for filename in files:
            src_file = os.path.join(root, filename)
            dest_file = os.path.join(dest_root, filename)
            rel_name = os.path.relpath(src_file, source).replace(os.sep, '/')
            detail = f"{label}/{rel_name}" if rel_name not in {'.', ''} else label
            if os.path.islink(src_file):
                _copy_symlink(ctx, src_file, dest_file, state, detail)
            else:
                _copy_file_contents(ctx, src_file, dest_file, state, detail)


def _copy_entry(ctx, source: str, destination: str, state: Dict[str, Any], label: str) -> None:
    if os.path.islink(source):
        _copy_symlink(ctx, source, destination, state, label)
    elif os.path.isdir(source):
        _copy_directory(ctx, source, destination, state, label)
    else:
        detail = label
        _copy_file_contents(ctx, source, destination, state, detail)


def _safe_remove_path(path: str) -> None:
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path, ignore_errors=True)
    else:
        try:
            os.remove(path)
        except OSError:
            pass


def _format_bulk_message(action: str, successes: List[Dict[str, Any]], errors: List[Dict[str, Any]], destination: str) -> str:
    success_count = len(successes)
    error_count = len(errors)
    if success_count and error_count:
        return f"{action} {success_count} item{'s' if success_count != 1 else ''} to {destination} ({error_count} failed)"
    if success_count:
        return f"{action} {success_count} item{'s' if success_count != 1 else ''} to {destination}"
    if error_count:
        return f"{action} failed for {error_count} item{'s' if error_count != 1 else ''}"
    return f"No items {action.lower()}"


@register_job_handler('bulk_copy')
def job_bulk_copy(ctx, params: Dict[str, Any]) -> None:
    raw_sources = params.get('sources') or []
    destination_raw = params.get('destination')
    destinations_param = params.get('destinations') or {}
    if not isinstance(raw_sources, list) or not raw_sources:
        raise ValueError('sources must be a non-empty list')
    if destination_raw is not None and (not isinstance(destination_raw, str) or not destination_raw.strip()):
        raise ValueError('destination must be a directory path if provided')

    dest_overrides: Dict[str, str] = {}
    if isinstance(destinations_param, dict):
        iterator = destinations_param.items()
    elif isinstance(destinations_param, list):
        iterator = []
        for entry in destinations_param:
            if isinstance(entry, dict) and 'source' in entry and 'target' in entry:
                iterator.append((entry['source'], entry['target']))
    else:
        iterator = []

    for source_key, target_path in iterator:
        if not isinstance(source_key, str) or not isinstance(target_path, str):
            continue
        normalized_target = os.path.abspath(os.path.expanduser(target_path))
        parent_dir = os.path.dirname(normalized_target)
        if not parent_dir:
            continue
        if not os.path.isdir(parent_dir):
            raise ValueError(f'Destination directory not found for {target_path}')
        dest_overrides[source_key] = normalized_target

    dest_dir_abs = None
    if isinstance(destination_raw, str) and destination_raw.strip():
        dest_dir_abs = os.path.abspath(os.path.expanduser(destination_raw))
        if not os.path.isdir(dest_dir_abs):
            raise ValueError('Destination directory not found')

    sources, errors = _normalize_sources(raw_sources)
    if not sources and errors:
        raise RuntimeError('No valid sources to copy')
    if not sources:
        raise ValueError('No valid sources provided')

    total_bytes, _ = _measure_sources([item['source'] for item in sources], ctx)
    state: Dict[str, Any] = {
        'bytes_total': total_bytes,
        'bytes_done': 0,
        'sources_total': len(sources),
        'sources_done': 0,
    }

    ctx.set_message(f"Copying {len(sources)} item{'s' if len(sources) != 1 else ''}…")
    _emit_progress(ctx, state, 'Preparing copy…')

    successes: List[Dict[str, Any]] = []

    for item in sources:
        ctx.check_cancelled()
        source_path = item['source']
        display_name = item['name']
        override_path = dest_overrides.get(item['raw']) or dest_overrides.get(item['source'])
        if override_path:
            destination_path = override_path
            destination_parent = os.path.dirname(destination_path)
            if not os.path.isdir(destination_parent):
                errors.append({'source': item['raw'], 'error': 'Destination directory not found'})
                continue
        else:
            if not dest_dir_abs:
                errors.append({'source': item['raw'], 'error': 'No destination directory provided'})
                continue
            destination_path = os.path.join(dest_dir_abs, display_name)
        detail = f"Copying {display_name}"

        if destination_path == source_path:
            errors.append({'source': item['raw'], 'error': 'Destination matches source'})
            continue
        if os.path.isdir(source_path):
            try:
                common_root = os.path.commonpath([destination_path, source_path])
            except ValueError:
                common_root = ''
            if common_root == source_path:
                errors.append({'source': item['raw'], 'error': 'Destination is inside the source'})
                continue
        if os.path.exists(destination_path):
            errors.append({'source': item['raw'], 'error': 'Target already exists'})
            continue

        ctx.set_message(f"Copying {display_name}…")

        success = False
        try:
            _copy_entry(ctx, source_path, destination_path, state, detail)
            successes.append({
                'source': source_path,
                'destination': destination_path,
                'source_parent': os.path.dirname(source_path),
            })
            success = True
        except JobCancelled:
            _safe_remove_path(destination_path)
            raise
        except FileExistsError:
            _safe_remove_path(destination_path)
            errors.append({'source': item['raw'], 'error': 'Target already exists'})
        except Exception as exc:  # pylint: disable=broad-except
            _safe_remove_path(destination_path)
            errors.append({'source': item['raw'], 'error': str(exc) or 'Copy failed'})

        if success:
            state['sources_done'] += 1
        detail_message = f"Copied {display_name}" if success else f"Copy failed: {display_name}"
        _emit_progress(ctx, state, detail_message)

    if dest_dir_abs:
        destination_label = dest_dir_abs
    elif successes:
        destination_label = os.path.dirname(successes[0]['destination']) or successes[0]['destination']
    else:
        destination_label = destination_raw or 'destination'

    message = _format_bulk_message('Copied', successes, errors, destination_label)
    result = {
        'destination': dest_dir_abs or destination_label,
        'succeeded': successes,
        'failed': errors,
        'total_bytes': total_bytes,
    }

    if successes:
        if state.get('bytes_total'):
            state['bytes_done'] = state['bytes_total']
        else:
            state['sources_done'] = state['sources_total']
        _emit_progress(ctx, state, 'Copy finished')
        ctx.finish(message=message, result=result)
    elif errors:
        raise RuntimeError(message)
    else:
        ctx.finish(message='Nothing to copy', result=result)


@register_job_handler('bulk_move')
def job_bulk_move(ctx, params: Dict[str, Any]) -> None:
    raw_sources = params.get('sources') or []
    destination_raw = params.get('destination')
    if not isinstance(raw_sources, list) or not raw_sources:
        raise ValueError('sources must be a non-empty list')
    if not isinstance(destination_raw, str) or not destination_raw.strip():
        raise ValueError('destination must be a directory path')

    dest_dir_abs = os.path.abspath(os.path.expanduser(destination_raw))
    if not os.path.isdir(dest_dir_abs):
        raise ValueError('Destination directory not found')

    sources, errors = _normalize_sources(raw_sources)
    if not sources and errors:
        raise RuntimeError('No valid sources to move')
    if not sources:
        raise ValueError('No valid sources provided')

    state: Dict[str, Any] = {
        'bytes_total': 0,
        'bytes_done': 0,
        'sources_total': len(sources),
        'sources_done': 0,
    }

    ctx.set_message(f"Moving {len(sources)} item{'s' if len(sources) != 1 else ''}…")
    _emit_progress(ctx, state, 'Preparing move…')

    successes: List[Dict[str, Any]] = []

    for item in sources:
        ctx.check_cancelled()
        source_path = item['source']
        display_name = item['name']
        destination_path = os.path.join(dest_dir_abs, display_name)
        detail = f"Moving {display_name}"

        if destination_path == source_path:
            errors.append({'source': item['raw'], 'error': 'Destination matches source'})
            continue
        if os.path.exists(destination_path):
            errors.append({'source': item['raw'], 'error': 'Target already exists'})
            continue

        ctx.set_message(f"Moving {display_name}…")

        try:
            os.replace(source_path, destination_path)
        except PermissionError:
            try:
                _run_sudo(['mv', source_path, destination_path])
            except PermissionError as exc:
                errors.append({'source': item['raw'], 'error': str(exc) or 'Move failed'})
                continue
        except OSError:
            try:
                shutil.move(source_path, destination_path)
            except Exception as exc:  # pylint: disable=broad-except
                errors.append({'source': item['raw'], 'error': str(exc) or 'Move failed'})
                continue
        except Exception as exc:  # pylint: disable=broad-except
            errors.append({'source': item['raw'], 'error': str(exc) or 'Move failed'})
            continue

        state['sources_done'] += 1
        _emit_progress(ctx, state, detail)
        successes.append({
            'source': source_path,
            'destination': destination_path,
            'source_parent': os.path.dirname(source_path),
        })

    message = _format_bulk_message('Moved', successes, errors, dest_dir_abs)
    result = {
        'destination': dest_dir_abs,
        'succeeded': successes,
        'failed': errors,
    }

    if successes:
        state['sources_done'] = state['sources_total']
        _emit_progress(ctx, state, 'Move finished')
        ctx.finish(message=message, result=result)
    elif errors:
        raise RuntimeError(message)
    else:
        ctx.finish(message='Nothing to move', result=result)


# Expose blueprint under a predictable attribute name for discovery
bp = file_explorer_bp
