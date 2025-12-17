from __future__ import annotations

import asyncio
import mimetypes
import os
import signal
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiofiles
from fastapi import APIRouter, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse

from .. import get_manager
from ..events import get_event_bus
from ..shutdown import ShutdownPolicy, shutdown_snapshot


router = APIRouter()

_UI_DIR = Path(__file__).resolve().parent.parent / "ui"


def _escape_html(value: Any) -> str:
    s = "" if value is None else str(value)
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _shell_backend(info: Dict[str, Any]) -> str:
    if info.get("uses_dtach"):
        return "dtach"
    if info.get("uses_pipes"):
        return "pipes"
    if info.get("uses_pty"):
        return "pty"
    return "proc"


def _is_shell_live(info: Dict[str, Any]) -> bool:
    if not info:
        return False
    if info.get("status") != "running":
        return False
    if not info.get("pid"):
        return False
    stats = info.get("stats") if isinstance(info.get("stats"), dict) else {}
    if stats and stats.get("alive") is False:
        return False
    return True


async def _render_dashboard_html() -> str:
    mgr = await get_manager()
    shells = await mgr.list_shells()
    described: List[Dict[str, Any]] = []
    for rec in shells:
        try:
            described.append(await mgr.describe(rec))
        except Exception:
            described.append(rec.to_payload())

    snapshot = await mgr.build_process_snapshot(shells=shells, include_procfs_descendants=True)

    shell_pid_set = {info.get("pid") for info in described if info.get("pid")}
    children_by_parent: Dict[int, List[Any]] = {}
    for proc in snapshot.processes.values():
        if proc.parent_pid is None:
            continue
        try:
            children_by_parent.setdefault(int(proc.parent_pid), []).append(proc)
        except Exception:
            continue

    running = [s for s in described if _is_shell_live(s)]
    exited = [s for s in described if not _is_shell_live(s)]

    app_workers = [s for s in running if str(s.get("label") or "").startswith("app-worker:")]
    other_running = [s for s in running if s not in app_workers]

    app_id_by_shell_id: Dict[str, str] = {}
    for s in app_workers:
        label = str(s.get("label") or "")
        if ":" in label:
            app_id_by_shell_id[str(s.get("id"))] = label.split(":", 1)[1]

    # Group "related shells" by umbrella=subgroups[0] (app id).
    related_by_app: Dict[str, List[Dict[str, Any]]] = {}
    remaining_other: List[Dict[str, Any]] = []
    app_ids = set(app_id_by_shell_id.values())
    for s in other_running:
        subgroups = s.get("subgroups") if isinstance(s.get("subgroups"), list) else []
        umbrella = str(subgroups[0]) if len(subgroups) >= 1 else ""
        if umbrella and umbrella in app_ids:
            related_by_app.setdefault(umbrella, []).append(s)
        else:
            remaining_other.append(s)

    parts: List[str] = []

    parts.append('<div class="section">')
    parts.append('<div class="section-title">Running <span class="muted">(%d)</span></div>' % len(running))

    if not running:
        parts.append('<div class="shell-card"><div class="shell-meta">No running shells.</div></div>')
    else:
        # App workers first.
        for s in app_workers:
            sid = str(s.get("id") or "")
            label = str(s.get("label") or sid)
            pid = s.get("pid")
            app_id = label.split(":", 1)[1] if ":" in label else ""
            backend = _shell_backend(s)

            parts.append('<div class="shell-card app-worker">')
            parts.append('<div class="shell-header">')
            parts.append('<div class="shell-title">%s</div>' % _escape_html(label))
            parts.append('<div class="shell-actions">')
            parts.append(f'<a class="btn btn-small" href="/fws/logs/{_escape_html(sid)}">Logs</a>')
            parts.append(
                f'<form method="post" action="/fws/action/app/{_escape_html(app_id)}/shutdown">'
                f'<button class="btn btn-small btn-danger" type="submit">Shutdown App</button>'
                f"</form>"
                if app_id
                else ""
            )
            parts.append(
                f'<form method="post" action="/fws/action/shell/{_escape_html(sid)}/terminate">'
                f'<button class="btn btn-small btn-danger" type="submit">Stop</button>'
                f"</form>"
            )
            parts.append("</div>")
            parts.append("</div>")

            parts.append(
                '<div class="shell-meta">PID: %s · ID: %s · Backend: %s</div>'
                % (_escape_html(pid), _escape_html(sid), _escape_html(backend))
            )
            cmd = s.get("command") if isinstance(s.get("command"), list) else []
            parts.append('<div class="shell-meta">Command: %s</div>' % _escape_html(" ".join(map(str, cmd))))
            if s.get("cwd"):
                parts.append('<div class="shell-meta">CWD: %s</div>' % _escape_html(s.get("cwd")))

            # Related shells (soft tree).
            if app_id and related_by_app.get(app_id):
                parts.append('<div class="children">')
                parts.append('<div class="children-title">Related Shells</div>')
                for rs in sorted(related_by_app.get(app_id, []), key=lambda x: x.get("label") or x.get("id") or ""):
                    rsid = str(rs.get("id") or "")
                    rlabel = str(rs.get("label") or rsid)
                    rpid = rs.get("pid")
                    rbackend = _shell_backend(rs)
                    parts.append('<div class="child-row">')
                    parts.append('<div class="child-main">')
                    parts.append('<div class="child-label">%s</div>' % _escape_html(rlabel))
                    parts.append(
                        '<div class="child-meta">PID: %s · ID: %s · %s</div>'
                        % (_escape_html(rpid), _escape_html(rsid), _escape_html(rbackend))
                    )
                    parts.append("</div>")
                    parts.append('<div class="row">')
                    parts.append(f'<a class="btn btn-small" href="/fws/logs/{_escape_html(rsid)}">Logs</a>')
                    parts.append(
                        f'<form method="post" action="/fws/action/shell/{_escape_html(rsid)}/terminate">'
                        f'<button class="btn btn-small btn-danger" type="submit">Stop</button>'
                        f"</form>"
                    )
                    parts.append("</div>")
                    parts.append("</div>")
                parts.append("</div>")

            # Hard tree children (pid parent/child).
            if pid and int(pid) in children_by_parent:
                children = [p for p in children_by_parent.get(int(pid), []) if p.pid not in shell_pid_set]
                if children:
                    parts.append('<div class="children">')
                    parts.append('<div class="children-title">Child Processes (%d)</div>' % len(children))
                    for child in sorted(children, key=lambda p: (p.type, p.pid)):
                        parts.append('<div class="child-row">')
                        parts.append('<div class="child-main">')
                        parts.append('<div class="child-label">%s</div>' % _escape_html(child.label or child.pid))
                        parts.append(
                            '<div class="child-meta">PID: %s · %s</div>'
                            % (_escape_html(child.pid), _escape_html(child.type))
                        )
                        parts.append("</div>")
                        parts.append('<div class="row">')
                        parts.append(
                            f'<form method="post" action="/fws/action/pid/{_escape_html(child.pid)}/terminate">'
                            f'<button class="btn btn-small btn-danger" type="submit">Kill</button>'
                            f"</form>"
                        )
                        parts.append("</div>")
                        parts.append("</div>")
                    parts.append("</div>")

            parts.append("</div>")

        # Everything else.
        for s in sorted(remaining_other, key=lambda x: x.get("label") or x.get("id") or ""):
            sid = str(s.get("id") or "")
            label = str(s.get("label") or sid)
            pid = s.get("pid")
            backend = _shell_backend(s)

            parts.append('<div class="shell-card">')
            parts.append('<div class="shell-header">')
            parts.append('<div class="shell-title">%s</div>' % _escape_html(label))
            parts.append('<div class="shell-actions">')
            parts.append(f'<a class="btn btn-small" href="/fws/logs/{_escape_html(sid)}">Logs</a>')
            parts.append(
                f'<form method="post" action="/fws/action/shell/{_escape_html(sid)}/terminate">'
                f'<button class="btn btn-small btn-danger" type="submit">Stop</button>'
                f"</form>"
            )
            parts.append("</div>")
            parts.append("</div>")
            parts.append(
                '<div class="shell-meta">PID: %s · ID: %s · Backend: %s</div>'
                % (_escape_html(pid), _escape_html(sid), _escape_html(backend))
            )
            cmd = s.get("command") if isinstance(s.get("command"), list) else []
            parts.append('<div class="shell-meta">Command: %s</div>' % _escape_html(" ".join(map(str, cmd))))
            if s.get("cwd"):
                parts.append('<div class="shell-meta">CWD: %s</div>' % _escape_html(s.get("cwd")))
            parts.append("</div>")

    parts.append("</div>")

    parts.append('<div class="section">')
    parts.append('<div class="section-title">Exited <span class="muted">(%d)</span></div>' % len(exited))
    if not exited:
        parts.append('<div class="shell-card"><div class="shell-meta">No exited shells.</div></div>')
    else:
        for s in sorted(exited, key=lambda x: x.get("label") or x.get("id") or ""):
            sid = str(s.get("id") or "")
            label = str(s.get("label") or sid)
            status = str(s.get("status") or "exited")
            exit_code = s.get("exit_code")
            meta = status
            if exit_code is not None:
                meta += f" · exit: {exit_code}"

            parts.append('<div class="shell-card">')
            parts.append('<div class="shell-header">')
            parts.append('<div class="shell-title">%s</div>' % _escape_html(label))
            parts.append('<div class="shell-actions">')
            parts.append(f'<a class="btn btn-small" href="/fws/logs/{_escape_html(sid)}">Logs</a>')
            parts.append(
                f'<form method="post" action="/fws/action/shell/{_escape_html(sid)}/purge">'
                f'<button class="btn btn-small" type="submit">Purge</button>'
                f"</form>"
            )
            parts.append("</div>")
            parts.append("</div>")
            parts.append('<div class="shell-meta">%s</div>' % _escape_html(meta))
            parts.append('<div class="shell-meta">ID: %s</div>' % _escape_html(sid))
            parts.append("</div>")
    parts.append("</div>")

    return "\n".join(parts)


