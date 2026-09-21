# pyright: strict
"""Native ASGI composition for resources/health and the existing Socket.IO gateway."""
from pathlib import Path
from typing import cast

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.types import ASGIApp

from .monaco_editor.editor_asset_routes import build_editor_asset_routes

SOCKET_PATHS = (
    "/socket.io", "/editor_ws/socket.io", "/explorer_ws/socket.io",
    "/ui_ipc_ws/socket.io", "/terminal_ws/socket.io",
)


def build_code_te2_asgi_app(*, static_dir: Path, agent_icon_dir: Path, socket_app: ASGIApp) -> Starlette:
    async def status(_request: Request) -> JSONResponse:
        return JSONResponse({"ok": True, "data": {"message": "File Editor CM6 app API ready"}})

    async def serve_static(request: Request) -> FileResponse:
        base = static_dir.resolve()
        file = (base / cast(str, request.path_params["file_path"])).resolve()
        if not file.is_relative_to(base) or not file.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(file)

    async def serve_agent_icon(request: Request) -> FileResponse:
        name = cast(str, request.path_params["name"])
        safe = Path(name).name
        if not safe or safe != name:
            raise HTTPException(status_code=400, detail="Invalid icon name")
        file = agent_icon_dir / safe
        if not file.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(file)

    async def http_error(_request: Request, exc: Exception) -> JSONResponse:
        # Retain the previous JSON error contract (including Allow on 405),
        # without importing FastAPI's exception handlers or validation models.
        if not isinstance(exc, HTTPException):
            raise exc
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)

    routes = [
        Route("/", status, methods=["GET"]),
        Route("/status", status, methods=["GET"]),
        Route("/static/{file_path:path}", serve_static, methods=["GET"]),
        Route("/agent_icons/{name}", serve_agent_icon, methods=["GET"]),
    ]
    for route in routes:
        route.methods = {"GET"}  # Do not implicitly add HEAD during migration.

    # Keep one gateway instance across canonical/legacy physical paths. Mount
    # preserves the scope/root_path behavior used by the previous FastAPI app.
    # Lifecycle stays in app_worker; these mounts have no separate startup hooks.
    return Starlette(
        routes=[*routes, *build_editor_asset_routes(),
                *(Mount(path, app=socket_app) for path in SOCKET_PATHS)],
        exception_handlers={HTTPException: http_error},
    )
