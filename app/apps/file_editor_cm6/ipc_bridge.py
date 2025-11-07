"""IPC bridge endpoints scoped to the file_editor_cm6 app."""

from __future__ import annotations

import os
from fastapi import APIRouter, Body, HTTPException
from .agent_bridge import get_bridge

ipc_bp = APIRouter(prefix="/ipc/file_editor_cm6")


@ipc_bp.post("/agents/spawn")
async def ipc_spawn_agent(payload: dict = Body(...)):
    agent = payload.get("agent", "codex")
    cwd = payload.get("cwd") or os.path.expanduser("~")
    session_id = payload.get("session_id")

    bridge = get_bridge()

    if agent == "codex":
        result = await bridge.find_or_spawn_agent("codex", cwd)
        resolved_session = session_id or result.get("session_id")
        shell_id = result.get("id")
        shell = await bridge.get_or_create_agent(resolved_session, "codex", cwd)
        return {
            "ok": True,
            "data": {
                "agent": agent,
                "session_id": resolved_session,
                "shell_id": shell_id,
                "shell": shell,
            },
        }

    raise HTTPException(status_code=400, detail=f"Unsupported agent type '{agent}'")
