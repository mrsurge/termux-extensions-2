"""Probe imports only in disposable cache roots: console import truncates logs."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RuntimeBridgeTests(unittest.TestCase):
    def probe(self, code: str) -> None:
        with tempfile.TemporaryDirectory(prefix='te2-bridge-test-', dir=os.environ.get('TMPDIR', str(ROOT / '.codex-scratch'))) as scratch:
            environment = {**os.environ, 'TE2_CACHE_HOME': scratch,
                           'TE2_CONFIG_HOME': scratch + '/config', 'TE2_DATA_HOME': scratch + '/data'}
            result = subprocess.run([sys.executable, '-c', code], cwd=ROOT, env=environment,
                                    capture_output=True, text=True, timeout=40)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_real_composition_and_http_contracts(self) -> None:
        self.probe('''
import asyncio, sys, httpx
from framework.bootstrap.runtime_bridge import build_app
from starlette.applications import Starlette
app = build_app()
assert isinstance(app, Starlette)
assert not any(n == 'fastapi' or n.startswith('fastapi.') for n in sys.modules)
assert {'/te2_console_ws/socket.io', '/te2_mcp', '/te2_mcp_http'}.issubset({r.path for r in app.routes})
async def check():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        r = await client.get('/api/health')
        assert r.json() == {'ok': True, 'service': 'te2-runtime-bridge'}
        assert (await client.head('/api/health')).status_code == 405
        assert (await client.post('/api/health')).status_code == 405
        assert (await client.get('/missing')).status_code == 404
        r = await client.get('/te2_console_ws/socket.io/?EIO=4&transport=polling')
        assert r.status_code == 200 and r.text.startswith('0{'), (r.status_code, r.text)
asyncio.run(check())
''')

    def test_mcp_lifespan_order_and_failure_cleanup(self) -> None:
        self.probe('''
import asyncio
from types import SimpleNamespace
from contextlib import asynccontextmanager
from unittest.mock import patch
import app.te2_runtime_mounts as mounts
stages = []
def child(name, fail=False):
    @asynccontextmanager
    async def lifespan(app):
        stages.append(name + '.start')
        if fail: raise RuntimeError('startup failed')
        try: yield
        finally: stages.append(name + '.stop')
    return SimpleNamespace(lifespan=lifespan)
async def check():
    with patch.object(mounts, 'TE2_MCP_ASGI_APP', child('sse')), patch.object(mounts, 'TE2_MCP_STREAMABLE_HTTP_ASGI_APP', child('http')):
        async with mounts.te2_runtime_lifespan(): stages.append('ready')
    assert stages == ['sse.start', 'http.start', 'ready', 'http.stop', 'sse.stop'], stages
    stages.clear()
    with patch.object(mounts, 'TE2_MCP_ASGI_APP', child('sse')), patch.object(mounts, 'TE2_MCP_STREAMABLE_HTTP_ASGI_APP', child('http', True)):
        try:
            async with mounts.te2_runtime_lifespan(): raise AssertionError('must not start')
        except RuntimeError: pass
    assert stages == ['sse.start', 'http.start', 'sse.stop'], stages
asyncio.run(check())
''')

    def test_typed_console_admission_and_replay_bounds(self) -> None:
        self.probe('''
import asyncio
from unittest.mock import AsyncMock
from types import SimpleNamespace
import app.te2_console_runtime as rt
assert rt.console_payload([]) is None
assert rt.console_payload({1: 'wrong'}) is None
assert rt.console_payload({'value': [1, {'nested': True}]}) is not None
assert rt._normalize_tail_lines('5001') == 5000
assert rt._normalize_tail_lines(None) == 500
assert rt._normalize_tail_lines(0) == 0
ns = SimpleNamespace(emit=AsyncMock(), enter_room=AsyncMock(), save_session=AsyncMock(), get_session=AsyncMock(return_value={'consoleWorkerId':'worker-a'}))
async def check():
    await rt.on_console_register(ns, 'sid', [])
    ns.enter_room.assert_not_awaited()
    await rt.on_console_register(ns, 'sid', {'workerId':'worker-a'})
    assert rt.list_console_workers() == ['worker-a']
    ns.enter_room.assert_awaited_once_with('sid', 'console:worker-a')
    await rt.on_console_eval(ns, 'sid', {'targetWorkerId':'worker-b', 'reqId':'r', 'code':'1'})
    assert ns.emit.await_args.kwargs['room'] == 'console:worker-b'
    await rt.on_console_disconnect(ns, 'sid')
    assert not rt.list_console_workers()
    await rt.on_console_eval_result(ns, 'sid', {'reqId': [], 'value': 1})
asyncio.run(check())
''')

    def test_existing_console_eval_regressions_isolated(self) -> None:
        self.probe('''
import unittest
suite = unittest.defaultTestLoader.discover('tests', pattern='test_console_eval.py')
result = unittest.TextTestRunner().run(suite)
assert result.wasSuccessful()
''')

    def test_real_mcp_startup_and_streamable_initialization(self) -> None:
        self.probe('''
from starlette.testclient import TestClient
from framework.bootstrap.runtime_bridge import build_app
with TestClient(build_app()) as client:
    response = client.post('/te2_mcp_http/', headers={'Accept': 'application/json, text/event-stream'},
        json={'jsonrpc':'2.0', 'id':1, 'method':'initialize', 'params':{
            'protocolVersion':'2024-11-05', 'capabilities':{},
            'clientInfo':{'name':'isolated-bridge-test', 'version':'1'}}})
    assert response.status_code == 200, (response.status_code, response.text)
    assert 'protocolVersion' in response.text and 'serverInfo' in response.text
    assert response.headers.get('mcp-session-id')
''')
