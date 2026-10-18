"""Explicit Aria routes; generic app-worker owns serving and readiness."""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from urllib.parse import parse_qsl

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.types import Receive, Scope, Send

from app.libs.te2_asgi import noop_lifespan, read_json_object, redirect_to, require_method, resolve_http_response

MAX_BODY_BYTES = 1024 * 1024
ROUTES = {"/": "GET", "/status": "GET", "/downloads": "GET", "/add": "POST",
          "/control": "POST", "/settings": "POST", "/shells": "GET", "/shell": "GET",
          "/shell/spawn": "POST", "/shell/action": "POST"}
logger = logging.getLogger(__name__)


class AriaDownloaderASGI:
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await noop_lifespan(receive, send)
        elif scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
        elif scope["type"] == "http":
            response = await resolve_http_response(lambda: self._dispatch(scope, receive),
                logger=logger, error_message="Aria Downloader HTTP request failed")
            if response is not None:
                await response(scope, receive, send)

    async def _dispatch(self, scope: Scope, receive: Receive) -> Response:
        from . import main

        original = scope["path"]
        path = original.rstrip("/") or "/"
        method = ROUTES.get(path)
        if method is None:
            raise HTTPException(404, "Not Found")
        if original != path:
            return redirect_to(scope, path)
        require_method(scope["method"], (method,))
        result: object
        sync_get: dict[str, Callable[[], main.JsonObject]] = {
            "/": main.root_status, "/status": main.status, "/downloads": main.downloads,
        }
        sync_post: dict[str, Callable[[main.JsonObject], main.JsonObject]] = {
            "/add": main.add_download, "/control": main.control, "/settings": main.settings,
        }
        if path in sync_get:
            result = await asyncio.to_thread(sync_get[path])
        elif path == "/shells":
            result = await main.list_framework_shells()
        elif path == "/shell":
            query = dict(parse_qsl(scope.get("query_string", b"").decode("utf-8", errors="replace"), keep_blank_values=True))
            logs = query.get("logs", "false").lower()
            if logs not in {"1", "true", "yes", "on", "0", "false", "no", "off"}:
                raise HTTPException(422, "logs must be a boolean")
            try:
                tail = int(query.get("tail", str(main.DEFAULT_LOG_TAIL_LINES)))
            except ValueError as exc:
                raise HTTPException(422, "tail must be an integer") from exc
            result = await main.get_tracked_shell(logs in {"1", "true", "yes", "on"}, tail)
        else:
            # Keep the previous stdlib JSON decoding semantics; request objects
            # and per-command field checks are owned by this app, not schemas.
            body = await read_json_object(scope, receive, max_bytes=MAX_BODY_BYTES, decoder=json.loads)
            if path in sync_post:
                result = await asyncio.to_thread(sync_post[path], body)
            elif path == "/shell/spawn":
                result = await main.spawn_shell(body)
            else:
                result = await main.shell_action(body)
        return JSONResponse(result)
