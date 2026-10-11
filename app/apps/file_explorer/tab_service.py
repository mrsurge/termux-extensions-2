# pyright: strict, reportMissingTypeStubs=false
"""Own serialized tab mutations and backend-selected Socket.IO rooms."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Protocol, cast

import socketio  # type: ignore[import-untyped]
from starlette.exceptions import HTTPException

from .http_app import Scope, Receive, Send
from .tab_store import TabStore, object_map, options, text
from .terminal_service import TerminalService

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
        _ = server.on('connect', self.connect, namespace=NAMESPACE)
        _ = server.on('disconnect', self.disconnect, namespace=NAMESPACE)
        _ = server.on('tab_request', self.request, namespace=NAMESPACE)

    def observe(self) -> None:
        self.terminals.brokers.sink = self.broker_event
        if self.observer is None:
            bus = shell_bus()
            queue = bus.subscribe()
            self.observer = asyncio.create_task(self._observe(bus, queue))
            # Also runs if shutdown cancels before the coroutine first enters.
            self.observer.add_done_callback(lambda _task: bus.unsubscribe(queue))

    async def shutdown(self) -> None:
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
                    await self.server.emit('terminal_output', {**event, 'tabId': tab['id'], 'shellId': shell_id}, room=room, namespace=NAMESPACE)
                elif event.get('type') == 'directory':
                    tracking = self.terminals.directory_status(tab)
                    await self.server.emit('terminal_directory', {'tabId': tab['id'], 'shellId': shell_id,
                        'directoryTracking': tracking}, room=room, namespace=NAMESPACE)
                else:
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
        _ = self.presentations.pop(sid, None)
        _ = self.attached.pop(sid, None)

    async def _attach(self, sid: str, tab_id: str) -> None:
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
        if method in ('terminal.start', 'terminal.status', 'terminal.close', 'terminal.input', 'terminal.resize', 'terminal.checkpoint', 'terminal.directoryLock'):
            selected = self.store.get(tab_id)
            if self.attached.get(sid) != tab_id or selected is None or selected['revision'] != revision:
                raise ValueError('Attach and resync before terminal operations')
            self.observe()
            result = await self.terminals.dispatch(selected, method, params)
            current = self.store.get(tab_id)
            if selected['shellId'] is not None and (current is None or current['shellId'] != selected['shellId']):
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
    service = TabService(store, server, resolve_path, project_path)
    application = cast(ASGIApplication, socketio.ASGIApp(server, other_asgi_app=http,
                                                       socketio_path='socket.io', on_shutdown=service.shutdown))
    return application, service