@router.get("/fws")
async def fws_root() -> RedirectResponse:
    return RedirectResponse(url="/fws/", status_code=308)


@router.get("/fws/")
async def fws_index() -> FileResponse:
    return FileResponse(_UI_DIR / "index.html", media_type="text/html")


@router.get("/fws/static/{path:path}")
async def fws_static(path: str) -> FileResponse:
    target = (_UI_DIR / path).resolve()
    if not target.is_file() or _UI_DIR not in target.parents:
        raise HTTPException(status_code=404, detail="Not found")
    media_type, _ = mimetypes.guess_type(str(target))
    return FileResponse(target, media_type=media_type or "application/octet-stream")


@router.post("/fws/action/refresh")
async def fws_refresh() -> RedirectResponse:
    return RedirectResponse(url="/fws/", status_code=303)


@router.post("/fws/action/shell/{shell_id}/terminate")
async def fws_terminate_shell(shell_id: str) -> RedirectResponse:
    mgr = await get_manager()
    await mgr.terminate_shell(shell_id, force=True)
    return RedirectResponse(url="/fws/", status_code=303)


@router.post("/fws/action/shell/{shell_id}/purge")
async def fws_purge_shell(shell_id: str) -> RedirectResponse:
    mgr = await get_manager()
    await mgr.remove_shell(shell_id, force=True)
    return RedirectResponse(url="/fws/", status_code=303)


