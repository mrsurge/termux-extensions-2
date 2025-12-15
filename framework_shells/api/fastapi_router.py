from fastapi import APIRouter, Depends, Header, HTTPException, Query, Body
from fastapi.responses import FileResponse
from typing import List, Optional, Any
import hmac
from pathlib import Path

from ..auth import get_secret, derive_api_token
from ..manager import FrameworkShellManager
from ..store import RuntimeStore

router = APIRouter()

# Singleton instance
_manager_instance: Optional[FrameworkShellManager] = None

async def get_manager() -> FrameworkShellManager:
    global _manager_instance
    if _manager_instance is None:
        _manager_instance = FrameworkShellManager()
        # Optionally trigger load? Manager loads lazily on list/get.
    return _manager_instance

async def require_auth(authorization: str = Header(None)) -> None:
    """Require valid Bearer token for mutating endpoints."""
    try:
        secret = get_secret()
    except RuntimeError:
        # If secret not configured (maybe dev mode?), we might skip?
        # But plan says "Hard prerequisites".
        raise HTTPException(500, "Server misconfigured: missing secret")

    expected = derive_api_token(secret)
    
    if not authorization:
        raise HTTPException(403, "Missing Authorization header")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(403, "Authorization header must use Bearer scheme")
    
    token = authorization[7:]
    if not hmac.compare_digest(token, expected):
        raise HTTPException(403, "Invalid auth token")

@router.get("/api/framework_shells")
async def list_shells(
    mgr: FrameworkShellManager = Depends(get_manager)
):
    records = await mgr.list_shells()
    return {"ok": True, "shells": [r.to_payload() for r in records]}

@router.get("/api/framework_shells/{shell_id}")
async def get_shell(
    shell_id: str,
    mgr: FrameworkShellManager = Depends(get_manager)
):
    record = await mgr.get_shell(shell_id)
    if not record:
        raise HTTPException(404, "Shell not found")
    return {"ok": True, "shell": record.to_payload(include_env=True)}

@router.post("/api/framework_shells")
async def find_or_create_shell(
    payload: dict = Body(...),
    authorization: str = Header(None), # Verify explicit param vs dependency
    mgr: FrameworkShellManager = Depends(get_manager),
    _: None = Depends(require_auth)
):
    # This matches the existing TE2 find_or_create semantics
    command = payload.get("command")
    cwd = payload.get("cwd")
    env = payload.get("env")
    label = payload.get("label")
    subgroups = payload.get("subgroups")
    ui = payload.get("ui")
    autostart = payload.get("autostart", True)

    # Idempotency check
    if label:
        existing = await mgr.find_shell_by_label(label)
        if existing:
             return {"ok": True, "shell": existing.to_payload(), "reused": True}

    if not command:
        raise HTTPException(400, "Command required")

    record = await mgr.spawn_shell_pty(
        command, cwd=cwd, env=env, label=label,
        subgroups=subgroups, ui=ui, autostart=autostart
    )
    return {"ok": True, "shell": record.to_payload()}

@router.post('/api/framework_shells/{shell_id}/terminate')
async def terminate_shell(
    shell_id: str,
    mgr: FrameworkShellManager = Depends(get_manager),
    _: None = Depends(require_auth)
):
    await mgr.terminate_shell(shell_id)
    return {"ok": True}

from fastapi.responses import FileResponse

@router.get("/api/framework_shells/{shell_id}/replay")
async def replay_log(
    shell_id: str,
    mgr: FrameworkShellManager = Depends(get_manager)
):
    """Serve the stdout log for a shell."""
    record = await mgr.get_shell(shell_id)
    if not record:
        raise HTTPException(404, "Shell not found")
        
    path = Path(record.stdout_log)
    if not path.exists():
         return {"ok": True, "content": ""}
    
    # Simple FileResponse for now. 
    # Front-end can handle range headers automatically with FileResponse if needed.
    return FileResponse(path, media_type="text/plain")
