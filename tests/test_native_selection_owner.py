from __future__ import annotations

import json
import asyncio
import threading
from pathlib import Path

import httpx
import pytest
from starlette.applications import Starlette

from app.cli.native_selection import (
    CONTEXT_ENV, SelectionContext, SelectionSnapshot, decode_context, encode_context,
)
from app.cli.native_runtime import NativeRuntimeResult
from app.libs.native_selection_owner import native_selection_owner_routes
from framework.bootstrap import bootstrap
from tests.test_native_runtime_discovery import declare


def test_context_is_bounded_and_versioned() -> None:
    assert decode_context(encode_context(SelectionContext(1, 'debug', False, {}))).profile == 'debug'
    with pytest.raises(ValueError):
        decode_context(' ' * (64 * 1024 + 1))
    with pytest.raises(ValueError):
        decode_context('{"schema_version":2,"profile":"release","packaged":false,"workers":{}}')


def test_source_selection_never_prepares_or_imports_provider(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = declare(tmp_path / 'apps', 'alpha')
    data = json.loads(path.read_text())
    data['runtimeProvider'] = 'runtime.py'
    path.write_text(json.dumps(data))
    (path.parent / 'runtime.py').write_text('raise AssertionError("provider must not run")')
    monkeypatch.setattr(bootstrap, '_app_runtime', lambda *a, **k: pytest.fail('provider execution'))
    monkeypatch.setattr(bootstrap, '_prepare_native_build', lambda *a, **k: pytest.fail('Cargo'))
    env = {'TE2_SERVER_APP_ROOTS': str(tmp_path / 'apps'), 'TE2_CACHE_HOME': str(tmp_path / 'cache')}
    before = dict(env)
    snapshot = bootstrap.native_selection_snapshot(env, SelectionContext(1, 'debug', False, {}))
    assert snapshot.workers[0].status == 'preparation_required'
    assert snapshot.workers[0].environment == {}
    assert snapshot.profile == 'debug' and len(snapshot.generation) == 64
    assert env == before and not (tmp_path / 'cache').exists()


def test_packaged_receipt_detects_modified_executable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = declare(tmp_path / 'apps', 'alpha')
    data = json.loads(path.read_text())
    data['runtimeProvider'] = 'runtime.py'
    path.write_text(json.dumps(data))
    binary = path.parent / 'binary'
    binary.write_bytes(b'accepted')
    binary.chmod(0o755)
    (path.parent / 'runtime.py').write_text(
        'from app.cli.native_runtime import NativeRuntimeResult\n'
        'def prepare_runtime(context):\n'
        '    return NativeRuntimeResult({}, executable=context.app_root / "binary")\n')
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: Path('/server'))
    env = {'TE2_SERVER_APP_ROOTS': str(tmp_path / 'apps')}
    bootstrap._prepare_native_workers(bootstrap._parse_args([]), env, build=False)
    context = decode_context(env[CONTEXT_ENV])
    assert bootstrap.native_selection_snapshot(env, context).workers[0].status == 'ready'
    binary.write_bytes(b'changed')
    assert bootstrap.native_selection_snapshot(env, context).workers[0].status == 'preparation_required'


def test_owner_auth_schema_and_no_context() -> None:
    asyncio.run(check_owner_auth_schema_and_no_context())


async def check_owner_auth_schema_and_no_context() -> None:
    def selector(env, context):
        pytest.fail('unauthorized/invalid request reached selector')
    app = Starlette(routes=native_selection_owner_routes('secret', {}, selector))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://owner') as client:
        assert (await client.post('/internal/native-runtime/select', json={'schema_version': 1})).status_code == 401
        headers = {'x-te2-owner-key': 'secret'}
        for value in [{'schema_version': 2}, {'schema_version': 1, 'roots': ['/arbitrary']}]:
            assert (await client.post('/internal/native-runtime/select', json=value, headers=headers)).status_code == 400
        response = await client.post('/internal/native-runtime/select', json={'schema_version': 1}, headers=headers)
        assert response.status_code == 503 and response.headers['cache-control'] == 'no-store'
        assert (await client.post('/internal/native-runtime/select', content=b'x' * 4097, headers=headers)).status_code == 413


