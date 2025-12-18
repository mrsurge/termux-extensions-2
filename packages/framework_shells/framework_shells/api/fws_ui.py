from __future__ import annotations

import asyncio
import mimetypes
import os
import re
import signal
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiofiles
import fnmatch
from fastapi import APIRouter, Form, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
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


_CSS_COLOR_RE = re.compile(r"^[#()0-9a-zA-Z.,%\s-]+$")


def _safe_css_value(value: Any) -> str:
    s = "" if value is None else str(value).strip()
    if not s:
        return ""
    if not _CSS_COLOR_RE.match(s):
        return ""
    return s


def _collect_subgroup_styles(shells: List[Dict[str, Any]]) -> Dict[str, Dict[str, str]]:
    merged: Dict[str, Dict[str, str]] = {}
    for info in shells:
        ui = info.get("ui")
        if not isinstance(ui, dict):
            continue
        raw = ui.get("subgroup_styles") or ui.get("subgroupStyles")
        if not isinstance(raw, dict):
            continue
        for key, style in raw.items():
            if not isinstance(style, dict):
                continue
            bg = _safe_css_value(style.get("bg") or style.get("background"))
            border = _safe_css_value(style.get("border") or style.get("border_color") or style.get("borderColor"))
            color = _safe_css_value(style.get("color") or style.get("fg") or style.get("foreground"))
            normalized: Dict[str, str] = {}
            if bg:
                normalized["bg"] = bg
            if border:
                normalized["border"] = border
            if color:
                normalized["color"] = color
            if normalized:
                merged[str(key)] = normalized
    return merged


def _subgroup_style_for(name: str, styles: Dict[str, Dict[str, str]]) -> Dict[str, str]:
    if not name:
        return {}
    if name in styles:
        return styles.get(name, {})
    best_key: Optional[str] = None
    for pattern in styles.keys():
        if pattern == name:
            best_key = pattern
            break
        if any(ch in pattern for ch in "*?[]") and fnmatch.fnmatchcase(name, pattern):
            if best_key is None or len(pattern) > len(best_key):
                best_key = pattern
    if best_key is None:
        return {}
    return styles.get(best_key, {})


def _card_style_for_subgroups(subgroups: List[str], styles: Dict[str, Dict[str, str]]) -> Dict[str, str]:
    if not subgroups:
        return {}
    preferred = list(subgroups[1:]) + list(subgroups[:1])
    for subgroup in preferred:
        style = _subgroup_style_for(str(subgroup), styles)
        if style:
            return style
    return {}


