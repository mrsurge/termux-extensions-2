from __future__ import annotations

import asyncio

from app.apps.file_explorer.tab_service import TabService
from app.apps.file_explorer.tab_store import TabStore, options
from app.apps.file_explorer.terminal_stream import OutputConnection, serve_output
from app.apps.file_explorer.terminal_stream_protocol import pack_message, unpack_message
from tests.test_file_explorer_tabs import Server


def test_wire_requires_binary_codec_and_correlated_ids(tmp_path):
    async def run():
        async def project(): return '/project'
        service = TabService(TabStore(tmp_path / 'tabs.json'), Server(), str, project)
        assert not await service.wire_connect('a', {}, {'presentationId': 'a'})
        assert await service.wire_connect('a', {}, {'codec': 'msgpack-v1', 'presentationId': 'a'})
        for payload in ({'method': 'tabs.list'}, b'\x81', pack_message({'id': True}), b''):
            assert unpack_message(await service.wire_request('a', payload))['ok'] is False
        result = unpack_message(await service.wire_request('a', pack_message({'id': 42, 'method': 'tabs.defaultPath', 'params': {}})))
        assert result == {'id': 42, 'ok': True, 'result': {'path': '/project'}}
        assert unpack_message(await service.wire_request('a', pack_message({'id': 43, 'method': 'bad', 'params': {}})))['id'] == 43
    asyncio.run(run())


def test_stream_grant_checkpoint_output_and_disconnect(tmp_path, monkeypatch):
    async def run():
        async def project(): return '/project'
        store = TabStore(tmp_path / 'tabs.json')
        tab = store.create('new', '/project', options({}))
        tab = store.set_shell(tab['id'], tab['revision'], 'shell')
        service = TabService(store, Server(), str, project)
        await service.connect('a', {}, {'presentationId': 'a'})
        await service._attach('a', tab['id'])
        async def checkpoint(selected, method, params):
            assert selected['shellId'] == 'shell' and method == 'terminal.checkpoint'
            return {'shellId': 'shell', 'ansi': 'initial', 'outputOffset': 2}
        monkeypatch.setattr(service.terminals, 'dispatch', checkpoint)
        result = await service.request('a', {'method': 'terminal.stream', 'params': {'tabId': tab['id'], 'revision': tab['revision']}})
        grant = result['result']
        stream = OutputConnection('', '', '')
        await service.attach_stream({'token': grant['token']}, stream)
        assert unpack_message((await stream.queue.get())[0])['type'] == 'checkpoint'
        await service.broker_event('shell', {'type': 'output', 'startOffset': 2, 'endOffset': 3, 'data': b'x'})
        assert unpack_message((await stream.queue.get())[0])['data'] == b'x'
        assert not any(event[0] == 'terminal_output' for event in service.server.events)
        import pytest
        with pytest.raises(ValueError): await service.attach_stream({'token': grant['token']}, OutputConnection('', '', ''))
        await service.disconnect('a')
        assert stream.closed and store.get(tab['id'])['shellId'] == 'shell'
        await service.shutdown()
    asyncio.run(run())


def test_raw_asgi_binary_attach_and_cleanup():
    async def run():
        incoming = asyncio.Queue()
        for event in [{'type': 'websocket.connect'}, {'type': 'websocket.receive', 'bytes': pack_message({'type': 'attach', 'token': 'secret'})}]:
            incoming.put_nowait(event)
        sent, detached = [], []
        async def send(message):
            sent.append(message)
            if message['type'] == 'websocket.send': incoming.put_nowait({'type': 'websocket.disconnect'})
        async def attach(request, stream):
            assert request['token'] == 'secret'
            stream.put({'type': 'checkpoint', 'ansi': 'screen'}, checkpoint=True)
        await serve_output({'query_string': b'codec=msgpack-v1'}, incoming.get, send, attach, detached.append)
        assert unpack_message(sent[1]['bytes']) == {'type': 'checkpoint', 'ansi': 'screen'}
        assert len(detached) == 1 and detached[0].closed
    asyncio.run(run())


def test_raw_rejects_text_and_bad_codec():
    async def run():
        for query, frame in [(b'codec=json', {'bytes': b'x'}), (b'codec=msgpack-v1', {'text': '{}'}),
                             (b'codec=msgpack-v1', {'bytes': b'\x81'})]:
            events = [{'type': 'websocket.connect'}, {'type': 'websocket.receive', **frame}]
            sent = []
            async def receive(): return events.pop(0)
            async def send(message): sent.append(message)
            async def attach(request, stream): raise AssertionError('must not attach')
            await serve_output({'query_string': query}, receive, send, attach, lambda stream: None)
            assert not any(event['type'] == 'websocket.send' for event in sent)
    asyncio.run(run())


def test_slow_output_queue_closes_without_blocking_broker():
    stream = OutputConnection('a', 'tab', 'shell')
    for _ in range(65): stream.put({'type': 'output', 'data': b'x'})
    assert stream.closed and stream.queue.qsize() == 1
    assert stream.queue.get_nowait() is None
    stream.put({'data': b'ignored'})
    assert stream.queue.empty()
