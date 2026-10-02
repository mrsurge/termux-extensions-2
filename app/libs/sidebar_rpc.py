"""Existing backend Sidebar state lane, shared by first-party stateful apps."""
from __future__ import annotations

import os
import uuid
from typing import cast
import socketio


async def call_sidebar_rpc(app_id: str, method: str, params: dict[str, object], *, timeout: float = 5) -> dict[str, object]:
    if not app_id.strip() or not method.strip():
        raise ValueError('Sidebar RPC app and method are required')
    timeout = max(1, int(timeout))
    client = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
    url = os.environ.get('TE_FRAMEWORK_URL') or f"http://127.0.0.1:{os.environ.get('TE_PORT', '8089')}"
    try:
        await client.connect(url.rstrip('/'), namespaces=['/sidebar_ipc'],
            socketio_path='api/app/code_te2/socket.io', transports=['websocket', 'polling'])
        await client.call('rpc', {'jsonrpc': '2.0', 'id': uuid.uuid4().hex,
            'method': 'sidebar.register', 'params': {'role': 'iframe', 'app': app_id,
                'client_id': f'{app_id}:backend:{os.getpid()}', 'capabilities': ['sidebar.windows']}},
            namespace='/sidebar_ipc', timeout=timeout)
        raw: object = await client.call('rpc', {'jsonrpc': '2.0', 'id': uuid.uuid4().hex,
            'method': method, 'params': params}, namespace='/sidebar_ipc', timeout=timeout)
        if not isinstance(raw, dict):
            raise ValueError('Sidebar RPC response must be an object')
        response = cast(dict[str, object], raw)
        if response.get('error') is not None:
            raise RuntimeError(str(response['error']))
        result = response.get('result')
        if not isinstance(result, dict):
            raise ValueError('Sidebar RPC result must be an object')
        return cast(dict[str, object], result)
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass
