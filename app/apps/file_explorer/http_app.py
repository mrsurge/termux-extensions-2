"""Explicit File Explorer ASGI boundary, without FastAPI/schema introspection.

Domain functions remain transport-independent. Starlette response primitives
retain the established streaming/range/conditional-download implementation;
there is no Starlette application/router or Python HTTP client fallback here.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable, Mapping, MutableMapping
from typing import cast
from urllib.parse import parse_qsl

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, RedirectResponse, Response
Scope = MutableMapping[str, object]
Message = MutableMapping[str, object]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

QueryHandler = Callable[[str, dict[str, str]], Awaitable[object]]
CommandHandler = Callable[[dict[str, object]], Awaitable[object]]
MAX_BODY_BYTES = 1024 * 1024
QUERY_ROUTES = frozenset({'/list', '/download', '/resolve_symlink', '/properties'})
STRING_FIELDS = frozenset({'path', 'name', 'source', 'dest', 'directory', 'user', 'group',
    'host_id', 'hostId', 'token_id', 'tokenId', 'console_worker_id', 'consoleWorkerId'})
logger = logging.getLogger(__name__)


class FileExplorerHTTP:
    def __init__(self, *, query_handler: QueryHandler, commands: Mapping[str, CommandHandler]) -> None:
        self.query_handler: QueryHandler = query_handler
        self.commands: dict[str, CommandHandler] = dict(commands)
        # Construct once: mypyc's frozenset | dict_keys specialization returns
        # a set on this toolchain, violating its inferred frozenset result.
        self.paths: frozenset[str] = frozenset(list(QUERY_ROUTES) + list(self.commands))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] == 'lifespan':
            while True:
                event = await receive()
                if event['type'] == 'lifespan.startup':
                    await send({'type': 'lifespan.startup.complete'})
                elif event['type'] == 'lifespan.shutdown':
                    await send({'type': 'lifespan.shutdown.complete'})
                    return
        elif scope['type'] == 'websocket':
            await send({'type': 'websocket.close', 'code': 1008})
        elif scope['type'] == 'http':
            try:
                response = await self._dispatch(scope, receive)
            except HTTPException as exc:
                response = JSONResponse({'detail': exc.detail}, status_code=exc.status_code, headers=exc.headers)
            except ConnectionAbortedError:
                return  # A disconnected request never reaches a mutation handler.
            except Exception:
                logger.exception('File Explorer HTTP request failed')
                response = Response('Internal Server Error', status_code=500)
            # Streaming errors after response start are not retried or replaced
            # with a second response. FileResponse owns download cancellation.
            await response(scope, receive, send)

    async def _dispatch(self, scope: Scope, receive: Receive) -> Response:
        path = _string(scope['path'])
        method = _string(scope['method'])
        known = self.paths
        if path not in known:
            if path.endswith('/') and path.rstrip('/') in known:
                # Match the previous router's slash normalization, including query.
                query = _bytes(scope.get('query_string', b'')).decode('latin-1')
                target = _string(scope.get('root_path', '')) + path.rstrip('/')
                return RedirectResponse(target + ('?' + query if query else ''), status_code=307)
            raise HTTPException(404, 'Not Found')
        expected_method = 'GET' if path in QUERY_ROUTES else 'POST'
        if method != expected_method:
            raise HTTPException(405, 'Method Not Allowed', headers={'Allow': expected_method})
        if method == 'GET':
            query_params = dict(parse_qsl(_bytes(scope.get('query_string', b'')).decode('utf-8', errors='replace'), keep_blank_values=True))
            result = await self.query_handler(path, query_params)
        else:
            body = await self._body(scope, receive)
            result = await self.commands[path](body)
        return result if isinstance(result, Response) else JSONResponse(result)

    async def _body(self, scope: Scope, receive: Receive) -> dict[str, object]:
        headers = dict(cast(list[tuple[bytes, bytes]], scope.get('headers', [])))
        length = headers.get(b'content-length')
        if length is not None:
            try:
                size = int(length)
            except ValueError as exc:
                raise HTTPException(400, 'Invalid Content-Length') from exc
            if size < 0:
                raise HTTPException(400, 'Invalid Content-Length')
            if size > MAX_BODY_BYTES:
                raise HTTPException(413, 'Request body too large')
        content_type = headers.get(b'content-type', b'application/json').split(b';', 1)[0].strip().lower()
        if content_type != b'application/json' and not content_type.endswith(b'+json'):
            raise HTTPException(422, 'Request body must be JSON')
        data = bytearray()
        while True:
            event = await receive()
            if event['type'] == 'http.disconnect':
                raise ConnectionAbortedError()
            if event['type'] != 'http.request':
                raise HTTPException(400, 'Invalid request body event')
            chunk = _bytes(event.get('body', b''))
            if len(data) + len(chunk) > MAX_BODY_BYTES:
                raise HTTPException(413, 'Request body too large')
            data.extend(chunk)
            if not event.get('more_body', False):
                break
        try:
            if not data and scope['path'] not in {'/sidebar/window/state', '/sidebar/window/open_url'}:
                raise HTTPException(422, 'Request body is required')
            value: object = json.loads(data) if data else {}
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise HTTPException(422, 'Invalid JSON body') from exc
        if not isinstance(value, dict):
            raise HTTPException(422, 'Request body must be an object')
        raw = cast(Mapping[object, object], value)
        if any(not isinstance(key, str) for key in raw):
            raise HTTPException(422, 'Object keys must be strings')
        body: dict[str, object] = {str(key): item for key, item in raw.items()}
        for field in STRING_FIELDS:
            if field in body and body[field] is not None and not isinstance(body[field], str):
                raise HTTPException(422, f'{field} must be a string')
        return body


def _string(value: object) -> str:
    if not isinstance(value, str):
        raise HTTPException(400, 'Invalid ASGI text field')
    return value


def _bytes(value: object) -> bytes:
    if not isinstance(value, bytes):
        raise HTTPException(400, 'Invalid ASGI bytes field')
    return value
