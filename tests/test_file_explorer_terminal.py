from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from app.apps.terminal.terminal_stream_protocol import PipeFrameDecoder, encode_pipe_message

import pytest

from app.apps.file_explorer.tab_store import TabStore, options
from app.apps.file_explorer.tab_service import TabService
from app.apps.file_explorer.terminal_service import TerminalService, label


class Record(dict):
    def to_payload(self):
        return self.copy()


class Manager:
    def __init__(self, root):
        self.root = root
        self.records = {}
        self.launches = 0
        self.removed = []
        self.inputs = []
        self.sizes = []
        self.scans = 0
        self.descriptions = 0
        self.queues = {}
        self.commands = []

    async def get_shell(self, shell_id):
        self.scans += 1
        return self.records.get(shell_id)

    async def load_shell_record(self, shell_id):
        return self.records.get(shell_id)

    async def get_shell_capabilities(self, record):
        return record['capabilities'].copy()

    async def find_shell_by_label(self, value, *, status):
        return next((r for r in self.records.values() if r['label'] == value and r['status'] == status), None)

    async def describe(self, record):
        self.descriptions += 1
        return record.copy()

    async def remove_shell(self, shell_id, *, force):
        self.removed.append(shell_id)
        self.records.pop(shell_id, None)

    async def write_to_pty(self, shell_id, data):
        self.inputs.append((shell_id, data))

    async def resize_pty(self, shell_id, cols, rows):
        self.sizes.append((shell_id, cols, rows))

    async def subscribe_output_bytes(self, shell_id):
        queue = asyncio.Queue()
        self.queues[shell_id] = queue
        queue.put_nowait(encode_pipe_message({'type': 'output', 'sequence': 1, 'data': b'hello\r\n'}))
        return queue

    async def unsubscribe_output_bytes(self, shell_id, queue):
        assert self.queues.get(shell_id) is queue
        self.queues.pop(shell_id, None)

    def get_pipe_state(self, shell_id):
        manager = self
        class Writer:
            def is_closing(self): return False
            def write(self, frame):
                for message in PipeFrameDecoder().push(frame):
                    manager.commands.append(message)
                    kind = message['type']
                    if kind == 'input': manager.inputs.append((shell_id, message['data'].decode()))
                    elif kind == 'resize': manager.sizes.append((shell_id, message['cols'], message['rows']))
                    elif kind == 'attach':
                        manager.queues[shell_id].put_nowait(encode_pipe_message({'type': 'checkpoint',
                            'request_id': message['request_id'], 'sequence': 1, 'state': b'hello\r\n',
                            'directoryTracking': {'state': 'ready', 'path': ''}}))
                    elif kind == 'ping':
                        manager.queues[shell_id].put_nowait(encode_pipe_message({'type': 'pong', 'request_id': message['request_id']}))
                    elif kind == 'directory.request':
                        manager.queues[shell_id].put_nowait(encode_pipe_message({'type': 'directory.result',
                            'request_id': message['request_id'], 'state': 'pending', 'path': message['path']}))
            async def drain(self): await asyncio.sleep(0)
        return SimpleNamespace(stdin_supported=True, process=SimpleNamespace(stdin=Writer()))

    async def launch(self, manager, tab):
        self.launches += 1
        shell_id = f'shell-{self.launches}'
        log = self.root / (shell_id + '.log')
        log.write_bytes(b'hello\r\n')
        record = Record(id=shell_id, label=label(tab['id']), status='running',
                  stdout_log=str(log), capabilities={'backend': 'pipe', 'stdin_write': True, 'stdout_subscribe_bytes': True})
        self.records[shell_id] = record
        return record.copy()


def fixture(root):
    store = TabStore(root / 'tabs.json')
    tab = store.create('fresh', str(root), options({}))
    manager = Manager(root)
    async def factory():
        return manager
    service = TerminalService(store, manager_factory=factory, launcher=manager.launch)
    return store, tab, manager, service


def test_tab_terminal_lifecycle_checkpoint_and_repeated_start(tmp_path):
    async def run():
        store, tab, manager, service = fixture(tmp_path)
        started = (await service.dispatch(tab, 'terminal.start', {}))['tab']
        assert started['shellId'] == 'shell-1'
        assert started['revision'] == 2
        assert TabStore(store.path).get(tab['id']) == started
        assert (await service.dispatch(started, 'terminal.start', {}))['tab'] == started
        assert manager.launches == 1
        await service.dispatch(started, 'terminal.input', {'data': 'ls\n'})
        await service.dispatch(started, 'terminal.resize', {'columns': 100, 'rows': 30})
        checkpoint = await service.dispatch(started, 'terminal.checkpoint', {'columns': 100, 'rows': 30})
        assert 'hello' in checkpoint['ansi']
        assert checkpoint['outputOffset'] == 7
        assert manager.inputs == [('shell-1', 'ls\n')]
        assert manager.sizes == [('shell-1', 100, 30)]
        assert manager.scans == manager.descriptions == 0
        with pytest.raises(ValueError, match='associated terminal'):
            store.close(started['id'], started['revision'])
        closed = (await service.dispatch(started, 'terminal.close', {}))['tab']
        assert closed['shellId'] is None
        assert manager.removed == ['shell-1']
        store.close(closed['id'], closed['revision'])
    asyncio.run(run())


