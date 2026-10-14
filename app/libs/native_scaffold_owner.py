"""Private access to app-owned Python scaffold helpers; no MCP dependency."""
from __future__ import annotations
import asyncio
import hmac
from collections.abc import Callable
from typing import cast
import msgspec
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

class ValidateRequest(msgspec.Struct, forbid_unknown_fields=True):
    app_id: str

class ScaffoldRequest(msgspec.Struct, forbid_unknown_fields=True):
    app_id: str
    project_root: str
    command: str
    port: int
    name: str = ""
    description: str = ""
    start_path: str = "/"
    health_path: str = "/api/health"
    icon_src: str = ""
    icon_text: str = ""
    icon_emoji: str = ""
    readiness_timeout: float = 20.0
    socketio_enabled: bool = False
    socketio_inject_path: bool = False
    socketio_namespace_marker: str = ""
    env: dict[str, str] | None = None
    overwrite: bool = False

def scaffold_owner_routes(token: str, templates: Callable[[], object],
                          validate: Callable[[str], object], create: Callable[[dict[str, object]], object]) -> list[Route]:
    async def dispatch(request: Request) -> JSONResponse:
        if not token or not hmac.compare_digest(token.encode(), request.headers.get("x-te2-owner-key", "").encode()):
            return JSONResponse({"error":"scaffoldOwner.unauthorized"}, status_code=401)
        if request.url.path.endswith("/templates"):
            return JSONResponse({"templates":await asyncio.to_thread(templates)})
        body = bytearray()
        async for chunk in request.stream():
            if len(body)+len(chunk)>256*1024:
                return JSONResponse({"error":"scaffoldOwner.bodyTooLarge"}, status_code=413)
            body.extend(chunk)
        try:
            if request.url.path.endswith("/validate"):
                params = msgspec.json.decode(body,type=ValidateRequest)
                result = await asyncio.to_thread(validate,params.app_id)
            else:
                payload = msgspec.json.decode(body,type=ScaffoldRequest)
                builtins = cast(dict[str, object],msgspec.to_builtins(payload))
                builtins["env"] = payload.env or {}
                result = await asyncio.to_thread(create,builtins)
        except msgspec.DecodeError:
            return JSONResponse({"error":"scaffoldOwner.invalidRequest"}, status_code=400)
        return JSONResponse(result)
    return [Route("/internal/scaffold/templates",dispatch,methods=["GET"]),
            Route("/internal/scaffold/validate",dispatch,methods=["POST"]),
            Route("/internal/scaffold/create",dispatch,methods=["POST"])]
