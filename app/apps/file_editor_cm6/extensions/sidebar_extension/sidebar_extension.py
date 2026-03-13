from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Body, Request, Response
from fastapi.responses import JSONResponse

# Hardcoded imports for now; these will be dynamically wired by the extensions
# loader once app-level extensions are formalized.
from .sidebar_state import enqueue_open_request, pop_open_request, record_drawer_open, update_ui_hints
from ...explorer_helper import get_project_root
from ...explorer_ws import manager as _explorer_manager
from ...stores import get_history_store

bp = APIRouter()

# NOTE(TE2-sidebar-ws): Legacy HTTP sidebar endpoints are kept for compatibility,
# but all `/agent/*` routes in this file are MARKED FOR DELETION after the
# Socket.IO sidebar/appserver transport migration is complete.

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


def _resolve_open_target(payload: dict, project_root: Path) -> tuple[Path, str]:
    rel = payload.get("rel")
    raw_abs = payload.get("path") or payload.get("abs") or payload.get("file")

    if isinstance(rel, str):
        rel = rel.strip()
    else:
        rel = ""

    if isinstance(raw_abs, str):
        raw_abs = raw_abs.strip()
    else:
        raw_abs = ""

    if rel:
        # Resolve relative to project root.
        rel_path = rel.lstrip("/")
        target = (project_root / rel_path).expanduser().resolve(strict=False)
    elif raw_abs:
        target = Path(raw_abs).expanduser()
        # Try logical path first, then resolved — tolerates symlinked project roots.
        rel = ""
        for proj_candidate, tgt_candidate in [
            (project_root, target),
            (project_root.resolve(strict=False), target.resolve(strict=False)),
        ]:
            try:
                rel = str(tgt_candidate.relative_to(proj_candidate))
                target = tgt_candidate
                break
            except ValueError:
                continue
    else:
        raise ValueError("missing path (expected rel or path/abs/file)")

    # Enforce that target stays within the active project root.
    # Check both logical and resolved paths for symlink tolerance.
    inside = False
    for proj_candidate, tgt_candidate in [
        (project_root, target),
        (project_root.resolve(strict=False), target.resolve(strict=False)),
    ]:
        try:
            tgt_candidate.relative_to(proj_candidate)
            inside = True
            break
        except ValueError:
            continue
    if not inside:
        raise PermissionError("path is outside active project root")

    if target.is_dir():
        raise IsADirectoryError("target is a directory")
    if not target.exists():
        raise FileNotFoundError("target does not exist")

    return target, rel


# MARKED FOR DELETION: replace with sidebar/appserver Socket.IO transport.
@bp.post("/agent/drawer/open")
async def agent_drawer_open(payload: dict = Body(default=None)):
    payload = payload or {}
    source = payload.get("source") if isinstance(payload, dict) else None
    data = record_drawer_open(source)
    return {"ok": True, "data": data}


# MARKED FOR DELETION: replace with sidebar/appserver Socket.IO transport.
@bp.post("/agent/drawer/ui_hints")
async def agent_drawer_ui_hints(payload: dict = Body(default=None)):
    payload = payload or {}
    hints = payload if isinstance(payload, dict) else {}
    data = update_ui_hints(hints)
    return {"ok": True, "data": data}


# MARKED FOR DELETION: replace with sidebar/appserver Socket.IO transport.
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


# MARKED FOR DELETION: replace with sidebar/appserver Socket.IO transport.
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


# MARKED FOR DELETION: replace with sidebar/appserver Socket.IO transport.
@bp.options("/agent/open_request")
async def agent_open_request_options(request: Request):
    origin = _cors_origin(request)
    headers = _cors_headers(origin)
    if origin:
        headers.update({
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
        })
    return Response(status_code=204, headers=headers)


# MARKED FOR DELETION: replace with sidebar/appserver Socket.IO transport.
@bp.post("/agent/open_request")
async def agent_open_request(request: Request, payload: dict = Body(default=None)):
    origin = _cors_origin(request)
    headers = _cors_headers(origin)
    try:
        payload = payload or {}
        data = enqueue_open_request(payload if isinstance(payload, dict) else {})
        return JSONResponse({"ok": True, "data": data}, headers=headers)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500, headers=headers)


# MARKED FOR DELETION: replace with sidebar/appserver Socket.IO transport.
@bp.get("/agent/open_request/next")
async def agent_open_request_next(request: Request):
    origin = _cors_origin(request)
    headers = _cors_headers(origin)
    data = pop_open_request()
    if not data:
        return Response(status_code=204, headers=headers)
    return JSONResponse({"ok": True, "data": data}, headers=headers)


# MARKED FOR DELETION: replace with sidebar/appserver Socket.IO transport.
@bp.options("/agent/open")
async def agent_open_options(request: Request):
    origin = _cors_origin(request)
    headers = _cors_headers(origin)
    if origin:
        headers.update({
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
        })
    return Response(status_code=204, headers=headers)


# MARKED FOR DELETION: replace with sidebar/appserver Socket.IO transport.
@bp.post("/agent/open")
async def agent_open(request: Request, payload: dict = Body(default=None)):
    """Request the host UI to open a file at a specific location.

    This is delivered to the active file_editor_cm6 page via the Explorer Socket.IO transport
    (separate from NiceGUI), avoiding postMessage and polling.
    """
    origin = _cors_origin(request)
    headers = _cors_headers(origin)
    payload = payload or {}
    if not isinstance(payload, dict):
        payload = {}
    try:
        history = get_history_store()
        project = history.get_active_project() or str(get_project_root())
        if not project:
            return JSONResponse({"ok": False, "error": "no active project"}, status_code=409, headers=headers)

        project_root = Path(project).expanduser()
        if not project_root.exists() and not project_root.resolve(strict=False).exists():
            return JSONResponse({"ok": False, "error": "active project root does not exist"}, status_code=409, headers=headers)

        try:
            target_abs, target_rel = _resolve_open_target(payload, project_root)
        except FileNotFoundError as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=404, headers=headers)
        except IsADirectoryError as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=400, headers=headers)
        except PermissionError as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=403, headers=headers)
        except Exception as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=400, headers=headers)

        line = payload.get("line")
        column = payload.get("column")
        message_payload = {
            "rel": target_rel,
            "path": str(target_abs),
            "line": line,
            "column": column,
            "source": payload.get("source"),
            "conversation_id": payload.get("conversation_id"),
        }
        message = {"type": "agent:open", "payload": message_payload}
        await _explorer_manager.broadcast(str(project), message)
        return JSONResponse(
            {"ok": True, "data": {"rel": target_rel, "path": str(target_abs), "line": line, "column": column}},
            headers=headers,
        )
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500, headers=headers)
