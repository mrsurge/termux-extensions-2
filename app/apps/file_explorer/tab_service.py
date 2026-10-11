# pyright: strict, reportMissingTypeStubs=false
"""Own serialized tab mutations and backend-selected Socket.IO rooms."""
from __future__ import annotations

import asyncio
import logging
import secrets
from collections.abc import Awaitable, Callable
from typing import Protocol, cast

import socketio  # type: ignore[import-untyped]
from starlette.exceptions import HTTPException

from .http_app import Scope, Receive, Send
from .tab_store import TabStore, object_map, options, text
from .terminal_service import TerminalService
from .terminal_stream import OutputConnection, serve_output
from .terminal_stream_protocol import pack_message, unpack_message
from .usage_service import Job, UsageService

NAMESPACE = '/tabs'


class SocketServer(Protocol):
    def on(self, event: str, handler: object, *, namespace: str) -> object: ...
    async def enter_room(self, sid: str, room: str, *, namespace: str) -> None: ...
    async def leave_room(self, sid: str, room: str, *, namespace: str) -> None: ...
    async def emit(self, event: str, data: object, *, room: str,
                   skip_sid: str | None = None, namespace: str) -> None: ...


class ASGIApplication(Protocol):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None: ...


class ShellEvent(Protocol):
    def to_dict(self) -> dict[str, object]: ...


class ShellBus(Protocol):
    def subscribe(self) -> asyncio.Queue[ShellEvent]: ...
    def unsubscribe(self, queue: asyncio.Queue[ShellEvent]) -> None: ...


def shell_bus() -> ShellBus:
    from framework_shells.events import get_event_bus
    return cast(ShellBus, cast(object, get_event_bus()))


