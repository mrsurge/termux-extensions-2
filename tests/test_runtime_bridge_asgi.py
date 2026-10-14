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
        code = '''
import importlib.abc, sys
class NoPythonMCP(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'fastmcp', 'mcp'} or fullname.startswith('app.te2_mcp'):
            raise AssertionError('Retired Python MCP import: ' + fullname)
sys.meta_path.insert(0, NoPythonMCP())
''' + code
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
assert '/te2_console_ws/socket.io' in {r.path for r in app.routes}
assert not any(r.path.startswith('/te2_mcp') for r in app.routes)
async def check():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        r = await client.get('/api/health')
        assert r.json() == {'ok': True, 'service': 'te2-runtime-bridge'}
        assert (await client.head('/api/health')).status_code == 405
        assert (await client.post('/api/health')).status_code == 405
        assert (await client.get('/missing')).status_code == 404
        assert (await client.get('/te2_mcp/')).status_code == 404
        assert (await client.post('/te2_mcp_http/', json={})).status_code == 404
        r = await client.get('/te2_console_ws/socket.io/?EIO=4&transport=polling')
        assert r.status_code == 200 and r.text.startswith('0{'), (r.status_code, r.text)
asyncio.run(check())
''')

    def test_console_only_bridge_lifespan_and_private_owner_admission(self) -> None:
        self.probe('''
import os, sys
os.environ['TE2_RUNTIME_OWNER_KEY'] = 'isolated-test-key'
from starlette.testclient import TestClient
from framework.bootstrap.runtime_bridge import build_app
with TestClient(build_app()) as client:
    assert client.get('/api/health').status_code == 200
    response = client.get('/te2_console_ws/socket.io/?EIO=4&transport=polling')
    assert response.status_code == 200 and response.text.startswith('0{')
    assert client.get('/internal/console/workers').status_code == 401
    assert client.get('/internal/console/workers', headers={'x-te2-owner-key': 'isolated-test-key'}).json() == {'workers': [], 'source': 'te2_console.runtime'}
assert not any(n == 'fastmcp' or n.startswith('fastmcp.') or n == 'mcp' or n.startswith('mcp.') for n in sys.modules)
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
