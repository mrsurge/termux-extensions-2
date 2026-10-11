from __future__ import annotations

import asyncio
import threading

import pytest

from app.apps.file_explorer.tab_service import TabService
from app.apps.file_explorer.tab_store import TabStore, options
from app.apps.file_explorer.usage_service import Inbox, decode_update
from app.libs import pipe_runtime
from app.libs.pipe_protocol import PipeEnvelope


class Server:
    def __init__(self):
        self.events = []

    def on(self, *args, **kwargs):
        pass

    async def enter_room(self, *args, **kwargs):
        pass

    async def leave_room(self, *args, **kwargs):
        pass

    async def emit(self, event, data, **kwargs):
        self.events.append((event, data, kwargs))


def update(scan='scan', **changes):
    return dict(scanId=scan, path='/selected', status='complete', mode='allocated',
                totalBytes=4096, entriesVisited=1, entries=[], complete=True,
                errorCount=0, errors=[], **changes)


def envelope(data, origin='service.fs', nid=2100, method='result'):
    return PipeEnvelope(kind='notification', method='fs.directoryUsage.' + method,
                        origin_name=origin, origin_nid=nid, params=data)


async def setup(tmp_path):
    server = Server()
    async def project():
        return '/selected'
    service = TabService(TabStore(tmp_path / 'tabs.json'), server, str, project)
    tab = service.store.create('operation', '/selected', options({}))
    for sid in ['a', 'b']:
        await service.connect(sid, {}, {'presentationId': sid})
        await service.request(sid, {'method': 'tabs.attach', 'params': {'tabId': tab['id']}})
    return service, server, tab


async def call(service, method='start', sid='a', **params):
    return await service.request(sid, {'method': 'directoryUsage.' + method,
                                     'params': params or {'scanId': 'scan'}})


def test_early_thread_notification_and_exact_sid_delivery(tmp_path, monkeypatch):
    async def run():
        service, server, tab = await setup(tmp_path)
        calls = []
        async def pipe(method, params, **kwargs):
            calls.append((method, params, kwargs))
            if method.endswith('start'):
                worker = threading.Thread(target=lambda: pipe_runtime.accept_notification(envelope(update())))
                worker.start()
                worker.join()
                return {'scanId': 'scan', 'accepted': True}
            return {'scanId': 'scan', 'cancelled': True}
        monkeypatch.setattr(pipe_runtime, 'call_async', pipe)
        assert (await call(service))['ok']
        await asyncio.sleep(.1)
        events = [event for event in server.events if event[0] == 'directory_usage']
        assert len(events) == 1
        assert events[0][2]['room'] == 'a'
        assert events[0][1]['tabId'] == tab['id']
        assert calls[0][1] == {'root': '/', 'path': '/selected', 'scanId': 'scan'}
        assert not service.usage.jobs
        assert not (await call(service))['ok']  # no replay/reuse
        await service.shutdown()
    asyncio.run(run())


@pytest.mark.parametrize('action', ['disconnect', 'mount', 'list', 'navigate', 'close', 'shutdown'])
def test_lifetime_cancellation_and_start_does_not_hold_tab_lock(tmp_path, monkeypatch, action):
    async def run():
        service, server, tab = await setup(tmp_path)
        entered, release = asyncio.Event(), asyncio.Event()
        cancellations = []
        async def pipe(method, params, **kwargs):
            if method.endswith('start'):
                entered.set()
                await release.wait()
                return {'scanId': 'scan', 'accepted': True}
            cancellations.append(params['scanId'])
            return {'scanId': params['scanId'], 'cancelled': True}
        monkeypatch.setattr(pipe_runtime, 'call_async', pipe)
        start = asyncio.create_task(call(service))
        await entered.wait()
        assert not service.lock.locked()
        if action == 'disconnect':
            await service.disconnect('a')
        elif action == 'shutdown':
            await service.shutdown()
        else:
            method = {'mount': 'tabs.attach', 'list': 'tabs.list', 'navigate': 'tabs.update', 'close': 'tabs.close'}[action]
            response = await service.request('a', {'method': method,
                'params': {'tabId': tab['id'], 'revision': 1, 'path': '/changed', 'options': {}}})
            assert response['ok']
        release.set()
        await start
        await asyncio.sleep(.1)
        assert 'scan' in cancellations
        assert not service.usage.jobs
        pipe_runtime.accept_notification(envelope(update()))
        await asyncio.sleep(.1)
        assert not [event for event in server.events if event[0] == 'directory_usage']
        await service.shutdown()
    asyncio.run(run())


