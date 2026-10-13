"""Explicit File Explorer ASGI boundary, without FastAPI/schema introspection.

Domain functions remain transport-independent. Starlette response primitives
retain the established streaming/range/conditional-download implementation;
there is no Starlette application/router or Python HTTP client fallback here.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable, Mapping, MutableMapping
from urllib.parse import parse_qsl

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from app.libs.te2_asgi import asgi_bytes as _bytes, asgi_text as _string
from app.libs.te2_asgi import noop_lifespan, read_json_object, redirect_to, require_method, resolve_http_response
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
            await noop_lifespan(receive, send)
        elif scope['type'] == 'websocket':
            await send({'type': 'websocket.close', 'code': 1008})
        elif scope['type'] == 'http':
            response = await resolve_http_response(lambda: self._dispatch(scope, receive), logger=logger, error_message='File Explorer HTTP request failed')
            # Streaming errors after response start are not retried or replaced
            # with a second response. FileResponse owns download cancellation.
            if response is not None:
                await response(scope, receive, send)

    async def _dispatch(self, scope: Scope, receive: Receive) -> Response:
        path = _string(scope['path'])
        method = _string(scope['method'])
        known = self.paths
        if path not in known:
            if path.endswith('/') and path.rstrip('/') in known:
                # Match the previous router's slash normalization, including query.
                return redirect_to(scope, path.rstrip('/'))
            raise HTTPException(404, 'Not Found')
        expected_method = 'GET' if path in QUERY_ROUTES else 'POST'
        require_method(method, (expected_method,))
        if method == 'GET':
            query_params = dict(parse_qsl(_bytes(scope.get('query_string', b'')).decode('utf-8', errors='replace'), keep_blank_values=True))
            result = await self.query_handler(path, query_params)
        else:
            body = await self._body(scope, receive)
            result = await self.commands[path](body)
        return result if isinstance(result, Response) else JSONResponse(result)

    async def _body(self, scope: Scope, receive: Receive) -> dict[str, object]:
        body = await read_json_object(scope, receive, max_bytes=MAX_BODY_BYTES,
            empty='object' if scope['path'] in {'/sidebar/window/state', '/sidebar/window/open_url'} else 'reject',
            decoder=_decode_json)
        for field in STRING_FIELDS:
            if field in body and body[field] is not None and not isinstance(body[field], str):
                raise HTTPException(422, f'{field} must be a string')
        return body


def _decode_json(data: bytes | bytearray) -> object:
    # Retain the established stdlib decoder's encoding/number semantics. The
    # reusable mechanism defaults to msgspec, but does not impose DTO policy.
    return json.loads(data)
