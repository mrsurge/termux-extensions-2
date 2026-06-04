import asyncio
import json
import os
from pathlib import Path
from fastapi import APIRouter, Query, Body, HTTPException
from typing import Optional, Dict, Any
from urllib import request as urllib_request
from urllib.parse import quote

file_editor_bp = APIRouter()
APP_ID = str(os.environ.get("TE_APP_ID") or "file_editor").strip() or "file_editor"


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
    
    if not str(expanded).startswith(str(base_home)):
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
