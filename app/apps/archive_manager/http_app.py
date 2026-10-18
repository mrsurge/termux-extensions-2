"""Explicit Archive Manager routes using neutral TE2 ASGI primitives."""
from __future__ import annotations

import asyncio
import logging
from urllib.parse import parse_qsl

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.types import Receive, Scope, Send

from app.libs.te2_asgi import noop_lifespan, read_json_object, redirect_to, require_method, resolve_http_response

MAX_BODY_BYTES = 1024 * 1024
ROUTES = {"/ping": "GET", "/browse": "GET", "/archives/launch": "POST", "/archives/extract": "POST", "/archives/create": "POST", "/archives/test": "POST"}
logger = logging.getLogger(__name__)


def _query_bool(query: dict[str, str], name: str) -> bool:
    value = query.get(name, "false").lower()
    if value not in {"1", "true", "on", "yes", "0", "false", "off", "no"}:
        raise HTTPException(422, f"{name} must be a boolean")
    return value in {"1", "true", "on", "yes"}


class ArchiveManagerASGI:
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await noop_lifespan(receive, send)
        elif scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
        elif scope["type"] == "http":
            response = await resolve_http_response(lambda: self._dispatch(scope, receive), logger=logger, error_message="Archive Manager HTTP request failed")
            if response is not None:
                await response(scope, receive, send)

    async def _dispatch(self, scope: Scope, receive: Receive) -> Response:
        from . import backend

        original = scope["path"]
        if original == '/jobs' or original.startswith('/jobs/'):
            return await backend.JOBS.dispatch(scope, receive)
        path = original.rstrip("/")
        expected = ROUTES.get(path)
        if expected is None:
            raise HTTPException(404, "Not Found")
        if original != path:
            return redirect_to(scope, path)
        require_method(scope["method"], (expected,))
        result: object
        if path == "/ping":
            result = backend.ping()
        elif path == "/browse":
            query = dict(parse_qsl(scope.get("query_string", b"").decode("utf-8", errors="replace"), keep_blank_values=True))
            # FastAPI previously offloaded sync handlers. Retain that scheduling
            # explicitly so archive scans/filesystem calls do not block ASGI.
            result = await asyncio.to_thread(backend.browse,
                path=query.get("path", "~"), internal=query.get("internal", ""),
                hidden=_query_bool(query, "hidden"), archive=_query_bool(query, "archive"))
        else:
            body = await read_json_object(scope, receive, max_bytes=MAX_BODY_BYTES)
            handler = {"/archives/launch": backend.launch_archive,
                "/archives/extract": backend.extract_archive,
                "/archives/create": backend.create_archive,
                "/archives/test": backend.test_archive}[path]
            result = await asyncio.to_thread(handler, body)
        return JSONResponse(result)