def _render_subgroup_pills(subgroups: List[Any], styles: Dict[str, Dict[str, str]]) -> str:
    pills: List[str] = []
    for raw in subgroups:
        name = str(raw or "").strip()
        if not name:
            continue
        style = _subgroup_style_for(name, styles)
        css_bits: List[str] = []
        if style.get("bg"):
            css_bits.append(f"background: {style['bg']};")
        if style.get("border"):
            css_bits.append(f"border-color: {style['border']};")
        if style.get("color"):
            css_bits.append(f"color: {style['color']};")
        style_attr = f' style="{" ".join(css_bits)}"' if css_bits else ""
        pills.append(f'<span class="pill"{style_attr}>{_escape_html(name)}</span>')
    if not pills:
        return ""
    return '<div class="row">' + "".join(pills) + "</div>"


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
    subgroup_styles = _collect_subgroup_styles(described)

    parts: List[str] = []

    parts.append('<div class="section">')
    parts.append('<div class="section-title">Running <span class="muted">(%d)</span></div>' % len(running))

    if not running:
        parts.append('<div class="shell-card"><div class="shell-meta">No running shells.</div></div>')
    else:
        groups: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
        for s in running:
            subgroups = s.get("subgroups") if isinstance(s.get("subgroups"), list) else []
            normalized = [str(x) for x in subgroups if str(x).strip()]
            umbrella = normalized[0] if len(normalized) >= 1 else "(ungrouped)"
            subgroup = normalized[1] if len(normalized) >= 2 else "(root)"
            groups.setdefault(umbrella, {}).setdefault(subgroup, []).append(s)

        def _group_sort_key(name: str) -> Any:
            return (1, "") if name == "(ungrouped)" else (0, name.lower())

        def _subgroup_sort_key(name: str) -> Any:
            return (0, "") if name == "app-worker" else (1, name.lower())

        def _shell_sort_key(info: Dict[str, Any]) -> Any:
            label = str(info.get("label") or "")
            return (0 if label.startswith("app-worker:") else 1, label.lower(), str(info.get("id") or ""))

        for umbrella in sorted(groups.keys(), key=_group_sort_key):
            subgroup_map = groups.get(umbrella, {})
            total_shells = sum(len(v) for v in subgroup_map.values())

            parts.append('<div class="group-card">')
            parts.append('<div class="group-header">')
            parts.append('<div class="group-title">%s</div>' % _escape_html(umbrella))
            parts.append('<div class="shell-actions">')
            if umbrella != "(ungrouped)":
                parts.append(
                    f'<form method="post" action="/fws/action/app/{_escape_html(umbrella)}/shutdown">'
                    f'<button class="btn btn-small btn-danger" type="submit">Shutdown Group</button>'
                    f"</form>"
                )
            parts.append("</div>")
            parts.append("</div>")
            parts.append(
                '<div class="group-meta">Shells: %s · Subgroups: %s</div>'
                % (_escape_html(total_shells), _escape_html(len(subgroup_map)))
            )

            for subgroup in sorted(subgroup_map.keys(), key=_subgroup_sort_key):
                style = _subgroup_style_for(subgroup, subgroup_styles)
                style_bits: List[str] = []
                if style.get("bg"):
                    style_bits.append(f"background: {style['bg']};")
                if style.get("border"):
                    style_bits.append(f"border-color: {style['border']}; border-left: 4px solid {style['border']};")
                style_attr = f' style="{" ".join(style_bits)}"' if style_bits else ""

                shells_in_group = sorted(subgroup_map.get(subgroup, []), key=_shell_sort_key)
                parts.append(f'<div class="subgroup-card"{style_attr}>')
                parts.append('<div class="subgroup-header">')
                parts.append('<div class="subgroup-title">%s</div>' % _escape_html(subgroup))
                parts.append('<div class="subgroup-count muted">(%d)</div>' % len(shells_in_group))
                parts.append("</div>")

                for s in shells_in_group:
                    sid = str(s.get("id") or "")
                    label = str(s.get("label") or sid)
                    pid = s.get("pid")
                    backend = _shell_backend(s)
                    subgroups = s.get("subgroups") if isinstance(s.get("subgroups"), list) else []

                    row_style = _card_style_for_subgroups([str(x) for x in subgroups], subgroup_styles)
                    row_style_bits: List[str] = []
                    if row_style.get("bg"):
                        row_style_bits.append(f"background: {row_style['bg']};")
                    if row_style.get("border"):
                        row_style_bits.append(f"border-left: 3px solid {row_style['border']};")
                    row_style_attr = f' style="{" ".join(row_style_bits)}"' if row_style_bits else ""

                    parts.append(f'<div class="child-row"{row_style_attr}>')
                    parts.append('<div class="child-main">')
                    parts.append('<div class="child-label">%s</div>' % _escape_html(label))
                    parts.append(
                        '<div class="child-meta">PID: %s · ID: %s · %s</div>'
                        % (_escape_html(pid), _escape_html(sid), _escape_html(backend))
                    )
                    cmd = s.get("command") if isinstance(s.get("command"), list) else []
                    if cmd:
                        parts.append('<div class="child-meta">Cmd: %s</div>' % _escape_html(" ".join(map(str, cmd))))
                    pills = _render_subgroup_pills(subgroups, subgroup_styles)
                    if pills:
                        parts.append(pills)
                    parts.append("</div>")

                    parts.append('<div class="row">')
                    parts.append(f'<a class="btn btn-small" href="/fws/logs/{_escape_html(sid)}">Logs</a>')
                    parts.append(
                        f'<form method="post" action="/fws/action/shell/{_escape_html(sid)}/terminate">'
                        f'<button class="btn btn-small btn-danger" type="submit">Stop</button>'
                        f"</form>"
                    )
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

            parts.append("</div>")

    parts.append("</div>")

    parts.append('<div class="section">')
    parts.append('<div class="section-title">')
    parts.append('Exited <span class="muted">(%d)</span>' % len(exited))
    parts.append('<div class="shell-actions">')
    if exited:
        parts.append(
            '<form method="post" action="/fws/action/exited/purge" data-fws-ajax="1" '
            'data-confirm="Purge ALL exited shells (delete their logs + metadata)?">'
            '<button class="btn btn-small btn-danger" type="submit">Purge Exited</button>'
            "</form>"
        )
    parts.append("</div>")
    parts.append("</div>")
    if not exited:
        parts.append('<div class="shell-card"><div class="shell-meta">No exited shells.</div></div>')
    else:
        for s in sorted(exited, key=lambda x: x.get("label") or x.get("id") or ""):
            sid = str(s.get("id") or "")
            label = str(s.get("label") or sid)
            status = str(s.get("status") or "exited")
            exit_code = s.get("exit_code")
            subgroups = s.get("subgroups") if isinstance(s.get("subgroups"), list) else []
            style = _card_style_for_subgroups([str(x) for x in subgroups], subgroup_styles)
            style_bits: List[str] = []
            if style.get("bg"):
                style_bits.append(f"background: {style['bg']};")
            if style.get("border"):
                style_bits.append(f"border-color: {style['border']}; border-left: 4px solid {style['border']};")
            style_attr = f' style="{" ".join(style_bits)}"' if style_bits else ""
            meta = status
            if exit_code is not None:
                meta += f" · exit: {exit_code}"

            parts.append(f'<div class="shell-card"{style_attr}>')
            parts.append('<div class="shell-header">')
            parts.append('<div class="shell-title">%s</div>' % _escape_html(label))
            parts.append('<div class="shell-actions">')
            parts.append(f'<a class="btn btn-small" href="/fws/logs/{_escape_html(sid)}">Logs</a>')
            parts.append(
                f'<form method="post" action="/fws/action/shell/{_escape_html(sid)}/purge" data-fws-ajax="1">'
                f'<button class="btn btn-small" type="submit">Purge</button>'
                f"</form>"
            )
            parts.append("</div>")
            parts.append("</div>")
            parts.append('<div class="shell-meta">%s</div>' % _escape_html(meta))
            parts.append('<div class="shell-meta">ID: %s</div>' % _escape_html(sid))
            pills = _render_subgroup_pills(subgroups, subgroup_styles)
            if pills:
                parts.append(pills)
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