@router.post("/fws/action/pid/{pid}/terminate")
async def fws_terminate_pid(pid: int) -> RedirectResponse:
    try:
        os.kill(int(pid), signal.SIGKILL)
    except Exception:
        pass
    return RedirectResponse(url="/fws/", status_code=303)


@router.post("/fws/action/app/{app_id}/shutdown")
async def fws_shutdown_app(app_id: str) -> RedirectResponse:
    mgr = await get_manager()
    shells = await mgr.list_shells()
    targets = [s for s in shells if (s.derive_app_id() or "") == app_id and s.pid and s.status == "running"]
    snapshot = await mgr.build_process_snapshot(shells=shells, include_procfs_descendants=True)
    root_pids = [s.pid for s in targets if s.pid]
    await shutdown_snapshot(snapshot, manager=mgr, policy=ShutdownPolicy(types_last=[]), root_pids=root_pids)
    return RedirectResponse(url="/fws/", status_code=303)


@router.post("/fws/action/shutdown")
async def fws_shutdown(scope: str = Form("tree")) -> RedirectResponse:
    mgr = await get_manager()
    shells = await mgr.list_shells()

    if scope == "shells":
        for s in shells:
            if s.pid and s.status == "running":
                await mgr.terminate_shell(s.id, force=True)
        return RedirectResponse(url="/fws/", status_code=303)

    snapshot = await mgr.build_process_snapshot(shells=shells, include_procfs_descendants=True)
    await shutdown_snapshot(snapshot, manager=mgr, policy=ShutdownPolicy(types_last=[]))
    return RedirectResponse(url="/fws/", status_code=303)


