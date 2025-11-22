import os
from pathlib import Path
from fastapi import APIRouter, Query, Body, HTTPException
from typing import Optional, Dict, Any

file_editor_bp = APIRouter()

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
