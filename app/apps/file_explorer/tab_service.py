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

NAMESPACE = '/tabs'


class SocketServer(Protocol):
    def on(self, event: str, handler: object, *, namespace: str) -> object: ...
    async def enter_room(self, sid: str, room: str, *, namespace: str) -> None: ...
    async def leave_room(self, sid: str, room: str, *, namespace: str) -> None: ...
    async def emit(self, event: str, data: object, *, room: str,
                   skip_sid: str | None = None, namespace: str) -> None: ...


class ASGIApplication(Protocol):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None: ...


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
        _ = server.on('connect', self.connect, namespace=NAMESPACE)
        _ = server.on('disconnect', self.disconnect, namespace=NAMESPACE)
        _ = server.on('tab_request', self.request, namespace=NAMESPACE)

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
            await self._attach(sid, tab_id if existing else '')
            return {'tab': existing}
        revision = params.get('revision')
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise ValueError('Expected tab revision')
        if method == 'tabs.update':
            if self.attached.get(sid) != tab_id:
                raise ValueError('Attach before updating this tab')
            tab = self.store.update(tab_id, revision, self.resolve_path(params.get('path')),
                                    options(params.get('options')))
            await self.server.emit('tab_snapshot', {'tab': tab}, room='tab:' + tab_id,
                                   skip_sid=sid, namespace=NAMESPACE)
            await self.server.emit('tab_catalog', {'changed': True}, room='tab-catalog', namespace=NAMESPACE)
            return {'tab': tab}
        if method == 'tabs.close':
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
                                                       socketio_path='socket.io'))
    return application, service
