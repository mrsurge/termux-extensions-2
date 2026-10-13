"""Typed, explicit File Editor transport; domain and path policy live in main."""
from __future__ import annotations

import logging
from typing import cast
from urllib.parse import parse_qsl

import msgspec
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.types import Receive, Scope, Send

# Includes JSON escaping overhead for large editable documents. Read responses
# retain their existing unrestricted size; this is only an ingress bound.
MAX_BODY_BYTES = 32 * 1024 * 1024
logger = logging.getLogger(__name__)


class FileEditorError(Exception):
    """Preserve the app's structured error detail without an untyped framework."""
    def __init__(self, status_code: int, detail: object) -> None:
        super().__init__(str(detail))
        self.status_code: int = status_code
        self.detail: object = detail
        self.headers: dict[str, str] | None = None


class WriteRequest(msgspec.Struct, kw_only=True):
    path: str
    content: str


class FileEditorASGI:
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            while True:
                event = await receive()
                if event["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif event["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        elif scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
        elif scope["type"] == "http":
            try:
                response = await self._dispatch(scope, receive)
            except (HTTPException, FileEditorError) as exc:
                response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
            except ConnectionAbortedError:
                return
            except Exception:
                logger.exception("File Editor HTTP request failed")
                response = Response("Internal Server Error", status_code=500)
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
            query = scope.get("query_string", b"").decode("latin-1")
            target = scope.get("root_path", "") + path
            return RedirectResponse(target + ("?" + query if query else ""), status_code=307)
        if scope["method"] != expected:
            raise HTTPException(405, "Method Not Allowed", headers={"Allow": expected})
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
        headers = dict(scope.get("headers", []))
        length = headers.get(b"content-length")
        if length is not None:
            try:
                size = int(length)
            except ValueError as exc:
                raise HTTPException(400, "Invalid Content-Length") from exc
            if size < 0:
                raise HTTPException(400, "Invalid Content-Length")
            if size > MAX_BODY_BYTES:
                raise HTTPException(413, "Request body too large")
        content_type = headers.get(b"content-type", b"application/json").split(b";", 1)[0].strip().lower()
        if content_type != b"application/json" and not content_type.endswith(b"+json"):
            raise HTTPException(422, "Request body must be JSON")
        body = bytearray()
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                raise ConnectionAbortedError()
            if event["type"] != "http.request":
                raise HTTPException(400, "Invalid request body event")
            chunk = event.get("body", b"")
            if len(body) + len(chunk) > MAX_BODY_BYTES:
                raise HTTPException(413, "Request body too large")
            body.extend(chunk)
            if not event.get("more_body", False):
                break
        try:
            value: object = msgspec.json.decode(body)
        except msgspec.DecodeError as exc:
            raise HTTPException(422, "Invalid JSON body") from exc
        if not isinstance(value, dict):
            raise HTTPException(422, "Request body must be an object")
        return cast(dict[str, object], value)
