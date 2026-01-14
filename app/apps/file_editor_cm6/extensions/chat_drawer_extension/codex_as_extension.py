from __future__ import annotations

from fastapi import APIRouter, Body

# Hardcoded imports for now; these will be dynamically wired by the extensions
# loader once app-level extensions are formalized.
from ...drawer_core import record_drawer_open, update_ui_hints

bp = APIRouter()


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
