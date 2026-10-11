from __future__ import annotations

import asyncio
import json

import pytest

from app.apps.file_explorer.directory_tracking import DirectoryTracking
from app.apps.file_explorer.tab_store import TabStore, options
from app.apps.file_explorer.tab_service import TabService
from app.apps.file_explorer.terminal_service import TerminalService, label


def test_private_mailbox_generation_bounds_and_ack(tmp_path):
    tracking = DirectoryTracking(tmp_path / 'tracking')
    identity = tracking.create()
    directory = tracking.directory(identity)
    assert directory.stat().st_mode & 0o777 == 0o700
    assert (directory / 'request').stat().st_mode & 0o777 == 0o600
    original = (directory / 'request').read_bytes().split(b'\n', 1)[0]
    tracking.request(identity, 5, '/quote\npath')
    requested = (directory / 'request').read_bytes().split(b'\n', 1)[0]
    (directory / 'ack').write_bytes(original + b'\nready\n/home\0')
    (directory / 'ack').chmod(0o600)
    assert tracking.status(identity, True) == {'state': 'pending', 'path': '/quote\npath'}
    (directory / 'ack').write_bytes(requested + b'\napplied\n/quote\npath\0')
    assert tracking.status(identity, True)['state'] == 'applied'
    tracking.request(identity, 6, None)
    assert tracking.status(identity, True)['state'] == 'ready'
    assert tracking.status(identity, False)['state'] == 'unlocked'
    with pytest.raises(ValueError): tracking.request(identity, 7, 'x\0y')
    with pytest.raises(ValueError): tracking.request(identity, 7, 'x' * 4097)
    with pytest.raises(ValueError): tracking.directory('../escape')
    (directory / 'ack').unlink()
    (directory / 'ack').symlink_to(tmp_path / 'other')
    with pytest.raises(OSError): tracking.status(identity, True)
    tracking.discard(identity)
    tracking.discard(identity)  # repeated exited-record reconciliation is safe
    assert not directory.exists()


def test_tab_lock_defaults_migration_and_independent_persistence(tmp_path):
    store = TabStore(tmp_path / 'tabs.json')
    a = store.create('a', '/a', options({}))
    b = store.create('b', '/b', options({}))
    assert a['directoryLocked'] is True
    a = store.set_directory_lock(a['id'], a['revision'], False)
    assert TabStore(store.path).get(a['id'])['directoryLocked'] is False
    assert store.get(b['id'])['directoryLocked'] is True
    a = store.update(a['id'], a['revision'], '/new', options({}))
    assert a['directoryLocked'] is False
    # Schema-1 old records default to locked, without fabricating integration.
    body = json.loads(store.path.read_text())
    for tab in body['tabs'].values():
        tab.pop('directoryLocked'); tab.pop('shellTrackingId')
    store.path.write_text(json.dumps(body))
    assert all(tab['directoryLocked'] and tab['shellTrackingId'] is None for tab in TabStore(store.path).snapshot())


def test_navigation_only_and_shared_checkbox_revision(tmp_path):
    class Server:
        def __init__(self): self.events = []
        def on(self, *args, **kwargs): pass
        async def enter_room(self, *args, **kwargs): pass
        async def leave_room(self, *args, **kwargs): pass
        async def emit(self, *args, **kwargs): self.events.append((args, kwargs))
    async def run():
        from tests.test_file_explorer_terminal import fixture
        store, a, manager, terminals = fixture(tmp_path)
        a = (await terminals.dispatch(a, 'terminal.start', {}))['tab']
        server = Server()
        async def project(): return '/project'
        service = TabService(store, server, str, project)
        service.terminals = terminals
        # Observer lifecycle itself is covered by the existing event-bus tests.
        service.observe = lambda: None
        terminals.brokers.sink = service.broker_event
        await service.connect('a', {}, {'presentationId': 'a'})
        await service.connect('peer', {}, {'presentationId': 'peer'})
        async def call(sid, method, **params):
            return await service.request(sid, {'method': method, 'params': {'tabId': a['id'], **params}})
        await call('a', 'tabs.attach'); await call('peer', 'tabs.attach')
        await terminals.dispatch(a, 'terminal.checkpoint', {})
        def navigations(): return [m for m in manager.commands if m['type'] == 'directory.request']
        # Attach, option changes and tab restoration never publish directory intent.
        result = await call('a', 'tabs.update', revision=a['revision'], path=a['path'], options={'view': 'grid'})
        a = result['result']['tab']
        assert navigations() == []
        result = await call('a', 'tabs.update', revision=a['revision'], path='/next', options={})
        a = result['result']['tab']
        assert [m['path'] for m in navigations()] == ['/next']
        result = await call('peer', 'terminal.directoryLock', revision=a['revision'], locked=False)
        assert result['ok']
        a = result['result']['tab']
        assert not a['directoryLocked']
        assert [m['type'] for m in manager.commands][-2:] == ['directory.cancel', 'ping']
        assert any(args[0] == 'tab_snapshot' and kwargs.get('room') == 'tab:' + a['id'] and kwargs.get('skip_sid') == 'peer'
                   for args, kwargs in server.events)
        result = await call('a', 'tabs.update', revision=a['revision'], path='/unlocked', options={})
        a = result['result']['tab']
        assert len(navigations()) == 1
        result = await call('a', 'terminal.directoryLock', revision=a['revision'], locked=True)
        a = result['result']['tab']
        assert [m['type'] for m in manager.commands][-2:] == ['directory.cancel', 'ping']
        await call('peer', 'tabs.attach')
        assert len(navigations()) == 1
        await service.shutdown()
    asyncio.run(run())
