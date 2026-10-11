"""Binary terminal input/output; tab/control authority stays on /tabs."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from urllib.parse import parse_qsl

from .terminal_stream_protocol import pack_message, unpack_message
from .http_app import Scope, Receive, Send


class OutputConnection:
    def __init__(self, sid: str, tab_id: str, shell_id: str) -> None:
        self.sid: str = sid
        self.tab_id: str = tab_id
        self.shell_id: str = shell_id
        self.queue: asyncio.Queue[tuple[bytes, int] | None] = asyncio.Queue(maxsize=64)
        self.bytes: int = 0
        self.closed: bool = False

    def put(self, payload: dict[str, object], *, checkpoint: bool = False) -> None:
        if self.closed: return
        frame = pack_message(payload)
        if self.queue.full() or (not checkpoint and self.bytes + len(frame) > 1024 * 1024):
            self.close()
            return
        size = 0 if checkpoint else len(frame)
        self.bytes += size
        self.queue.put_nowait((frame, size))

    def close(self) -> None:
        self.closed = True
        while not self.queue.empty():
            _ = self.queue.get_nowait()
        self.bytes = 0
        self.queue.put_nowait(None)

    async def write(self, send: Send) -> None:
        while True:
            item = await self.queue.get()
            if item is None: return
            frame, size = item
            self.bytes -= size
            await asyncio.wait_for(send({'type': 'websocket.send', 'bytes': frame}), 5)


Attach = Callable[[dict[str, object], OutputConnection], Awaitable[None]]
Detach = Callable[[OutputConnection], None]
Input = Callable[[OutputConnection, bytes], Awaitable[None]]


async def serve_output(scope: Scope, receive: Receive, send: Send,
                       attach: Attach, detach: Detach, input_handler: Input | None = None) -> None:
    connection = OutputConnection('', '', '')
    writer: asyncio.Task[None] | None = None
    reader: asyncio.Task[None] | None = None
    try:
        event = await asyncio.wait_for(receive(), 10)
        if event['type'] != 'websocket.connect': return
        query = scope.get('query_string', b'')
        if not isinstance(query, bytes) or dict(parse_qsl(query.decode('ascii'))).get('codec') != 'msgpack-v1':
            await send({'type': 'websocket.close', 'code': 1008})
            return
        await send({'type': 'websocket.accept'})
        event = await asyncio.wait_for(receive(), 10)
        raw = event.get('bytes')
        if event['type'] != 'websocket.receive' or not isinstance(raw, bytes) or len(raw) > 65536:
            raise ValueError('Binary MessagePack attach required')
        request = unpack_message(raw)
        if request.get('type') != 'attach': raise ValueError('First frame must attach')
        await attach(request, connection)
        writer = asyncio.create_task(connection.write(send))
        reader = asyncio.create_task(receive_input(receive, connection, input_handler))
        _ = await asyncio.wait({writer, reader}, return_when=asyncio.FIRST_COMPLETED)
        for task in (writer, reader):
            if task.done(): task.result()
    except (ValueError, UnicodeError, TimeoutError, RuntimeError, OSError):
        # Fail closed; never reinterpret a text/JSON frame or retry mutations.
        pass
    finally:
        detach(connection)
        connection.close()
        tasks = [task for task in (writer, reader) if task is not None]
        for task in tasks: _ = task.cancel()
        _ = await asyncio.gather(*tasks, return_exceptions=True)
        try:
            await send({'type': 'websocket.close', 'code': 1000})
        except (RuntimeError, OSError):
            pass  # Peer already disconnected; no retained shell is stopped.


async def receive_input(receive: Receive, connection: OutputConnection, handler: Input | None) -> None:
    while True:
        event = await receive()
        if event['type'] == 'websocket.disconnect': return
        raw = event.get('bytes')
        if connection.closed or handler is None or event['type'] != 'websocket.receive' or not isinstance(raw, bytes) or len(raw) > 65536:
            raise ValueError('Expected bounded binary terminal input')
        frame = unpack_message(raw)
        data = frame.get('data')
        if frame.get('type') != 'input' or not isinstance(data, bytes) or not 0 < len(data) <= 4096:
            raise ValueError('Invalid terminal input')
        # One reader preserves ingress order without a browser ACK round trip.
        await asyncio.wait_for(handler(connection, data), 5)
