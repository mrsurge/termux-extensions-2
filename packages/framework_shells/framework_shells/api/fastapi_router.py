from fastapi import APIRouter, Depends, Header, HTTPException, Query, Body
from fastapi.responses import FileResponse
from typing import List, Optional, Any
import hmac
from pathlib import Path

from ..auth import get_secret, derive_api_token
from ..manager import FrameworkShellManager
from ..store import RuntimeStore
from .. import get_manager as get_shared_manager

router = APIRouter()


async def get_manager_dep() -> FrameworkShellManager:
    # Always use the package-level singleton so hosts can configure hooks/providers once.
    return await get_shared_manager()

async def require_auth(
    authorization: str = Header(None),
    x_framework_key: str = Header(None, alias="X-Framework-Key")
) -> None:
    """Require valid Bearer token or X-Framework-Key for mutating endpoints."""
    secret = get_secret()
    
    # If no secret configured, skip auth (dev mode)
    if not secret:
        return
    
    expected = derive_api_token(secret)
    token = None
    
    # Check X-Framework-Key first (frontend uses this)
    if x_framework_key:
        token = x_framework_key
    # Fall back to Authorization: Bearer
    elif authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    
    # No token provided - skip auth if no token required
    if not token:
        raise HTTPException(403, "Missing auth token (X-Framework-Key or Authorization header)")
    
    if not hmac.compare_digest(token, expected):
        raise HTTPException(403, "Invalid auth token")

@router.get("/api/framework_shells")
async def list_shells(
    mgr: FrameworkShellManager = Depends(get_manager_dep)
):
    records = await mgr.list_shells()
    return {"ok": True, "data": [r.to_payload() for r in records]}

@router.get("/api/framework_shells/{shell_id}")
async def get_shell(
    shell_id: str,
    mgr: FrameworkShellManager = Depends(get_manager_dep)
):
    record = await mgr.get_shell(shell_id)
    if not record:
        raise HTTPException(404, "Shell not found")
    return {"ok": True, "data": record.to_payload(include_env=True)}

@router.post("/api/framework_shells")
async def find_or_create_shell(
    payload: dict = Body(...),
    authorization: str = Header(None), # Verify explicit param vs dependency
    mgr: FrameworkShellManager = Depends(get_manager_dep),
    _: None = Depends(require_auth)
):
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
             return {"ok": True, "data": existing.to_payload(), "reused": True}

    if not command:
        raise HTTPException(400, "Command required")

    record = await mgr.spawn_shell_pty(
        command, cwd=cwd, env=env, label=label,
        subgroups=subgroups, ui=ui, autostart=autostart
    )
    return {"ok": True, "data": record.to_payload()}

@router.post('/api/framework_shells/{shell_id}/terminate')
async def terminate_shell(
    shell_id: str,
    mgr: FrameworkShellManager = Depends(get_manager_dep),
    _: None = Depends(require_auth)
):
    await mgr.terminate_shell(shell_id)
    return {"ok": True}

@router.post('/api/framework_shells/{shell_id}/action')
async def shell_action(
    shell_id: str,
    payload: dict = Body(...),
    mgr: FrameworkShellManager = Depends(get_manager_dep),
    _: None = Depends(require_auth)
):
    """Handle shell actions (terminate, etc.)."""
    action = payload.get("action")
    if action == "terminate":
        force = payload.get("force", False)
        await mgr.terminate_shell(shell_id, force=force)
        return {"ok": True}
    else:
        raise HTTPException(400, f"Unknown action: {action}")


@router.delete('/api/framework_shells/{shell_id}')
async def remove_shell(
    shell_id: str,
    force: bool = Query(False),
    mgr: FrameworkShellManager = Depends(get_manager_dep),
    _: None = Depends(require_auth),
):
    """Purge a shell's metadata and logs.

    The Sessions & Shortcuts "Exited shells" UI uses this to delete old logs.
    """
    ok = await mgr.remove_shell(shell_id, force=force)
    if not ok:
        raise HTTPException(404, "Shell not found")
    return {"ok": True}


@router.post('/api/framework_shells/purge_exited')
async def purge_exited_shells(
    mgr: FrameworkShellManager = Depends(get_manager_dep),
    _: None = Depends(require_auth),
):
    """Purge metadata/logs for all exited shells."""
    records = await mgr.list_shells()
    exited = [r for r in records if (getattr(r, 'status', None) or '') == 'exited']
    errors: list[str] = []
    purged = 0
    for rec in exited:
        try:
            await mgr.remove_shell(rec.id, force=True)
            purged += 1
        except Exception as exc:
            errors.append(f"{rec.id}: {exc}")
    return {"ok": True, "data": {"purged": purged, "errors": errors}}


from fastapi.responses import FileResponse

@router.get("/api/framework_shells/{shell_id}/replay")
async def replay_log(
    shell_id: str,
    mgr: FrameworkShellManager = Depends(get_manager_dep)
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