class TabService:
    def __init__(self, store: TabStore, server: SocketServer,
                 resolve_path: Callable[[object], str],
                 project_path: Callable[[], Awaitable[str]]) -> None:
        self.store: TabStore = store
        self.server: SocketServer = server
        self.resolve_path: Callable[[object], str] = resolve_path
        self.project_path: Callable[[], Awaitable[str]] = project_path
        self.lock: asyncio.Lock = asyncio.Lock()
        self.presentations: dict[str, str] = {}
        self.attached: dict[str, str] = {}
        self.terminals: TerminalService = TerminalService(store)
        self.terminals.brokers.sink = self.broker_event
        self.observer: asyncio.Task[None] | None = None
        self.directory_states: dict[str, tuple[str, str]] = {}
        self.stream_grants: dict[str, tuple[str, str, str]] = {}
        self.streams: set[OutputConnection] = set()
        self.usage = UsageService(self.usage_event)
        _ = server.on('connect', self.wire_connect, namespace=NAMESPACE)
        _ = server.on('disconnect', self.disconnect, namespace=NAMESPACE)
        _ = server.on('tab_request', self.wire_request, namespace=NAMESPACE)

    async def wire_connect(self, sid: str, environ: object, auth: object = None) -> bool:
        try:
            fields = object_map(auth)
            if fields.get('codec') != 'msgpack-v1': return False
            return await self.connect(sid, environ, fields)
        except ValueError:
            return False

    async def wire_request(self, sid: str, payload: object) -> bytes:
        identity: int | None = None
        try:
            if not isinstance(payload, bytes) or len(payload) > 65536:
                raise ValueError('Binary MessagePack request required')
            body = unpack_message(payload)
            raw_id = body.get('id')
            if not isinstance(raw_id, int) or isinstance(raw_id, bool) or not 0 < raw_id <= 9007199254740991:
                raise ValueError('Invalid request id')
            identity = raw_id
            reply = await self.request(sid, body)
        except ValueError as exc:
            reply = {'ok': False, 'error': str(exc)}
        return pack_message({'id': identity, **reply})

    def drop_streams(self, sid: str) -> None:
        for token, grant in list(self.stream_grants.items()):
            if grant[0] == sid: del self.stream_grants[token]
        for stream in list(self.streams):
            if stream.sid == sid: stream.close()

    async def attach_stream(self, request: dict[str, object], connection: OutputConnection) -> None:
        async with self.lock:
            grant = self.stream_grants.pop(text(request.get('token')), None)
            if grant is None: raise ValueError('Stream authorization expired')
            sid, tab_id, shell_id = grant
            tab = self.store.get(tab_id)
            if sid not in self.presentations or self.attached.get(sid) != tab_id or tab is None or tab['shellId'] != shell_id:
                raise ValueError('Stream tab changed')
            connection.sid, connection.tab_id, connection.shell_id = sid, tab_id, shell_id
            result = await self.terminals.dispatch(tab, 'terminal.checkpoint', request)
            if sid not in self.presentations or self.attached.get(sid) != tab_id:
                raise ValueError('Stream presentation disconnected')
            # Broker output publication uses this same lock. Queue the checkpoint
            # before admitting subsequent output; older queued deltas are offset-fenced.
            connection.put({'type': 'checkpoint', 'tabId': tab_id, **result}, checkpoint=True)
            self.streams.add(connection)

    def detach_stream(self, connection: OutputConnection) -> None:
        self.streams.discard(connection)

    async def stream_input(self, connection: OutputConnection, data: bytes) -> None:
        async with self.lock:
            tab = self.store.get(connection.tab_id)
            if (connection.closed or connection not in self.streams
                    or connection.sid not in self.presentations
                    or self.attached.get(connection.sid) != connection.tab_id
                    or tab is None or tab['shellId'] != connection.shell_id):
                raise ValueError('Terminal stream identity changed')
            await self.terminals.dispatch(tab, 'terminal.input', {'data': data.decode('utf8')})

    def close_shell_streams(self, shell_id: str) -> None:
        for stream in self.streams:
            if stream.shell_id == shell_id: stream.close()

    def observe(self) -> None:
        self.terminals.brokers.sink = self.broker_event
        if self.observer is None:
            bus = shell_bus()
            queue = bus.subscribe()
            self.observer = asyncio.create_task(self._observe(bus, queue))
            # Also runs if shutdown cancels before the coroutine first enters.
            self.observer.add_done_callback(lambda _task: bus.unsubscribe(queue))

    async def shutdown(self) -> None:
        await self.usage.shutdown()
        for stream in self.streams: stream.close()
        self.stream_grants.clear()
        await self.terminals.brokers.shutdown()
        if self.observer is not None:
            _ = self.observer.cancel()
            _ = await asyncio.gather(self.observer, return_exceptions=True)
            self.observer = None

    async def _observe(self, bus: ShellBus, queue: asyncio.Queue[ShellEvent]) -> None:
        try:
            while True:
                event = await queue.get()
                # Events are wakeups only; raw log offsets/bytes remain authority.
                events = [event.to_dict()]
                for _ in range(min(queue.qsize(), 255)):
                    events.append(queue.get_nowait().to_dict())
                shells = {str(item.get('shell_id')) for item in events
                          if item.get('type') in ('shell.exited', 'shell.removed')}
                for shell_id in shells:
                    try:
                        await self.shell_changed(shell_id)
                    except Exception:
                        logging.getLogger(__name__).exception('Terminal observation failed for %s', shell_id)
                        await self.server.emit('terminal_reset', {'shellId': shell_id}, room='tab-catalog', namespace=NAMESPACE)
        finally:
            bus.unsubscribe(queue)

    async def shell_changed(self, shell_id: str) -> None:
        async with self.lock:
            for tab in self.store.snapshot():
                if tab['shellId'] != shell_id:
                    continue
                current = await self.terminals.reconcile(tab)
                room = 'tab:' + tab['id']
                if current != tab:
                    self.close_shell_streams(shell_id)
                    _ = self.directory_states.pop(shell_id, None)
                    await self.server.emit('tab_snapshot', {'tab': current}, room=room, namespace=NAMESPACE)
                    await self.server.emit('tab_catalog', {'changed': True}, room='tab-catalog', namespace=NAMESPACE)
                    continue
                prior_tracking = self.directory_states.get(shell_id)
                # Reconcile retained status on lifecycle events. Live control
                # status/output is delivered by the separate broker reader.
                if prior_tracking is None or prior_tracking[0] in ('pending', 'starting'):
                    tracking = self.terminals.directory_status(current)
                    observed = (tracking['state'], tracking['path'])
                    if prior_tracking != observed:
                        self.directory_states[shell_id] = observed
                        await self.server.emit('terminal_directory', {'tabId': tab['id'], 'shellId': shell_id,
                            'directoryTracking': tracking}, room=room, namespace=NAMESPACE)

    async def broker_event(self, shell_id: str, event: dict[str, object]) -> None:
        async with self.lock:
            for tab in self.store.snapshot():
                if tab['shellId'] != shell_id: continue
                room = 'tab:' + tab['id']
                if event.get('type') == 'output':
                    for stream in list(self.streams):
                        if stream.tab_id == tab['id'] and stream.shell_id == shell_id:
                            stream.put({**event, 'tabId': tab['id'], 'shellId': shell_id})
                elif event.get('type') == 'directory':
                    tracking = self.terminals.directory_status(tab)
                    await self.server.emit('terminal_directory', {'tabId': tab['id'], 'shellId': shell_id,
                        'directoryTracking': tracking}, room=room, namespace=NAMESPACE)
                else:
                    for stream in self.streams:
                        if stream.shell_id == shell_id: stream.close()
                    await self.server.emit('terminal_reset', {'shellId': shell_id}, room=room, namespace=NAMESPACE)

    async def connect(self, sid: str, _environ: object, auth: object = None) -> bool:
        try:
            body = object_map(auth)
            presentation = text(body.get('presentationId'))
            if len(presentation) > 128:
                return False
            self.presentations[sid] = presentation
            return True
        except ValueError:
            return False

    async def disconnect(self, sid: str, _reason: object = None) -> None:
        self.usage.cancel(sid)
        self.drop_streams(sid)
        _ = self.presentations.pop(sid, None)
        _ = self.attached.pop(sid, None)

    async def _attach(self, sid: str, tab_id: str) -> None:
        self.usage.cancel(sid)
        self.drop_streams(sid)
        await self.server.enter_room(sid, 'tab-catalog', namespace=NAMESPACE)
        previous = self.attached.pop(sid, None)
        if previous:
            await self.server.leave_room(sid, 'tab:' + previous, namespace=NAMESPACE)
        if tab_id:
            await self.server.enter_room(sid, 'tab:' + tab_id, namespace=NAMESPACE)
            self.attached[sid] = tab_id

    async def request(self, sid: str, payload: object) -> dict[str, object]:
        try:
            if sid not in self.presentations:
                raise ValueError('Presentation is disconnected')
            body = object_map(payload)
            method = text(body.get('method'))
            params = object_map(body.get('params', {}))
            # CWD lookup is read-only and outside the store lock.
            if method == 'tabs.defaultPath':
                path = await self.project_path()
                return {'ok': True, 'result': {'path': path}}
            if method in ('directoryUsage.start', 'directoryUsage.cancel'):
                if set(params) != {'scanId'}:
                    raise ValueError('Expected only scanId')
                scan_id = text(params.get('scanId'))
                if len(scan_id) > 128 or not all(char.isascii() and (char.isalnum() or char in '-_.:') for char in scan_id):
                    raise ValueError('Invalid scan identity')
                async with self.lock:
                    if sid not in self.presentations:
                        raise ValueError('Presentation is disconnected')
                    if method == 'directoryUsage.cancel':
                        return {'ok': True, 'result': {'scanId': scan_id,
                            'cancelled': self.usage.cancel(sid, scan_id)}}
                    tab_id = self.attached.get(sid)
                    tab = self.store.get(tab_id) if tab_id else None
                    if tab is None:
                        raise ValueError('Attach before requesting directory usage')
                    job = self.usage.prepare(sid, tab['id'], tab['path'], scan_id)
                # Start admission/pipe timeout never holds the tab mutation lock.
                return {'ok': True, 'result': await self.usage.start(job)}
            async with self.lock:
                if sid not in self.presentations:
                    raise ValueError('Presentation is disconnected')
                result = await self._dispatch(sid, method, params)
                return {'ok': True, 'result': result}
        except (ValueError, OSError, RuntimeError, HTTPException) as exc:
            return {'ok': False, 'error': str(exc)}
        except Exception:
            logging.getLogger(__name__).exception('File Explorer tab request failed')
            return {'ok': False, 'error': 'Tab operation failed; no retry performed'}

    async def usage_event(self, job: Job, update: dict[str, object]) -> None:
        async with self.lock:
            tab = self.store.get(job.tab_id)
            if (self.usage.jobs.get(job.sid) is not job or job.sid not in self.presentations
                    or self.attached.get(job.sid) != job.tab_id or tab is None or tab['path'] != job.path):
                self.usage.cancel(job.sid, job.scan_id)
                return
            await self.server.emit('directory_usage', {**update, 'tabId': job.tab_id},
                                   room=job.sid, namespace=NAMESPACE)

    async def _dispatch(self, sid: str, method: str, params: dict[str, object]) -> dict[str, object]:
        if method in ('tabs.list', 'tabs.catalog'):
            if method == 'tabs.list':
                await self._attach(sid, '')
            else:
                await self.server.enter_room(sid, 'tab-catalog', namespace=NAMESPACE)
            return {'tabs': self.store.snapshot()}
        if method == 'tabs.create':
            operation = text(params.get('operationId'))
            if len(operation) > 128:
                raise ValueError('Creation identity too long')
            self.store.load()
            prior = self.store.creations.get(operation)
            if prior and self.store.get(prior) is None:
                await self._attach(sid, '')
                return {'tab': None}
            path = self.resolve_path(params.get('path'))
            tab = self.store.create(operation, path, options(params.get('options', {})))
            await self._attach(sid, tab['id'])
            await self.server.emit('tab_catalog', {'changed': True}, room='tab-catalog', namespace=NAMESPACE)
            return {'tab': tab}
        tab_id = text(params.get('tabId'))
        if method == 'tabs.attach':
            existing = self.store.get(tab_id)
            if existing is not None:
                if existing['shellId'] is not None:
                    self.observe()
                previous = existing
                existing = await self.terminals.reconcile(existing)
                if existing != previous:
                    await self.server.emit('tab_snapshot', {'tab': existing}, room='tab:' + tab_id, skip_sid=sid, namespace=NAMESPACE)
                    await self.server.emit('tab_catalog', {'changed': True}, room='tab-catalog', namespace=NAMESPACE)
            await self._attach(sid, tab_id if existing else '')
            return {'tab': existing}
        revision = params.get('revision')
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise ValueError('Expected tab revision')
        if method == 'terminal.stream':
            stream_tab = self.store.get(tab_id)
            if self.attached.get(sid) != tab_id or stream_tab is None or stream_tab['revision'] != revision or stream_tab['shellId'] is None:
                raise ValueError('Attach and resync before streaming')
            self.drop_streams(sid)
            token = secrets.token_urlsafe(32)
            self.stream_grants[token] = (sid, tab_id, stream_tab['shellId'])
            return {'token': token, 'shellId': stream_tab['shellId']}
        if method in ('terminal.start', 'terminal.status', 'terminal.close', 'terminal.input', 'terminal.resize', 'terminal.checkpoint', 'terminal.directoryLock'):
            selected = self.store.get(tab_id)
            if self.attached.get(sid) != tab_id or selected is None or selected['revision'] != revision:
                raise ValueError('Attach and resync before terminal operations')
            self.observe()
            result = await self.terminals.dispatch(selected, method, params)
            current = self.store.get(tab_id)
            if selected['shellId'] is not None and (current is None or current['shellId'] != selected['shellId']):
                self.close_shell_streams(selected['shellId'])
                _ = self.directory_states.pop(selected['shellId'], None)
            if method == 'terminal.directoryLock' and current is not None and current['shellId'] is not None:
                _ = self.directory_states.pop(current['shellId'], None)
            if current != selected:
                await self.server.emit('tab_snapshot', {'tab': current}, room='tab:' + tab_id, skip_sid=sid, namespace=NAMESPACE)
                await self.server.emit('tab_catalog', {'changed': True}, room='tab-catalog', namespace=NAMESPACE)
            return result
        if method == 'tabs.update':
            if self.attached.get(sid) != tab_id:
                raise ValueError('Attach before updating this tab')
            before_navigation = self.store.get(tab_id)
            tab = self.store.update(tab_id, revision, self.resolve_path(params.get('path')),
                                    options(params.get('options')))
            if before_navigation is not None and before_navigation['path'] != tab['path']:
                for peer, attached in list(self.attached.items()):
                    if attached == tab_id:
                        self.usage.cancel(peer)
            if before_navigation is not None and before_navigation['path'] != tab['path'] and tab['shellId'] is not None:
                try:
                    tracking = await self.terminals.track_navigation(tab)
                except (ValueError, OSError, RuntimeError, TimeoutError):
                    tracking = {'state': 'error', 'path': tab['path']}
                self.directory_states[tab['shellId']] = (tracking['state'], tracking['path'])
                await self.server.emit('terminal_directory', {'tabId': tab_id, 'shellId': tab['shellId'],
                    'directoryTracking': tracking}, room='tab:' + tab_id, namespace=NAMESPACE)
            await self.server.emit('tab_snapshot', {'tab': tab}, room='tab:' + tab_id,
                                   skip_sid=sid, namespace=NAMESPACE)
            await self.server.emit('tab_catalog', {'changed': True}, room='tab-catalog', namespace=NAMESPACE)
            return {'tab': tab}
        if method == 'tabs.close':
            selected = self.store.get(tab_id)
            if selected is None or selected['revision'] != revision:
                raise ValueError('Tab revision changed; resync before closing')
            if selected['shellId'] is not None and params.get('closeTerminal') is True:
                _ = await self.terminals.dispatch(selected, 'terminal.close', {})
                current = self.store.get(tab_id)
                if current is None:
                    raise ValueError('Tab disappeared')
                revision = current['revision']
            self.store.close(tab_id, revision)
            await self.server.emit('tab_snapshot', {'tab': None, 'closedId': tab_id},
                                   room='tab:' + tab_id, namespace=NAMESPACE)
            for peer, attached in list(self.attached.items()):
                if attached == tab_id:
                    await self._attach(peer, '')
            await self.server.emit('tab_catalog', {'changed': True}, room='tab-catalog', namespace=NAMESPACE)
            return {'closedId': tab_id}
        raise ValueError('Unsupported tab method')


