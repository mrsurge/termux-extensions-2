"""App-owned ASGI routing; no FastAPI router or request-model engine."""
from __future__ import annotations

import logging
from typing import cast
from urllib.parse import parse_qsl

import msgspec
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.types import Receive, Scope, Send
from starlette.websockets import WebSocket

from .request_dtos import CreateShellRequest, ShellActionRequest, ShellInputRequest, ShellResizeRequest, decode_request

MAX_BODY_BYTES = 1024 * 1024
logger = logging.getLogger(__name__)


class TerminalASGI:
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        from . import backend

        path = scope.get("path", "")
        if scope["type"] == "lifespan":
            # The generic worker owns listener-ready hooks and worker services.
            # Socket.IO's existing mount has no application lifespan callbacks.
            while True:
                event = await receive()
                if event["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif event["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        elif path == "/socket.io" or path.startswith("/socket.io/"):
            await backend.TERMINAL_LIFECYCLE_ASGI_APP(scope, receive, send)
        elif scope["type"] == "websocket":
            if path == "/ws/terminal":
                await backend.terminal_ws(WebSocket(scope, receive, send))
            else:
                await send({"type": "websocket.close", "code": 1008})
        elif scope["type"] == "http":
            try:
                response = await self._dispatch(scope, receive)
            except HTTPException as exc:
                response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
            except ConnectionAbortedError:
                return
            except Exception:
                logger.exception("Terminal HTTP request failed")
                response = Response("Internal Server Error", status_code=500)
            await response(scope, receive, send)

    async def _dispatch(self, scope: Scope, receive: Receive) -> Response:
        from . import backend

        original_path = scope["path"]
        path = original_path[:-1] if original_path.endswith("/") else original_path
        parts = path.removeprefix("/").split("/")
        shell_id = parts[1] if len(parts) >= 2 and parts[0] == "shells" else ""
        action = parts[2] if len(parts) == 3 else ""
        methods: tuple[str, ...]
        if path == "/sidebar/cwd":
            methods = ("GET",)
        elif path == "/sidebar/window/state":
            methods = ("POST",)
        elif path == "/shells":
            methods = ("GET", "POST")
        elif shell_id and len(parts) == 2:
            methods = ("GET", "DELETE")
        elif shell_id and len(parts) == 3 and action in {"input", "resize", "action"}:
            methods = ("POST",)
        else:
            raise HTTPException(404, "Not Found")
        if original_path != path:
            query = scope.get("query_string", b"").decode("latin-1")
            target = scope.get("root_path", "") + path.rstrip("/")
            return RedirectResponse(target + ("?" + query if query else ""), status_code=307)
        method = scope["method"]
        if method not in methods:
            raise HTTPException(405, "Method Not Allowed", headers={"Allow": ", ".join(methods)})
        result: object
        if method == "GET":
            if path == "/sidebar/cwd":
                result = await backend.get_sidebar_cwd()
            elif path == "/shells":
                result = await backend.list_shells()
            else:
                query_params = dict(parse_qsl(scope.get("query_string", b"").decode("utf-8", errors="replace"), keep_blank_values=True))
                try:
                    tail = int(query_params.get("tail", "0"))
                    raw_logs = query_params.get("logs", "false").lower()
                    if raw_logs not in {"1", "0", "true", "false", "on", "off", "yes", "no"}:
                        raise ValueError("logs must be boolean")
                except ValueError as exc:
                    raise HTTPException(422, str(exc)) from exc
                result = await backend.get_shell(shell_id, tail=tail, logs=raw_logs in {"1", "true", "on", "yes"})
        elif method == "DELETE":
            result = await backend.delete_shell(shell_id)
        else:
            body = await self._body(scope, receive, optional=path == "/sidebar/window/state")
            try:
                if path == "/sidebar/window/state":
                    result = await backend.publish_sidebar_window_state(body)
                elif path == "/shells":
                    result = await backend.create_shell(decode_request(body, CreateShellRequest))
                elif action == "input":
                    result = await backend.send_input(shell_id, decode_request(body, ShellInputRequest))
                elif action == "resize":
                    result = await backend.resize_shell(shell_id, decode_request(body, ShellResizeRequest))
                else:
                    result = await backend.shell_action(shell_id, decode_request(body, ShellActionRequest))
            except msgspec.ValidationError as exc:
                raise HTTPException(422, str(exc)) from exc
        return JSONResponse(result)

    async def _body(self, scope: Scope, receive: Receive, *, optional: bool) -> dict[str, object] | None:
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
        data = bytearray()
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                raise ConnectionAbortedError()
            if event["type"] != "http.request":
                raise HTTPException(400, "Invalid request body event")
            data.extend(event.get("body", b""))
            if len(data) > MAX_BODY_BYTES:
                raise HTTPException(413, "Request body too large")
            if not event.get("more_body", False):
                break
        if optional and not data:
            return None
        try:
            value: object = msgspec.json.decode(data)
        except msgspec.DecodeError as exc:
            raise HTTPException(422, "Invalid JSON body") from exc
        if optional and value is None:
            return None
        if not isinstance(value, dict):
            raise HTTPException(422, "Request body must be an object")
        return cast(dict[str, object], value)
