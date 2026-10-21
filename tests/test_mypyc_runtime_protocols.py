"""Small real-codegen regressions for inspected contracts, not a domain build."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.skipif(importlib.util.find_spec('mypyc') is None, reason='requires mypyc')
def test_compiled_implementations_use_interpreted_runtime_protocols(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    code = r'''
import asyncio
import importlib
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import msgspec
from mypyc.build import mypycify
from setuptools import setup

repo, output = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(repo / 'scripts'))
import probe_code_te2_mypyc as probe
from mypyc_build_workflow import mypy_build_args, progress_build_ext
names = {
    'app.apps.code_te2.native_socketio',
    'app.apps.code_te2.diagnostics_latency_metrics',
    'app.apps.code_te2.host.sidebar_rpc_backend',
}
assert 'app.apps.code_te2.native_runtime_contracts' in probe.INTERPRETED
assert 'app.apps.code_te2.ui_ipc.sidebar_rpc_contract' in probe.INTERPRETED
assert not names.intersection(probe.INTERPRETED)
sources = [name.replace('.', '/') + '.py' for name in sorted(names)]
extensions = mypycify(mypy_build_args(repo, sources), multi_file=True,
                      target_dir=str(output / 'csrc'))
setup(name='runtime-protocol-fixture', ext_modules=extensions,
      cmdclass={'build_ext': progress_build_ext(sys.stdout)},
      script_args=['build_ext', '--build-lib', str(output / 'lib'),
                   '--build-temp', str(output / 'temp')])
isolated = output / 'isolated'
isolated.mkdir()
guard = probe._isolate(isolated)
try:
    sys.path.append(str(output / 'lib'))
    sys.meta_path.insert(0, probe.CompiledFinder(output / 'lib', names))
    socket = importlib.import_module('app.apps.code_te2.native_socketio')
    metrics = importlib.import_module('app.apps.code_te2.diagnostics_latency_metrics')
    contracts = importlib.import_module('app.apps.code_te2.native_runtime_contracts')
    assert socket.__file__.endswith('.so')
    assert metrics.__file__.endswith('.so')
    assert contracts.__file__.endswith('.py')

    async def event(*args: object) -> object:
        return args

    assert isinstance(event, socket.NativeEventHandler)
    assert not isinstance(object(), socket.NativeEventHandler)
    namespace = socket.NativeNamespace()
    assert namespace._event_handler('absent') is None

    class Queue:
        def qsize(self) -> object:
            return 3

    assert isinstance(Queue(), metrics.QueueSizeReader)
    owner = SimpleNamespace(eio=SimpleNamespace(sockets={
        'valid': SimpleNamespace(queue=Queue()),
        'invalid': SimpleNamespace(queue=object()),
    }))
    result = metrics.sample_engineio_queues(owner)
    assert result == {'sockets': 2, 'queued_packets': 3, 'max_queue_depth': 3}, result

    service = importlib.import_module('app.apps.code_te2.host.sidebar_rpc_backend')
    dto = importlib.import_module('app.apps.code_te2.ui_ipc.sidebar_rpc_contract')
    assert service.__file__.endswith('.so')
    assert dto.__file__.endswith('.py')
    assert service._FileOpen is dto.SidebarFileOpen
    assert service._ProjectRequest is dto.SidebarProjectRequest
    params = {'path': '/example.py', 'line': 59, 'column': 1, 'target': {
        'clientId': 'client', 'hostId': 'slot', 'presentationId': 'presentation',
        'mainPageId': '4Y9F', 'sidebarWindowId': 'als:RP9w.4Y9F',
    }}
    opened = msgspec.convert(params, type=service._FileOpen, strict=True)
    assert opened.line == 59 and opened.column == 1
    assert opened.target.mainPageId == '4Y9F'
    assert opened.target.sidebarWindowId == 'als:RP9w.4Y9F'
    blank = msgspec.convert({'path': '/example.py', 'target': {
        'clientId': 'client', 'hostId': 'slot', 'presentationId': 'presentation',
    }}, type=service._FileOpen, strict=True)
    assert blank.line is None and blank.column is None
    assert blank.target.mainPageId is None
    explicit_null = msgspec.convert({**params, 'line': None, 'column': None},
                                   type=service._FileOpen, strict=True)
    assert explicit_null.line is None and explicit_null.column is None
    project = msgspec.convert({'path': '/project', 'target': params['target']},
                             type=service._ProjectRequest, strict=True)
    assert project.open is True and project.adoptExisting is True
    for invalid in ({**params, 'line': '59'}, {**params, 'column': True},
                    {**params, 'column': 1.5}, {**params, 'extra': 'forbidden'},
                    {**params, 'target': {**params['target'], 'mainPageId': 4}}):
        try:
            msgspec.convert(invalid, type=service._FileOpen, strict=True)
        except msgspec.ValidationError:
            pass
        else:
            raise AssertionError('malformed file-open payload accepted')
    sidebar = importlib.import_module('app.apps.code_te2.ui_ipc.sidebar_ws')
    owner = AsyncMock(return_value={'ok': True})
    envelope = {'service': 'sidebar', 'version': 1, 'method': 'file.open',
                'context': None, 'payload': params,
                'source': {'appId': 'als-rs', 'shellId': 'owned'}}
    with patch.object(sidebar, 'handle_sidebar_document_open', owner):
        result = asyncio.run(service.dispatch_sidebar_service(envelope))
    assert result == {'ok': True}
    owner.assert_awaited_once_with(params, requester_app_id='als-rs', require_presentation=True)
    print('Compiled implementations and runtime Protocol checks passed')
finally:
    guard[0] = False
'''
    result = subprocess.run(
        [sys.executable, '-B', '-c', code, str(repo), str(tmp_path)],
        cwd=repo, env=dict(os.environ, PYTHON_JIT='0', PYTHONDONTWRITEBYTECODE='1',
                           CCACHE_DISABLE='1'),
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'Compiled implementations and runtime Protocol checks passed' in result.stdout