def compose_tabs(http: ASGIApplication, store: TabStore,
                 resolve_path: Callable[[object], str],
                 project_path: Callable[[], Awaitable[str]]) -> tuple[ASGIApplication, TabService]:
    # One checked external-library boundary; typed domain/service contains no Any.
    server = cast(SocketServer, socketio.AsyncServer(async_mode='asgi',
        cors_allowed_origins='*', max_http_buffer_size=65536,
        transports=['websocket'], allow_upgrades=False))
    service = TabService(store, EncodedServer(server), resolve_path, project_path)
    async def routes(scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] == 'websocket' and scope['path'] == '/ws/terminal':
            await serve_output(scope, receive, send, service.attach_stream, service.detach_stream, service.stream_input)
        else:
            await http(scope, receive, send)
    application = cast(ASGIApplication, socketio.ASGIApp(server, other_asgi_app=routes,
                                                       socketio_path='socket.io', on_shutdown=service.shutdown))
    return application, service


class EncodedServer:
    """Serialize only at the wire seam, retaining typed domain/test DTOs."""
    def __init__(self, server: SocketServer) -> None:
        self.server: SocketServer = server
    def on(self, event: str, handler: object, *, namespace: str) -> object:
        return self.server.on(event, handler, namespace=namespace)
    async def enter_room(self, sid: str, room: str, *, namespace: str) -> None:
        await self.server.enter_room(sid, room, namespace=namespace)
    async def leave_room(self, sid: str, room: str, *, namespace: str) -> None:
        await self.server.leave_room(sid, room, namespace=namespace)
    async def emit(self, event: str, data: object, *, room: str,
                   skip_sid: str | None = None, namespace: str) -> None:
        await self.server.emit(event, pack_message(object_map(data)), room=room,
                               skip_sid=skip_sid, namespace=namespace)
