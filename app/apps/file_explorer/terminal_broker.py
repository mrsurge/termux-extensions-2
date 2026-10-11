"""Live pipe adapter for the shared Terminal broker; no FastAPI or log replay."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import Protocol, cast
from uuid import uuid4

from app.apps.terminal.terminal_stream_protocol import PipeFrameDecoder, encode_pipe_message


class PipeProcess(Protocol):
    stdin: asyncio.StreamWriter | None


class PipeState(Protocol):
    process: PipeProcess
    stdin_supported: bool


class PipeManager(Protocol):
    def get_pipe_state(self, shell_id: str) -> PipeState | None: ...
    async def subscribe_output_bytes(self, shell_id: str) -> asyncio.Queue[bytes | None]: ...
    async def unsubscribe_output_bytes(self, shell_id: str, queue: asyncio.Queue[bytes | None]) -> None: ...


EventSink = Callable[[str, dict[str, object]], Awaitable[None]]


class BrokerSession:
    def __init__(self, shell_id: str, manager: PipeManager, queue: asyncio.Queue[bytes | None],
                 sink: EventSink) -> None:
        self.shell_id: str = shell_id
        self.manager: PipeManager = manager
        self.queue: asyncio.Queue[bytes | None] = queue
        self.sink: EventSink = sink
        self.offset: int = 0
        self.sequence: int = -1
        self.status: dict[str, object] = {'state': 'starting', 'path': ''}
        self.pending: dict[str, asyncio.Future[dict[str, object]]] = {}
        self.write_lock: asyncio.Lock = asyncio.Lock()
        self.events: asyncio.Queue[dict[str, object]] = asyncio.Queue(maxsize=64)
        self.event_bytes: int = 0
        self.closed: bool = False
        self.reader: asyncio.Task[None] = asyncio.create_task(self._read())
        self.publisher: asyncio.Task[None] = asyncio.create_task(self._publish())

    async def send(self, message: Mapping[str, object]) -> None:
        if self.closed:
            raise RuntimeError('Terminal broker disconnected')
        frame = encode_pipe_message(message)
        async with self.write_lock:
            state = self.manager.get_pipe_state(self.shell_id)
            if state is None or not state.stdin_supported or state.process.stdin is None:
                raise RuntimeError('Terminal broker has no live stdin pipe')
            writer = state.process.stdin
            if writer.is_closing():
                raise RuntimeError('Terminal broker stdin is closed')
            writer.write(frame)
            await writer.drain()

    async def request(self, message: dict[str, object]) -> dict[str, object]:
        if len(self.pending) >= 16:
            raise RuntimeError('Terminal broker request limit exceeded')
        identity = uuid4().hex
        future: asyncio.Future[dict[str, object]] = asyncio.get_running_loop().create_future()
        self.pending[identity] = future
        try:
            await self.send({**message, 'request_id': identity})
            return await asyncio.wait_for(future, 5)
        finally:
            _ = self.pending.pop(identity, None)

    def _event(self, message: dict[str, object]) -> None:
        data = message.get('data')
        size = len(data) if isinstance(data, bytes) else 0
        if self.events.full() or self.event_bytes + size > 1024 * 1024:
            while not self.events.empty():
                _ = self.events.get_nowait()
            self.event_bytes = 0
            self.events.put_nowait({'type': 'reset'})
            if size > 1024 * 1024:
                return
        self.event_bytes += size
        self.events.put_nowait(message)

    async def _publish(self) -> None:
        while True:
            message = await self.events.get()
            data = message.get('data')
            if isinstance(data, bytes): self.event_bytes -= len(data)
            try:
                await self.sink(self.shell_id, message)
            except Exception:
                # Next output gap/checkpoint reconciles presentation. Never stall
                # the control reader behind a disconnected/slow frontend.
                continue

    async def _read(self) -> None:
        decoder = PipeFrameDecoder()
        try:
            while True:
                chunk = await self.queue.get()
                if chunk is None: break
                for message in decoder.push(chunk):
                    kind = message.get('type')
                    if kind == 'output':
                        sequence, data = message.get('sequence'), message.get('data')
                        if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0 or not isinstance(data, bytes):
                            raise ValueError('Invalid terminal broker output')
                        if self.sequence >= 0 and sequence != self.sequence + 1:
                            self._event({'type': 'reset'})
                        self.sequence = sequence
                        before = self.offset
                        self.offset += len(data)
                        self._event({'type': 'output', 'data': data, 'startOffset': before, 'endOffset': self.offset})
                    elif kind == 'checkpoint':
                        message['outputOffset'] = self.offset
                        sequence = message.get('sequence')
                        if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0:
                            raise ValueError('Invalid terminal broker checkpoint sequence')
                        self.sequence = sequence
                        tracking = message.get('directoryTracking')
                        if isinstance(tracking, dict):
                            fields = cast(Mapping[object, object], tracking)
                            self.status = {str(key): value for key, value in fields.items()}
                    elif kind in ('directory.result', 'shell.state'):
                        if kind == 'directory.result':
                            state = message.get('state')
                            # superseded/cancelled results cannot replace the
                            # current authoritative pending/settled status.
                            if state not in ('superseded', 'cancelled'):
                                self.status = {'state': state, 'path': message.get('cwd', message.get('path', ''))}
                        elif message.get('state') == 'unsupported':
                            self.status = {'state': 'unavailable', 'path': ''}
                        elif self.status.get('state') == 'starting':
                            self.status = {'state': 'ready', 'path': message.get('cwd', '')}
                        self._event({'type': 'directory', 'directoryTracking': dict(self.status)})
                    elif kind in ('exit', 'error'):
                        self._event({'type': 'reset'})
                    identity = message.get('request_id')
                    if isinstance(identity, str) and kind in ('checkpoint', 'pong', 'directory.result', 'error'):
                        future = self.pending.get(identity)
                        if future is not None and not future.done():
                            if kind == 'error': future.set_exception(RuntimeError(str(message.get('message', 'Terminal broker error'))))
                            else: future.set_result(message)
        except asyncio.CancelledError:
            raise
        except Exception:
            self._event({'type': 'reset'})
        finally:
            self.closed = True
            for future in self.pending.values():
                if not future.done(): future.set_exception(RuntimeError('Terminal broker disconnected'))

    async def close(self) -> None:
        _ = self.reader.cancel()
        _ = self.publisher.cancel()
        _ = await asyncio.gather(self.reader, self.publisher, return_exceptions=True)
        await self.manager.unsubscribe_output_bytes(self.shell_id, self.queue)


class BrokerSessions:
    def __init__(self) -> None:
        self.sessions: dict[str, BrokerSession] = {}
        self.sink: EventSink = self._ignore

    async def _ignore(self, _shell_id: str, _event: dict[str, object]) -> None:
        pass

    async def get(self, shell_id: str, manager: PipeManager) -> BrokerSession:
        current = self.sessions.get(shell_id)
        if current is not None:
            if current.closed: raise RuntimeError('Terminal broker disconnected; resync terminal state')
            return current
        queue = await manager.subscribe_output_bytes(shell_id)
        session = BrokerSession(shell_id, manager, queue, self._emit)
        self.sessions[shell_id] = session
        return session

    async def _emit(self, shell_id: str, event: dict[str, object]) -> None:
        await self.sink(shell_id, event)

    async def discard(self, shell_id: str) -> None:
        session = self.sessions.pop(shell_id, None)
        if session is not None: await session.close()

    async def shutdown(self) -> None:
        for shell_id in list(self.sessions): await self.discard(shell_id)
