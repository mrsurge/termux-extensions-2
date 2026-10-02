import asyncio
import json
import os
from pathlib import Path
from fastapi import APIRouter, Query, Body, HTTPException
from typing import Optional, Dict, Any
from urllib import request as urllib_request
from urllib.parse import quote, urlencode

file_editor_bp = APIRouter()
APP_ID = str(os.environ.get("TE_APP_ID") or "file_editor").strip() or "file_editor"


@file_editor_bp.post('/sidebar/window/state')
async def publish_sidebar_file_state(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    from app.libs.sidebar_rpc import call_sidebar_rpc
    host_id = str(payload.get('host_id') or '').strip()
    token_id = str(payload.get('token_id') or '').strip()
    worker_id = str(payload.get('console_worker_id') or '').strip()
    if not host_id or not token_id:
        raise HTTPException(status_code=400, detail='Sidebar slot identity is required')
    raw_path = payload.get('file')
    if not isinstance(raw_path, str):
        raise HTTPException(status_code=400, detail='file is required')
    resolved, error = _expand_and_validate_path(raw_path)
    if error or resolved is None or not Path(resolved).is_file():
        raise HTTPException(status_code=400, detail=error or 'file must exist')
    query = {'embed': '1', 'te2_host_id': host_id, 'te2_token_id': token_id,
             'file': resolved}
    if worker_id:
        query['te2_console_worker_id'] = worker_id
    result = await call_sidebar_rpc(APP_ID, 'sidebar.window.state.update', {
        'lane': {'app_id': APP_ID, 'base_url': '/app/file_editor'}, 'app_id': APP_ID,
        'base_url': '/app/file_editor', 'host_id': host_id, 'token_id': token_id,
        'console_worker_id': worker_id, 'state_kind': 'file',
        'query_state': {'file': resolved}, 'url': '/app/file_editor?' + urlencode(query),
        'label': Path(resolved).name, 'load': 'eager', 'activate': False,
        'source': 'file_editor_backend',
    })
    return {'ok': True, 'data': result}


def _framework_url() -> str:
    explicit = str(os.environ.get("TE_FRAMEWORK_URL") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    port = str(os.environ.get("TE_PORT") or "8089").strip() or "8089"
    return f"http://127.0.0.1:{port}"


def _post_serving_readiness() -> None:
    body = {
        "app_id": APP_ID,
        "status": "ready",
        "phase": "serving",
        "source": "file_editor_backend",
    }
    endpoint = f"{_framework_url()}/api/apps/{quote(APP_ID, safe='')}/readiness"
    req = urllib_request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib_request.urlopen(req, timeout=5) as resp:
        resp.read()


async def te2_app_backend_serving() -> None:
    try:
        await asyncio.to_thread(_post_serving_readiness)
    except Exception as exc:
        print(f"[file_editor] readiness post failed: {exc}", flush=True)

def _expand_and_validate_path(path: str) -> tuple[Optional[str], Optional[str]]:
    base_home = Path.home()
    try:
        expanded = Path(path).expanduser().resolve()
    except Exception:
        return None, 'Invalid path'
    
    if not expanded.is_relative_to(base_home.resolve()):
        return None, 'Access denied'
    
    return str(expanded), None

@file_editor_bp.get('/')
async def status() -> Dict[str, Any]:
    return {"ok": True, "data": {"message": "File Editor app API ready"}}

@file_editor_bp.get('/read')
async def read_file(path: str = Query(..., description="File path to read")) -> Dict[str, Any]:
    expanded, err = _expand_and_validate_path(path)
    if err:
        raise HTTPException(status_code=403, detail={"ok": False, "error": err})
    
    expanded_path = Path(expanded)
    if not expanded_path.is_file():
        raise HTTPException(status_code=404, detail={"ok": False, "error": "File not found"})
    
    try:
        content = expanded_path.read_text(encoding='utf-8', errors='replace')
        return {"ok": True, "data": {"path": expanded, "content": content}}
    except Exception as e:
        raise HTTPException(status_code=500, detail={"ok": False, "error": str(e)})

@file_editor_bp.post('/write')
async def write_file(
    path: str = Body(..., embed=True),
    content: str = Body(..., embed=True)
) -> Dict[str, Any]:
    if not path or content is None:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": 'Both "path" and "content" are required'}
        )
    
    expanded, err = _expand_and_validate_path(path)
    if err:
        raise HTTPException(status_code=403, detail={"ok": False, "error": err})
    
    try:
        expanded_path = Path(expanded)
        expanded_path.parent.mkdir(parents=True, exist_ok=True)
        expanded_path.write_text(content, encoding='utf-8')
        return {"ok": True, "data": {"path": expanded}}
    except Exception as e:
        raise HTTPException(status_code=500, detail={"ok": False, "error": str(e)})
