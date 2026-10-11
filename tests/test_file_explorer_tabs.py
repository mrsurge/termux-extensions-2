from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

from app.apps.file_explorer.tab_store import TabStore, options
from app.apps.file_explorer.tab_service import TabService


class Server:
    def __init__(self):
        self.rooms = {}
        self.events = []

    def on(self, *args, **kwargs):
        return None

    async def enter_room(self, sid, room, **kwargs):
        self.rooms.setdefault(room, set()).add(sid)

    async def leave_room(self, sid, room, **kwargs):
        self.rooms.get(room, set()).discard(sid)

    async def emit(self, event, data, **kwargs):
        self.events.append((event, data, kwargs))


def test_tab_persistence_and_copy_boundaries(tmp_path):
    store = TabStore(tmp_path / 'tabs.json')
    tab = store.create('operation', str(tmp_path), options({}))
    tab['options']['view'] = 'grid'
    assert store.get(tab['id'])['options']['view'] == 'list'
    restored = TabStore(store.path)
    assert restored.get(tab['id']) == store.get(tab['id'])
    assert restored.create('operation', 'ignored', options({}))['id'] == tab['id']
    updated = restored.update(tab['id'], 1, '/new', options({'showHidden': True}))
    assert updated['revision'] == 2
    assert TabStore(store.path).get(tab['id']) == updated
    with pytest.raises(ValueError, match='resync'):
        restored.update(tab['id'], 1, '/stale', options({}))
    assert restored.get(tab['id']) == updated


def test_failed_disk_commit_never_advances_memory(tmp_path, monkeypatch):
    store = TabStore(tmp_path / 'tabs.json')
    tab = store.create('operation', '/home', options({}))
    def fail(*args):
        raise OSError('disk full')
    monkeypatch.setattr(os, 'replace', fail)
    with pytest.raises(OSError):
        store.update(tab['id'], 1, '/changed', options({}))
    assert store.get(tab['id']) == tab
    assert TabStore(store.path).get(tab['id']) == tab
    assert not list(tmp_path.glob('.tabs-*'))


def test_corrupt_store_fails_closed(tmp_path):
    path = tmp_path / 'tabs.json'
    path.write_text('{')
    with pytest.raises(ValueError):
        TabStore(path).snapshot()
    assert path.read_text() == '{'


def test_domain_validation_error_returns_ack_not_timeout(tmp_path):
    from starlette.exceptions import HTTPException
    async def run():
        def invalid(value):
            raise HTTPException(404, 'Directory does not exist')
        async def project():
            return '/project'
        service = TabService(TabStore(tmp_path/'tabs.json'), Server(), invalid, project)
        await service.connect('a', {}, {'presentationId': 'a'})
        result = await service.request('a', {'method': 'tabs.create',
            'params': {'path': '/missing', 'operationId': 'invalid'}})
        assert result['ok'] is False
        assert 'Directory does not exist' in result['error']
        assert service.store.snapshot() == []
    asyncio.run(run())


@pytest.mark.parametrize('value', [{'showHidden': 1}, {'sortAsc': 'yes'}, {'view': 'unknown'}, {'sortBy': 'bad'}])
def test_invalid_options(value):
    with pytest.raises(ValueError):
        options(value)


