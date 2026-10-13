"""Minimal explicit ASGI status surface for otherwise external proxy workers."""
from starlette.responses import JSONResponse
from starlette.types import Receive, Scope, Send
from .http import noop_lifespan


class StatusASGI:
    def __init__(self, message: str) -> None:
        self.message: str = message

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] == 'lifespan':
            await noop_lifespan(receive, send)
        elif scope['type'] == 'websocket':
            await send({'type': 'websocket.close', 'code': 1008})
        elif scope['type'] == 'http':
            if scope['path'] != '/':
                response = JSONResponse({'detail': 'Not Found'}, status_code=404)
            elif scope['method'] != 'GET':
                response = JSONResponse({'detail': 'Method Not Allowed'}, status_code=405, headers={'Allow': 'GET'})
            else:
                response = JSONResponse({'ok': True, 'data': {'message': self.message}})
            await response(scope, receive, send)