def test_validation_and_cross_sid_cancel(tmp_path, monkeypatch):
    async def run():
        service, server, _ = await setup(tmp_path)
        async def pipe(method, params, **kwargs):
            return {'scanId': params['scanId'], 'accepted': True}
        monkeypatch.setattr(pipe_runtime, 'call_async', pipe)
        for params in [{'scanId': 'scan', 'path': '/injected'}, {'scanId': ''}, {'scanId': 3}]:
            assert not (await call(service, **params))['ok']
        assert (await call(service))['ok']
        assert (await call(service, 'cancel', sid='b'))['result']['cancelled'] is False
        for message in [envelope(update(), origin='app.other'),
                        envelope(update(), nid=2), envelope(update('other'))]:
            pipe_runtime.accept_notification(message)
        await asyncio.sleep(.1)
        assert not [event for event in server.events if event[0] == 'directory_usage']
        assert (await call(service, 'cancel'))['result']['cancelled'] is True
        await service.shutdown()
    asyncio.run(run())


def test_uncertain_start_cancels_exact_identity(tmp_path, monkeypatch):
    async def run():
        service, _, _ = await setup(tmp_path)
        cancelled = []
        async def pipe(method, params, **kwargs):
            if method.endswith('start'):
                raise TimeoutError('uncertain')
            cancelled.append(params['scanId'])
            return {}
        monkeypatch.setattr(pipe_runtime, 'call_async', pipe)
        assert not (await call(service))['ok']
        assert cancelled == ['scan']
        assert not service.usage.jobs
        await service.shutdown()
    asyncio.run(run())


def test_bounded_mailbox_and_strict_dto():
    async def run():
        inbox = Inbox('scan')
        for _ in range(100):
            inbox.put_nowait(envelope(update()))
        assert inbox.queue.qsize() == 8
        assert inbox.wake_pending  # Flood coalesces into one loop callback.
        for _ in range(8):
            await asyncio.wait_for(inbox.get(), .1)
        waiting = asyncio.create_task(inbox.get())
        await asyncio.sleep(0)
        thread = threading.Thread(target=lambda: inbox.put_nowait(envelope(update())))
        thread.start()
        thread.join()
        assert (await asyncio.wait_for(waiting, .1)).params == update()
    asyncio.run(run())
    for malformed in [{**update(), 'totalBytes': True}, {**update(), 'totalBytes': -1},
                      {**update(), 'complete': False}, {**update(), 'mode': 'unknown'},
                      {**update(), 'errors': [{'path': '/', 'message': 'bad'}] * 33}]:
        with pytest.raises(ValueError):
            decode_update(malformed)


@pytest.mark.parametrize('changes', [{'unexpected': True}, {'path': '/other'}, {'totalBytes': True}])
def test_matching_malformed_update_fails_and_cancels_immediately(tmp_path, monkeypatch, changes):
    async def run():
        service, server, _ = await setup(tmp_path)
        cancelled = asyncio.Event()
        async def pipe(method, params, **kwargs):
            if method.endswith('cancel'):
                assert params['scanId'] == 'scan'
                cancelled.set()
                return {'scanId': 'scan', 'cancelled': True}
            return {'scanId': 'scan', 'accepted': True}
        monkeypatch.setattr(pipe_runtime, 'call_async', pipe)
        assert (await call(service))['ok']
        pipe_runtime.accept_notification(envelope({**update(), **changes}))
        await asyncio.wait_for(cancelled.wait(), .1)
        events = [event for event in server.events if event[0] == 'directory_usage']
        assert len(events) == 1
        assert events[0][1]['status'] == 'error'
        assert events[0][2]['room'] == 'a'
        assert not service.usage.jobs
        await service.shutdown()
    asyncio.run(run())


def test_replacement_and_shared_tab_navigation_cancel_both_observers(tmp_path, monkeypatch):
    async def run():
        service, _, tab = await setup(tmp_path)
        cancelled = []
        async def pipe(method, params, **kwargs):
            if method.endswith('cancel'):
                cancelled.append(params['scanId'])
                return {'scanId': params['scanId'], 'cancelled': True}
            return {'scanId': params['scanId'], 'accepted': True}
        monkeypatch.setattr(pipe_runtime, 'call_async', pipe)
        assert (await call(service))['ok']
        assert (await call(service, scanId='replacement'))['ok']
        assert (await call(service, sid='b', scanId='peer'))['ok']
        assert len(service.usage.jobs) == 2
        await service.request('b', {'method': 'tabs.update', 'params': {
            'tabId': tab['id'], 'revision': 1, 'path': '/other', 'options': {}}})
        await asyncio.sleep(.01)
        assert set(cancelled) == {'scan', 'replacement', 'peer'}
        assert not service.usage.jobs
        await service.shutdown()
    asyncio.run(run())
