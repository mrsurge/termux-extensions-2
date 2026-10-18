"""Typed, explicit File Editor transport; domain and path policy live in main."""
from __future__ import annotations

import logging
from urllib.parse import parse_qsl

import msgspec
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.types import Receive, Scope, Send
from app.libs.te2_asgi import HTTPError as FileEditorError
from app.libs.te2_asgi import noop_lifespan, read_json_object, redirect_to, require_method, resolve_http_response

# Includes JSON escaping overhead for large editable documents. Read responses
# retain their existing unrestricted size; this is only an ingress bound.
MAX_BODY_BYTES = 32 * 1024 * 1024
logger = logging.getLogger(__name__)


class WriteRequest(msgspec.Struct, kw_only=True):
    path: str
    content: str


class FileEditorASGI:
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await noop_lifespan(receive, send)
        elif scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
        elif scope["type"] == "http":
            response = await resolve_http_response(lambda: self._dispatch(scope, receive), logger=logger, error_message="File Editor HTTP request failed")
            if response is not None:
                await response(scope, receive, send)

    async def _dispatch(self, scope: Scope, receive: Receive) -> Response:
        from . import main

        original = scope["path"]
        path = original.rstrip("/") or "/"
        routes = {"/": "GET", "/read": "GET", "/write": "POST", "/sidebar/window/state": "POST"}
        expected = routes.get(path)
        if expected is None:
            raise HTTPException(404, "Not Found")
        if original != path:
            return redirect_to(scope, path)
        require_method(scope["method"], (expected,))
        result: object
        if path == "/":
            result = await main.status()
        elif path == "/read":
            query_params = dict(parse_qsl(scope.get("query_string", b"").decode("utf-8", errors="replace"), keep_blank_values=True))
            if "path" not in query_params:
                raise HTTPException(422, "path is required")
            result = await main.read_file(query_params["path"])
        else:
            body = await self._body(scope, receive)
            if path == "/write":
                try:
                    request = msgspec.convert(body, type=WriteRequest)
                except msgspec.ValidationError as exc:
                    raise HTTPException(422, str(exc)) from exc
                result = await main.write_file(request.path, request.content)
            else:
                for name in ("host_id", "token_id", "console_worker_id", "file"):
                    if name in body and not isinstance(body[name], str):
                        raise HTTPException(422, f"{name} must be a string")
                result = await main.publish_sidebar_file_state(body)
        return JSONResponse(result)

    async def _body(self, scope: Scope, receive: Receive) -> dict[str, object]:
        return await read_json_object(scope, receive, max_bytes=MAX_BODY_BYTES)
