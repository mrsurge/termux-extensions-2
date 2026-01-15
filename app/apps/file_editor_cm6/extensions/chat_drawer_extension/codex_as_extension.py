from __future__ import annotations

from fastapi import APIRouter, Body, Request, Response
from fastapi.responses import JSONResponse

# Hardcoded imports for now; these will be dynamically wired by the extensions
# loader once app-level extensions are formalized.
from ...drawer_core import record_drawer_open, update_ui_hints
from ...explorer_helper import get_project_root
from ...stores import get_history_store

bp = APIRouter()

_CORS_ORIGINS = {
    "http://127.0.0.1:12359",
    "http://localhost:12359",
}


def _cors_origin(request: Request) -> str | None:
    origin = request.headers.get("origin")
    if origin in _CORS_ORIGINS:
        return origin
    return None


def _cors_headers(origin: str | None) -> dict[str, str]:
    if not origin:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin",
    }


@bp.post("/agent/drawer/open")
async def agent_drawer_open(payload: dict = Body(default=None)):
    payload = payload or {}
    source = payload.get("source") if isinstance(payload, dict) else None
    data = record_drawer_open(source)
    return {"ok": True, "data": data}


@bp.post("/agent/drawer/ui_hints")
async def agent_drawer_ui_hints(payload: dict = Body(default=None)):
    payload = payload or {}
    hints = payload if isinstance(payload, dict) else {}
    data = update_ui_hints(hints)
    return {"ok": True, "data": data}


@bp.options("/agent/cwd")
async def agent_cwd_options(request: Request):
    origin = _cors_origin(request)
    headers = _cors_headers(origin)
    if origin:
        headers.update({
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
        })
    return Response(status_code=204, headers=headers)


@bp.get("/agent/cwd")
async def agent_cwd(request: Request):
    origin = _cors_origin(request)
    headers = _cors_headers(origin)
    try:
        history = get_history_store()
        root = history.get_active_project() or str(get_project_root())
        return JSONResponse({"ok": True, "data": {"cwd": str(root)}}, headers=headers)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500, headers=headers)