def test_rooms_revisions_close_and_reconnect(tmp_path):
    async def run():
        server = Server()
        async def project():
            return '/project'
        service = TabService(TabStore(tmp_path/'tabs.json'), server, lambda path: str(path), project)
        async def call(sid, method, **params):
            return await service.request(sid, {'method': method, 'params': params})
        assert not await service.connect('bad', {}, {})
        assert not (await call('bad', 'tabs.list'))['ok']
        for sid in ['author', 'peer', 'other']:
            assert await service.connect(sid, {}, {'presentationId': sid})
        assert (await call('author', 'tabs.defaultPath'))['result']['path'] == '/project'
        first = (await call('author', 'tabs.create', operationId='fresh', path='/project'))['result']['tab']
        same = (await call('author', 'tabs.create', operationId='fresh', path='/project'))['result']['tab']
        assert first['id'] == same['id']
        second = (await call('other', 'tabs.create', operationId='different', path='/project'))['result']['tab']
        assert first['id'] != second['id']
        await call('peer', 'tabs.attach', tabId=first['id'])
        assert server.rooms['tab:' + first['id']] == {'author', 'peer'}
        catalog = await call('author', 'tabs.catalog')
        assert len(catalog['result']['tabs']) == 2
        assert service.attached['author'] == first['id']
        assert 'author' in server.rooms['tab-catalog']
        assert not (await call('other', 'tabs.update', tabId=first['id'], revision=1, path='/bad', options={}))['ok']
        response = await call('author', 'tabs.update', tabId=first['id'], revision=1, path='/new', options={})
        updated = response['result']['tab']
        assert updated['revision'] == 2
        snapshot = [event for event in server.events if event[0] == 'tab_snapshot'][-1]
        assert snapshot[2]['skip_sid'] == 'author'
        assert snapshot[2]['room'] == 'tab:' + first['id']
        assert server.events[-1][0] == 'tab_catalog'
        assert not (await call('peer', 'tabs.update', tabId=first['id'], revision=1, path='/stale', options={}))['ok']
        await service.disconnect('peer')
        assert service.store.get(first['id']) == updated
        await service.connect('peer2', {}, {'presentationId': 'peer'})
        assert (await call('peer2', 'tabs.attach', tabId=first['id']))['result']['tab'] == updated
        assert (await call('author', 'tabs.close', tabId=first['id'], revision=2))['ok']
        assert [event for event in server.events if event[0] == 'tab_snapshot'][-1][1]['closedId'] == first['id']
        assert first['id'] not in service.attached.values()
        assert (await call('peer2', 'tabs.attach', tabId=first['id']))['result']['tab'] is None
        assert (await call('peer2', 'tabs.create', operationId='fresh', path='/project'))['result']['tab'] is None
        assert len(service.store.snapshot()) == 1
    asyncio.run(run())


def test_concurrent_creation_and_revision_fencing(tmp_path):
    async def run():
        server = Server()
        async def project():
            return '/project'
        service = TabService(TabStore(tmp_path/'tabs.json'), server, str, project)
        await service.connect('a', {}, {'presentationId': 'a'})
        await service.connect('b', {}, {'presentationId': 'b'})
        payload = {'method': 'tabs.create', 'params': {'operationId': 'once', 'path': '/project'}}
        a, b = await asyncio.gather(service.request('a', payload), service.request('b', payload))
        assert a['result']['tab']['id'] == b['result']['tab']['id']
        identity = a['result']['tab']['id']
        mutation = {'method': 'tabs.update', 'params': {'tabId': identity, 'revision': 1, 'path': '/new', 'options': {}}}
        a, b = await asyncio.gather(service.request('a', mutation), service.request('b', mutation))
        assert a['ok'] is True and b['ok'] is False
    asyncio.run(run())