def _is_ajax(request: Request) -> bool:
    return (request.headers.get("x-fws-ajax") or "").strip() == "1"


async def _truncate_log_file(path: Path, *, logs_root: Path) -> bool:
    resolved = path.resolve(strict=False)
    if resolved.suffix != ".log":
        return False
    if logs_root != resolved and logs_root not in resolved.parents:
        return False
    try:
        if not resolved.exists() or not resolved.is_file():
            return False
        await asyncio.to_thread(lambda: resolved.open("wb").close())
        return True
    except Exception:
        return False


@router.post("/fws/action/logs/purge")
async def fws_purge_logs(request: Request) -> Response:
    mgr = await get_manager()
    shells = await mgr.list_shells()

    logs_root = Path(mgr.logs_dir).resolve(strict=False)
    candidates: List[Path] = []
    for rec in shells:
        candidates.append(Path(rec.stdout_log))
        candidates.append(Path(rec.stderr_log))

    try:
        candidates.extend(list(Path(mgr.logs_dir).glob("*.log")))
    except Exception:
        pass

    seen: set[Path] = set()
    for path in candidates:
        resolved = path.resolve(strict=False)
        if resolved in seen:
            continue
        seen.add(resolved)
        await _truncate_log_file(resolved, logs_root=logs_root)

    if _is_ajax(request):
        return Response(status_code=204)
    return RedirectResponse(url="/fws/", status_code=303)


@router.post("/fws/action/exited/purge")
async def fws_purge_exited(request: Request) -> Response:
    mgr = await get_manager()
    shells = await mgr.list_shells()
    exited = [s for s in shells if (getattr(s, "status", None) or "") == "exited"]
    for rec in exited:
        try:
            await mgr.remove_shell(rec.id, force=True)
        except Exception:
            pass
    if _is_ajax(request):
        return Response(status_code=204)
    return RedirectResponse(url="/fws/", status_code=303)


@router.post("/fws/action/shell/{shell_id}/terminate")
async def fws_terminate_shell(shell_id: str, request: Request) -> Response:
    mgr = await get_manager()
    await mgr.terminate_shell(shell_id, force=True)
    if _is_ajax(request):
        return Response(status_code=204)
    return RedirectResponse(url="/fws/", status_code=303)


@router.post("/fws/action/shell/{shell_id}/purge")
async def fws_purge_shell(shell_id: str, request: Request) -> Response:
    mgr = await get_manager()
    await mgr.remove_shell(shell_id, force=True)
    if _is_ajax(request):
        return Response(status_code=204)
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
                    await websocket.send_json({"type": "reset", "stream": "stdout"})

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
                    await websocket.send_json({"type": "reset", "stream": "stderr"})

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
