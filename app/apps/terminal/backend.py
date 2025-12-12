from __future__ import annotations

import os
import shlex
import asyncio
import shutil
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Body, Query, WebSocket

# Reuse the core framework shells manager/config
from app.libs.framework_shells import get_manager as _manager

terminal_bp = APIRouter()

async def mgr():
    return await _manager()


def _default_shell_command() -> list[str]:
    # Prefer bash with login+interactive; fallback to sh -i
    if os.path.basename((os.environ.get("SHELL") or "")).endswith("bash") or shutil.which("bash"):
        return ["bash", "-l", "-i"]
    return ["sh", "-i"]


async def _next_terminal_sequence(m) -> int:
    """Return next terminal-app sequence number (1-based)."""
    max_seq = 0
    try:
        records = await m.list_shells()
    except Exception:
        records = []
    for rec in records:
        label = rec.label or ''
        if label == 'terminal-app':
            max_seq = max(max_seq, 1)
            continue
        m_label = re.match(r'^terminal-app:(\\d+)$', label)
        if not m_label:
            continue
        try:
            max_seq = max(max_seq, int(m_label.group(1)))
        except Exception:
            continue
    return max_seq + 1


@terminal_bp.get("/shells")
async def list_shells() -> Any:
    """List framework shells created by this app (label startswith 'terminal-app')."""
    m = await mgr()
    records = [
        await m.describe(r)
        for r in await m.list_shells()
        if (r.label or "").startswith("terminal-app")
    ]
    return {"ok": True, "data": records}


@terminal_bp.post("/shells")
async def create_shell(payload: dict = Body(...)) -> Any:
    """Spawn a new PTY-backed interactive shell as a framework shell.

    Body (JSON): { shell?: string[], cwd?: string }
    """
    shell_cmd = payload.get("shell")
    if isinstance(shell_cmd, str):
        shell_cmd = shlex.split(shell_cmd)
    if not shell_cmd:
        shell_cmd = _default_shell_command()
    cwd = str(payload.get("cwd") or "~")

    m = await mgr()
    label = f"terminal-app:{await _next_terminal_sequence(m)}"
    try:
        record = await m.spawn_shell_pty(
            shell_cmd,
            cwd=cwd,
            env={},
            label=label,
            subgroups=["terminal", "shell"],
            autostart=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to spawn shell: {exc}")

    data = await m.describe(record)
    return {"ok": True, "data": data}


@terminal_bp.get("/shells/{shell_id}")
async def get_shell(shell_id: str, tail: int = Query(0), logs: bool = Query(False)) -> Any:
    m = await mgr()
    rec = await m.get_shell(shell_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Shell not found")
    
    include_logs = logs
    data = await m.describe(rec, include_logs=include_logs, tail_lines=tail)
    return {"ok": True, "data": data}


@terminal_bp.post("/shells/{shell_id}/input")
async def send_input(shell_id: str, payload: dict = Body(...)) -> Any:
    """Send input (string) to the PTY of a shell.

    Body: { data: string, newline?: boolean }
    """
    m = await mgr()
    rec = await m.get_shell(shell_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Shell not found")

    data = payload.get("data")
    add_newline = bool(payload.get("newline", True))
    if data is None:
        raise HTTPException(status_code=400, detail="data is required")

    text = str(data)
    if add_newline:
        text += "\n"
    try:
        await m.write_to_pty(shell_id, text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write to PTY: {e}")
    return {"ok": True, "data": {"id": shell_id}}


@terminal_bp.post("/shells/{shell_id}/resize")
async def resize_shell(shell_id: str, payload: dict = Body(...)) -> Any:
    cols = int(payload.get("cols") or 80)
    rows = int(payload.get("rows") or 24)
    try:
        m = await mgr()
        await m.resize_pty(shell_id, cols, rows)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Resize failed: {e}")
    return {"ok": True, "data": {"id": shell_id, "cols": cols, "rows": rows}}


@terminal_bp.post("/shells/{shell_id}/action")
async def shell_action(shell_id: str, payload: dict = Body(...)) -> Any:
    action = str(payload.get("action") or "").lower()
    m = await mgr()
    try:
        if action in {"stop", "terminate"}:
            record = await m.terminate_shell(shell_id, force=False)
        elif action in {"kill", "force"}:
            record = await m.terminate_shell(shell_id, force=True)
        elif action == "restart":
            record = await m.restart_shell(shell_id)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported action '{action}'")
    except KeyError:
        raise HTTPException(status_code=404, detail="Shell not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Shell action failed: {exc}")
    return {"ok": True, "data": await m.describe(record)}


@terminal_bp.delete("/shells/{shell_id}")
async def delete_shell(shell_id: str) -> Any:
    m = await mgr()
    try:
        await m.remove_shell(shell_id, force=True)
    except KeyError:
        raise HTTPException(status_code=404, detail="Shell not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to remove shell: {exc}")
    return {"ok": True, "data": {"id": shell_id}}


# WebSocket wiring for streaming PTY output and receiving input


@terminal_bp.websocket("/ws/terminal/{shell_id}")
async def terminal_ws(websocket: WebSocket, shell_id: str):
    await websocket.accept()
    m = await _manager()
    try:
        q = await m.subscribe_output(shell_id)
    except Exception:
        await websocket.close()
        return

    stop = asyncio.Event()

    async def sender():
        while not stop.is_set():
            try:
                chunk = await asyncio.wait_for(q.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            try:
                await websocket.send_text(chunk)
            except Exception:
                stop.set()
                break

    sender_task = asyncio.create_task(sender())
    try:
        while not stop.is_set():
            msg = await websocket.receive_text()
            if msg is None:
                break
            try:
                await m.write_to_pty(shell_id, msg)
            except Exception:
                pass
    finally:
        stop.set()
        sender_task.cancel()
        try:
            await sender_task
        except asyncio.CancelledError:
            pass
        await m.unsubscribe_output(shell_id, q)