def test_exit_reconcile_does_not_start_a_replacement(tmp_path):
    async def run():
        store, tab, manager, service = fixture(tmp_path)
        started = (await service.dispatch(tab, 'terminal.start', {}))['tab']
        manager.records['shell-1']['status'] = 'exited'
        current = await service.reconcile(started)
        assert current['shellId'] is None
        assert store.get(tab['id']) == current
        assert manager.launches == 1
        with pytest.raises(ValueError, match='not active'):
            await service.dispatch(current, 'terminal.input', {'data': 'no'})
    asyncio.run(run())


def test_explicit_close_removes_pre_broker_pty_without_io_fallback(tmp_path):
    async def run():
        store, tab, manager, service = fixture(tmp_path)
        started = (await service.dispatch(tab, 'terminal.start', {}))['tab']
        manager.records[started['shellId']]['capabilities'] = {'backend': 'pty', 'stdin_write': True}
        with pytest.raises(RuntimeError, match='no live broker pipe'):
            await service.dispatch(started, 'terminal.input', {'data': 'no retry'})
        closed = (await service.dispatch(started, 'terminal.close', {}))['tab']
        assert closed['shellId'] is None
        assert manager.removed == [started['shellId']]
        assert manager.inputs == []
    asyncio.run(run())


def test_foreign_and_uncontrolled_records_fail_closed(tmp_path):
    async def run():
        store, tab, manager, service = fixture(tmp_path)
        started = (await service.dispatch(tab, 'terminal.start', {}))['tab']
        manager.records['shell-1']['label'] = 'code-editor-terminal:other'
        with pytest.raises(ValueError, match='belong'):
            await service.dispatch(started, 'terminal.close', {})
        assert manager.removed == []
        manager.records['shell-1']['label'] = label(tab['id'])
        manager.records['shell-1']['capabilities']['stdin_write'] = False
        with pytest.raises(RuntimeError, match='no live broker'):
            await service.reconcile(started)
        assert store.get(tab['id']) == started
    asyncio.run(run())


def test_failed_association_cleans_only_newly_created_shell(tmp_path, monkeypatch):
    async def run():
        store, tab, manager, service = fixture(tmp_path)
        def fail(*args):
            raise OSError('disk full')
        monkeypatch.setattr(store, 'set_shell', fail)
        with pytest.raises(OSError, match='disk full'):
            await service.dispatch(tab, 'terminal.start', {})
        assert manager.removed == ['shell-1']
        assert store.get(tab['id'])['shellId'] is None
    asyncio.run(run())


@pytest.mark.parametrize('params', [{'columns': True}, {'rows': 0}, {'columns': 1001}])
def test_invalid_resize_never_reaches_shell(tmp_path, params):
    async def run():
        _, tab, manager, service = fixture(tmp_path)
        started = (await service.dispatch(tab, 'terminal.start', {}))['tab']
        with pytest.raises(ValueError, match='dimensions'):
            await service.dispatch(started, 'terminal.resize', params)
        assert not manager.sizes
    asyncio.run(run())


def test_disconnect_and_foreign_tab_cannot_close_terminal(tmp_path):
    from tests.test_file_explorer_tabs import Server
    async def run():
        store, tab, manager, terminal = fixture(tmp_path)
        async def project():
            return str(tmp_path)
        service = TabService(store, Server(), lambda value: str(value), project)
        service.terminals = terminal
        await service.connect('a', {}, {'presentationId': 'a'})
        await service.connect('b', {}, {'presentationId': 'b'})
        await service.request('a', {'method': 'tabs.attach', 'params': {'tabId': tab['id']}})
        response = await service.request('a', {'method': 'terminal.start', 'params': {'tabId': tab['id'], 'revision': 1}})
        started = response['result']['tab']
        denied = await service.request('b', {'method': 'terminal.close', 'params': {'tabId': tab['id'], 'revision': started['revision']}})
        assert not denied['ok']
        await service.disconnect('a')
        assert manager.removed == []
        assert store.get(tab['id']) == started
    asyncio.run(run())