def test_real_socketio_asgi_round_trip(tmp_path, monkeypatch):
    from app.apps.terminal.terminal_stream_protocol import pack_message, unpack_message
    import socket
    import socketio
    import uvicorn
    from app.apps.file_explorer.http_app import FileExplorerHTTP
    from app.apps.file_explorer.tab_service import compose_tabs

    async def run():
        async def query(path, params):
            return {'ok': True}
        async def project():
            return '/project'
        app, service = compose_tabs(FileExplorerHTTP(query_handler=query, commands={}),
                                    TabStore(tmp_path/'tabs.json'), str, project)
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, log_level='error', lifespan='off'))
        serving = asyncio.create_task(server.serve(sockets=[listener]))
        author, peer = socketio.AsyncClient(), socketio.AsyncClient()
        events = []
        changed = asyncio.Event()
        async def received(payload):
            events.append(unpack_message(payload))
            changed.set()
        peer.on('tab_snapshot', received, namespace='/tabs')
        try:
            for _ in range(200):
                if server.started:
                    break
                await asyncio.sleep(.01)
            assert server.started
            for client, identity in [(author, 'author'), (peer, 'peer')]:
                await client.connect(f'http://127.0.0.1:{port}', namespaces=['/tabs'],
                                     transports=['websocket'], auth={'codec': 'msgpack-v1', 'presentationId': identity})
            async def call(client, method, **params):
                raw = await client.call('tab_request', pack_message({'id': 1, 'method': method, 'params': params}), namespace='/tabs', timeout=2)
                result = unpack_message(raw)
                assert result['id'] == 1
                return result
            result = await call(author, 'tabs.create', operationId='wire', path='/project')
            tab = result['result']['tab']
            await call(peer, 'tabs.attach', tabId=tab['id'])
            update = await call(author, 'tabs.update', tabId=tab['id'], revision=1, path='/next', options={})
            assert update['ok'] is True
            await asyncio.wait_for(changed.wait(), 2)
            assert events[-1]['tab']['path'] == '/next'
            assert service.store.get(tab['id'])['revision'] == 2
            # Prove raw socket routing through the same production ASGI composition,
            # without importing the Terminal FastAPI backend or launching a shell.
            import websockets
            selected = service.store.get(tab['id'])
            selected = service.store.set_shell(selected['id'], selected['revision'], 'wire-shell')
            async def checkpoint(selected, method, params):
                assert method == 'terminal.checkpoint'
                return {'shellId': 'wire-shell', 'ansi': 'screen', 'outputOffset': 0}
            monkeypatch.setattr(service.terminals, 'dispatch', checkpoint)
            grant = (await call(author, 'terminal.stream', tabId=selected['id'], revision=selected['revision']))['result']
            async with websockets.connect(f'ws://127.0.0.1:{port}/ws/terminal?codec=msgpack-v1') as raw:
                await raw.send(pack_message({'type': 'attach', 'token': grant['token'], 'columns': 80, 'rows': 24}))
                initial = unpack_message(await asyncio.wait_for(raw.recv(), 2))
                assert initial['type'] == 'checkpoint' and initial['ansi'] == 'screen'
                await service.broker_event('wire-shell', {'type': 'output', 'startOffset': 0, 'endOffset': 1, 'data': b'x'})
                assert unpack_message(await asyncio.wait_for(raw.recv(), 2))['data'] == b'x'
            assert service.store.get(selected['id'])['shellId'] == 'wire-shell'
        finally:
            await author.disconnect()
            await peer.disconnect()
            server.should_exit = True
            await asyncio.wait_for(serving, 5)
            listener.close()
    asyncio.run(run())


def test_tab_sidebar_publication_has_reference_not_creation_path(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock
    from urllib.parse import urlsplit, parse_qs
    from app.apps.file_explorer import file_explorer as backend
    from app.libs import sidebar_rpc
    monkeypatch.setattr(backend, 'APP_ID', 'file_explorer')
    monkeypatch.setattr(backend, 'APP_BASE_URL', '/app/file_explorer')
    store = TabStore(tmp_path / 'tabs.json')
    tab = store.create('sidebar', str(tmp_path), options({}))
    monkeypatch.setattr(backend.TAB_SERVICE, 'store', store)
    call = AsyncMock(return_value={'ok': True})
    monkeypatch.setattr(sidebar_rpc, 'call_sidebar_rpc', call)
    asyncio.run(backend.publish_sidebar_window_url({'host_id': 'slot', 'token_id': 'token',
                                                   'path': str(tmp_path), 'tab_id': tab['id']}))
    params = call.call_args.args[2]
    assert params['query_state'] == {'tab_id': tab['id']}
    query = parse_qs(urlsplit(params['url']).query)
    assert query['tab_id'] == [tab['id']]
    assert 'path' not in query
    assert params['activate'] is False
    asyncio.run(backend.publish_sidebar_window_url({'host_id': 'slot', 'token_id': 'token',
                                                   'path': str(tmp_path), 'splash': True}))
    params = call.call_args.args[2]
    assert params['query_state'] == {}
    query = parse_qs(urlsplit(params['url']).query)
    assert 'tab_id' not in query and 'path' not in query
    assert params['state_kind'] == 'splash'
    assert params['path'] == ''
    # Exercise the real Sidebar reconstruction boundary, not just the URL
    # emitted by File Explorer: empty query state previously fell back to Home.
    from app.apps.code_te2.ui_ipc.sidebar_window_state import _build_window_url, _normalize_slot
    restored = _build_window_url('file_explorer', None, params, 'slot', 'token')
    slot = _normalize_slot({**params, 'url': restored})
    for key in ('url', 'restore_url'):
        restored_query = parse_qs(urlsplit(slot[key]).query)
        assert 'path' not in restored_query and 'tab_id' not in restored_query
    assert 'path' not in slot['query_state']
    assert backend.TAB_SERVICE.store.snapshot() == [tab]
    # No directory needs to exist for an identity-free splash/default.
    asyncio.run(backend.publish_sidebar_window_url({'host_id': 'slot', 'splash': True}))
    assert call.call_args.args[2]['path'] == ''