def test_owner_returns_typed_snapshot_without_environment_disclosure() -> None:
    asyncio.run(check_owner_returns_typed_snapshot_without_environment_disclosure())


async def check_owner_returns_typed_snapshot_without_environment_disclosure() -> None:
    def selector(env, context):
        assert env['unrelated_secret'] == 'not-in-response'
        return SelectionSnapshot(1, context.profile, context.packaged, 'a' * 64, [])
    env = {CONTEXT_ENV: encode_context(SelectionContext(1, 'release', False, {})),
           'unrelated_secret': 'not-in-response'}
    app = Starlette(routes=native_selection_owner_routes('secret', env, selector))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://owner') as client:
        response = await client.post('/internal/native-runtime/select', json={'schema_version': 1},
            headers={'x-te2-owner-key': 'secret'})
        assert response.status_code == 200
        assert response.json()['workers'] == []
        assert 'not-in-response' not in response.text


def test_owner_single_flight_survives_request_cancellation() -> None:
    asyncio.run(check_owner_single_flight_survives_request_cancellation())


async def check_owner_single_flight_survives_request_cancellation() -> None:
    started, release, finished = threading.Event(), threading.Event(), threading.Event()
    def selector(env, context):
        started.set()
        try:
            assert release.wait(5)
            return SelectionSnapshot(1, context.profile, context.packaged, 'a' * 64, [])
        finally:
            finished.set()
    env = {CONTEXT_ENV: encode_context(SelectionContext(1, 'release', False, {}))}
    app = Starlette(routes=native_selection_owner_routes('secret', env, selector))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://owner') as client:
        async def request():
            return await client.post('/internal/native-runtime/select', json={'schema_version': 1},
                headers={'x-te2-owner-key': 'secret'})
        pending = asyncio.create_task(request())
        try:
            assert await asyncio.to_thread(started.wait, 2)
            assert (await request()).json()['error'] == 'nativeSelection.busy'
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
            assert (await request()).json()['error'] == 'nativeSelection.busy'
        finally:
            release.set()
            assert await asyncio.to_thread(finished.wait, 2)


def test_manifest_system_exit_is_an_owner_error_not_loop_shutdown() -> None:
    async def check():
        def selector(env, context):
            raise SystemExit('invalid manifest')
        env = {CONTEXT_ENV: encode_context(SelectionContext(1, 'release', False, {}))}
        app = Starlette(routes=native_selection_owner_routes('secret', env, selector))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://owner') as client:
            for _ in range(2):
                response = await client.post('/internal/native-runtime/select', json={'schema_version': 1},
                    headers={'x-te2-owner-key': 'secret'})
                assert response.status_code == 503
                assert response.json()['error'] == 'nativeSelection.failed'
    asyncio.run(check())


def test_provider_change_during_preparation_cannot_receive_fresh_receipt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = declare(tmp_path / 'apps', 'alpha')
    env = {'TE2_SERVER_APP_ROOTS': str(tmp_path / 'apps'), 'TE2_CACHE_HOME': str(tmp_path / 'cache')}
    before = dict(env)
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: None)
    def prepare(worker, environment, *, packaged):
        data = json.loads(path.read_text())
        data['features'] = ['changed']
        path.write_text(json.dumps(data))
        return NativeRuntimeResult({})
    monkeypatch.setattr(bootstrap, '_app_runtime', prepare)
    monkeypatch.setattr(bootstrap, '_prepare_native_build', lambda *a, **k: (tmp_path / 'unused', False))
    with pytest.raises(SystemExit, match='changed during preparation'):
        bootstrap._prepare_native_workers(bootstrap._parse_args([]), env, build=False)
    assert env == before