def test_terminal_import_is_lazy():
    import subprocess
    import sys
    subprocess.run([sys.executable, '-c', "import sys; import app.apps.file_explorer.terminal_service; assert 'framework_shells' not in sys.modules; assert 'pyte' not in sys.modules; assert 'app.apps.code_te2.terminal_backend' not in sys.modules"], check=True)


def test_cancelled_launch_is_cleaned_not_replayed(tmp_path):
    async def run():
        store, tab, manager, _ = fixture(tmp_path)
        entered, release = asyncio.Event(), asyncio.Event()
        async def delayed(mgr, record):
            entered.set()
            await release.wait()
            return await manager.launch(mgr, record)
        async def factory():
            return manager
        service = TerminalService(store, manager_factory=factory, launcher=delayed)
        task = asyncio.create_task(service.dispatch(tab, 'terminal.start', {}))
        await entered.wait()
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert manager.launches == 1
        assert manager.removed == ['shell-1']
        assert store.get(tab['id'])['shellId'] is None
    asyncio.run(run())


def test_existing_label_recovers_association_without_duplicate(tmp_path):
    async def run():
        store, tab, manager, service = fixture(tmp_path)
        await manager.launch(manager, tab)
        result = await service.dispatch(tab, 'terminal.start', {})
        assert result['tab']['shellId'] == 'shell-1'
        assert manager.launches == 1
        assert store.get(tab['id']) == result['tab']
    asyncio.run(run())


def test_event_wakeup_preserves_raw_bytes_and_exit_clears_association(tmp_path):
    from tests.test_file_explorer_tabs import Server
    async def run():
        store, tab, manager, terminal = fixture(tmp_path)
        server = Server()
        async def project():
            return str(tmp_path)
        service = TabService(store, server, str, project)
        service.terminals = terminal
        terminal.brokers.sink = service.broker_event
        started = (await terminal.dispatch(tab, 'terminal.start', {}))['tab']
        await terminal.dispatch(started, 'terminal.checkpoint', {})
        manager.queues['shell-1'].put_nowait(encode_pipe_message({'type': 'output', 'sequence': 2, 'data': b'\x1b[31mraw\xff'}))
        for _ in range(8): await asyncio.sleep(0)
        event, payload, routing = server.events[-1]
        assert event == 'terminal_output'
        assert payload['data'] == b'\x1b[31mraw\xff'
        assert payload['startOffset'] == 7
        assert payload['endOffset'] == 16
        assert routing['room'] == 'tab:' + tab['id']
        manager.records['shell-1']['status'] = 'exited'
        await service.shell_changed('shell-1')
        assert store.get(tab['id'])['shellId'] is None
        assert server.events[-2][0] == 'tab_snapshot'
        assert manager.launches == 1
        await service.shutdown()
    asyncio.run(run())


def test_tab_close_requires_explicit_terminal_consent_and_current_revision(tmp_path):
    from tests.test_file_explorer_tabs import Server
    async def run():
        store, tab, manager, terminal = fixture(tmp_path)
        async def project():
            return str(tmp_path)
        service = TabService(store, Server(), str, project)
        service.terminals = terminal
        started = (await terminal.dispatch(tab, 'terminal.start', {}))['tab']
        await service.connect('a', {}, {'presentationId': 'a'})
        params = {'tabId': tab['id'], 'revision': started['revision']}
        assert not (await service.request('a', {'method': 'tabs.close', 'params': params}))['ok']
        assert not manager.removed
        assert not (await service.request('a', {'method': 'tabs.close', 'params': {**params, 'revision': 1, 'closeTerminal': True}}))['ok']
        assert not manager.removed
        assert (await service.request('a', {'method': 'tabs.close', 'params': {**params, 'closeTerminal': True}}))['ok']
        assert manager.removed == ['shell-1']
        assert store.get(tab['id']) is None
    asyncio.run(run())


def test_event_subscription_disposes_without_stopping_shells(tmp_path, monkeypatch):
    from tests.test_file_explorer_tabs import Server
    from app.apps.file_explorer import tab_service
    class Bus:
        def __init__(self):
            self.queue = asyncio.Queue()
            self.removed = False
        def subscribe(self):
            return self.queue
        def unsubscribe(self, queue):
            assert queue is self.queue
            self.removed = True
    async def run():
        bus = Bus()
        monkeypatch.setattr(tab_service, 'shell_bus', lambda: bus)
        async def project():
            return str(tmp_path)
        service = TabService(TabStore(tmp_path / 'tabs.json'), Server(), str, project)
        service.observe()
        await asyncio.sleep(0)
        await service.shutdown()
        assert bus.removed
        assert service.observer is None
    asyncio.run(run())
