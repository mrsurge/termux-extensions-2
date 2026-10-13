"""Small typed helpers without route introspection or framework/app imports."""
from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, MutableMapping, Sequence
from logging import Logger
from typing import Literal, cast

import msgspec
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, RedirectResponse, Response

Message = MutableMapping[str, object]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
JsonDecoder = Callable[[bytes | bytearray], object]
EmptyBody = Literal["decode", "reject", "object"]


class HTTPError(Exception):
    """Typed status/detail envelope, including structured app-specific detail."""
    def __init__(self, status_code: int, detail: object, *, headers: Mapping[str, str] | None = None) -> None:
        super().__init__(str(detail))
        self.status_code: int = status_code
        self.detail: object = detail
        self.headers: Mapping[str, str] | None = headers


def asgi_text(value: object) -> str:
    if not isinstance(value, str):
        raise HTTPException(400, "Invalid ASGI text field")
    return value


def asgi_bytes(value: object) -> bytes:
    if not isinstance(value, bytes):
        raise HTTPException(400, "Invalid ASGI bytes field")
    return value


def require_method(method: str, allowed: Sequence[str]) -> None:
    if method not in allowed:
        raise HTTPException(405, "Method Not Allowed", headers={"Allow": ", ".join(allowed)})


def redirect_to(scope: Mapping[str, object], path: str) -> RedirectResponse:
    """Caller decides which paths redirect; retain mount root and original query."""
    query = asgi_bytes(scope.get("query_string", b"")).decode("latin-1")
    target = asgi_text(scope.get("root_path", "")) + path
    return RedirectResponse(target + ("?" + query if query else ""), status_code=307)


async def noop_lifespan(receive: Receive, send: Send) -> None:
    """Only for apps without startup/shutdown work; never replaces worker hooks."""
    while True:
        event = await receive()
        if event["type"] == "lifespan.startup":
            await send({"type": "lifespan.startup.complete"})
        elif event["type"] == "lifespan.shutdown":
            await send({"type": "lifespan.shutdown.complete"})
            return


async def resolve_http_response(
    dispatch: Callable[[], Awaitable[Response]], *, logger: Logger, error_message: str,
) -> Response | None:
    """Catch dispatch errors only. Caller transmits/streams the returned response.

    No send() occurs here: exceptions after response start must propagate without
    retrying a mutation or emitting another status/header block.
    """
    try:
        return await dispatch()
    except (HTTPException, HTTPError) as exc:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
    except ConnectionAbortedError:
        return None
    except Exception:
        logger.exception(error_message)
        return Response("Internal Server Error", status_code=500)


async def _read_body(scope: Mapping[str, object], receive: Receive, max_bytes: int) -> bytearray:
    if max_bytes < 0:
        raise ValueError("Body limit cannot be negative")
    headers = dict(cast(Sequence[tuple[bytes, bytes]], scope.get("headers", [])))
    length = headers.get(b"content-length")
    if length is not None:
        try:
            size = int(length)
        except ValueError as exc:
            raise HTTPException(400, "Invalid Content-Length") from exc
        if size < 0:
            raise HTTPException(400, "Invalid Content-Length")
        if size > max_bytes:
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
        chunk = asgi_bytes(event.get("body", b""))
        if len(data) + len(chunk) > max_bytes:
            raise HTTPException(413, "Request body too large")
        data.extend(chunk)
        if not event.get("more_body", False):
            return data


def _decode_json(data: bytes | bytearray) -> object:
    return msgspec.json.decode(data)


def _decode(data: bytearray, decoder: JsonDecoder) -> object:
    try:
        return decoder(data)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise HTTPException(422, "Invalid JSON body") from exc


def _object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise HTTPException(422, "Request body must be an object")
    raw = cast(Mapping[object, object], value)
    if any(not isinstance(key, str) for key in raw):
        raise HTTPException(422, "Object keys must be strings")
    return cast(dict[str, object], value)


async def read_json_object(
    scope: Mapping[str, object], receive: Receive, *, max_bytes: int,
    empty: EmptyBody = "decode", decoder: JsonDecoder = _decode_json,
) -> dict[str, object]:
    data = await _read_body(scope, receive, max_bytes)
    if not data:
        if empty == "object":
            return {}
        if empty == "reject":
            raise HTTPException(422, "Request body is required")
    return _object(_decode(data, decoder))


async def read_optional_json_object(
    scope: Mapping[str, object], receive: Receive, *, max_bytes: int,
    decoder: JsonDecoder = _decode_json,
) -> dict[str, object] | None:
    data = await _read_body(scope, receive, max_bytes)
    if not data:
        return None
    value = _decode(data, decoder)
    return None if value is None else _object(value)
