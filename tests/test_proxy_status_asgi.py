import ast
import asyncio
import importlib.util
from pathlib import Path

import httpx

from app.libs.te2_asgi.status import StatusASGI

ROOT = Path(__file__).resolve().parents[1]


def test_status_routes():
    asyncio.run(check_status_routes())


async def check_status_routes():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=StatusASGI('ready')), base_url='http://test') as client:
        response = await client.get('/')
        assert response.json() == {'ok': True, 'data': {'message': 'ready'}}
        assert (await client.get('/missing')).status_code == 404
        response = await client.post('/')
        assert response.status_code == 405
        assert response.headers['allow'] == 'GET'


def test_lifespan_and_websocket():
    asyncio.run(check_lifespan_and_websocket())


async def check_lifespan_and_websocket():
    events = iter([{'type': 'lifespan.startup'}, {'type': 'lifespan.shutdown'}])
    sent = []
    async def receive():
        return next(events)
    async def send(message):
        sent.append(message)
    app = StatusASGI('ready')
    await app({'type': 'lifespan'}, receive, send)
    assert [entry['type'] for entry in sent] == ['lifespan.startup.complete', 'lifespan.shutdown.complete']
    sent.clear()
    await app({'type': 'websocket'}, receive, send)
    assert sent == [{'type': 'websocket.close', 'code': 1008}]


def test_existing_stubs_have_explicit_export():
    for relative in ('app/apps/als_rs/main.py', 'app/apps/_templates/proxy_shell_wrapper/main.py'):
        source = (ROOT / relative).read_text()
        assert 'fastapi' not in source
        spec = importlib.util.spec_from_file_location('status_fixture', ROOT / relative)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        assert isinstance(module.TE2_ASGI_APP, StatusASGI)


def test_generated_stub_quotes_display_name(tmp_path):
    from app.extensions.apps.scaffold import _rewrite_backend_stub
    target = tmp_path / 'main.py'
    target.touch()
    name = 'Quoted "name"\nwith newline'
    _rewrite_backend_stub(tmp_path, app_id='test-id', name=name)
    source = target.read_text()
    ast.parse(source)
    assert 'fastapi' not in source
    namespace = {}
    exec(compile(source, str(target), 'exec'), namespace)
    assert namespace['TE2_ASGI_APP'].message == name + ' backend ready'