@router.websocket("/ws/fws")
async def fws_ws(websocket: WebSocket):
    await websocket.accept()
    bus = get_event_bus()
    q = bus.subscribe()

    async def send_snapshot() -> None:
        html = await _render_dashboard_html()
        await websocket.send_json({"type": "snapshot_html", "html": html})

    try:
        await send_snapshot()
        while True:
            try:
                _ = await asyncio.wait_for(q.get(), timeout=5.0)
                await send_snapshot()
            except asyncio.TimeoutError:
                # periodic refresh to keep UI correct even if events are missed
                await send_snapshot()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        try:
            bus.unsubscribe(q)
        except Exception:
            pass


@router.get("/fws/logs/{shell_id}", response_class=HTMLResponse)
async def fws_logs(shell_id: str):
    template_path = _UI_DIR / "logs.html"
    async with aiofiles.open(template_path, "r", encoding="utf-8", errors="replace") as f:
        content = await f.read()
    return HTMLResponse(content=content.replace("{{ shell_id }}", shell_id))


@router.websocket("/ws/fws/logs/{shell_id}")
async def fws_logs_ws(websocket: WebSocket, shell_id: str):
    await websocket.accept()

    async def safe_close() -> None:
        try:
            await websocket.close()
        except Exception:
            pass

    try:
        mgr = await get_manager()
        rec = await mgr.get_shell(shell_id)
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": f"Failed to load shell record: {exc}"})
        await safe_close()
        return

    if not rec:
        await websocket.send_json({"type": "error", "message": f"Shell not found: {shell_id}"})
        await safe_close()
        return

    stdout_path = Path(rec.stdout_log)
    stderr_path = Path(rec.stderr_log)

    if not stdout_path.exists() and not stderr_path.exists():
        await websocket.send_json({"type": "error", "message": f"No log files found for {shell_id}"})
        await safe_close()
        return

    try:
        stdout_lines: List[str] = []
        if stdout_path.exists():
            async with aiofiles.open(stdout_path, "r", encoding="utf-8", errors="replace") as f:
                stdout_lines = (await f.read()).splitlines()

        stderr_lines: List[str] = []
        if stderr_path.exists():
            async with aiofiles.open(stderr_path, "r", encoding="utf-8", errors="replace") as f:
                stderr_lines = (await f.read()).splitlines()

        await websocket.send_json(
            {
                "type": "initial",
                "stdout": "\n".join(stdout_lines[-200:]),
                "stderr": "\n".join(stderr_lines[-200:]),
            }
        )

        stdout_size = stdout_path.stat().st_size if stdout_path.exists() else 0
        stderr_size = stderr_path.stat().st_size if stderr_path.exists() else 0

        while True:
            await asyncio.sleep(1)

            if stdout_path.exists():
                current = stdout_path.stat().st_size
                if current > stdout_size:
                    async with aiofiles.open(stdout_path, "r", encoding="utf-8", errors="replace") as f:
                        await f.seek(stdout_size)
                        new = await f.read()
                    await websocket.send_json({"type": "update", "stream": "stdout", "data": new})
                    stdout_size = current
                elif current < stdout_size:
                    stdout_size = 0

            if stderr_path.exists():
                current = stderr_path.stat().st_size
                if current > stderr_size:
                    async with aiofiles.open(stderr_path, "r", encoding="utf-8", errors="replace") as f:
                        await f.seek(stderr_size)
                        new = await f.read()
                    await websocket.send_json({"type": "update", "stream": "stderr", "data": new})
                    stderr_size = current
                elif current < stderr_size:
                    stderr_size = 0

    except Exception:
        pass
    finally:
        await safe_close()


# -----------------------------------------------------------------------------
# Compatibility routes (legacy TE2)


@router.get("/shell-logs/{shell_id}")
async def legacy_shell_logs(shell_id: str) -> RedirectResponse:
    return RedirectResponse(url=f"/fws/logs/{shell_id}", status_code=307)


@router.websocket("/ws/shell-logs/{shell_id}")
async def legacy_shell_logs_ws(websocket: WebSocket, shell_id: str):
    await fws_logs_ws(websocket, shell_id)
