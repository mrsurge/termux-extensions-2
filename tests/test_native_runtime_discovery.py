"""Neutral multi-app tests: no native compiler or live runtime involved."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from framework.bootstrap import bootstrap


def declare(root: Path, app_id: str, *, folder: str | None = None) -> Path:
    app = root / (folder or app_id)
    (app / 'native/src').mkdir(parents=True)
    (app / 'manifest.json').write_text(json.dumps({'id': app_id}))
    (app / 'native/Cargo.toml').write_text('[package]\nname="sample"\nversion="0.1.0"\n')
    (app / 'native/src/main.rs').write_text('fn main() {}')
    path = app / 'native_build.json'
    path.write_text(json.dumps({
        'schemaVersion': 1, 'appId': app_id, 'manifestBase': 'app',
        'manifest': 'native/Cargo.toml', 'binary': app_id,
        'environmentKey': app_id.upper().replace('-', '_') + '_BIN',
        'cache': {'root': app_id, 'targetDirectory': 'target', 'publishedDirectory': 'bin'},
        'fingerprint': {'policy': 'framework-source-v2', 'inputs': ['Cargo.toml', 'src/**/*.rs']},
    }))
    return path


def test_second_root_and_alias_owner_are_discovered_without_import(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    first, second = tmp_path / 'builtin', tmp_path / 'second'
    declare(first, 'alpha')
    path = declare(second, 'beta-worker', folder='beta_folder')
    data = json.loads(path.read_text())
    data['runtimeProvider'] = 'runtime.py'
    path.write_text(json.dumps(data))
    (path.parent / 'runtime.py').write_text('raise AssertionError("discovery imported app code")')
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: None)
    env = {'TE2_SERVER_APP_ROOTS': f'{first}:{second}:{first}', 'TE2_CACHE_HOME': str(tmp_path / 'cache')}
    workers = bootstrap._native_worker_registry(env)
    assert [worker.app_id for worker in workers] == ['alpha', 'beta-worker']
    selection = bootstrap.select_native_build(workers[1], env, profile='release',
        features=(), root=tmp_path / 'cache')
    assert not selection.usable
    assert not (tmp_path / 'cache').exists()
    assert selection.receipt == selection.executable.with_name('beta-worker.build.json')


def test_multiple_native_apps_prepare_without_special_cases(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / 'apps'
    declare(root, 'alpha')
    declare(root, 'beta')
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: None)
    monkeypatch.setattr(bootstrap.startup_progress, 'run_build', lambda *a, **k: pytest.fail('unexpected Cargo'))
    env = {'TE2_SERVER_APP_ROOTS': str(root), 'TE2_CACHE_HOME': str(tmp_path / 'cache')}
    bootstrap._prepare_native_workers(bootstrap._parse_args([]), env, build=False)
    assert Path(env['ALPHA_BIN']).name == 'alpha'
    assert Path(env['BETA_BIN']).name == 'beta'
    assert not (tmp_path / 'cache').exists()


@pytest.mark.parametrize('value', ['../outside.py', '/absolute.py', 'runtime.txt'])
def test_provider_escape_rejects_before_execution(tmp_path: Path, value: str) -> None:
    path = declare(tmp_path, 'alpha')
    data = json.loads(path.read_text())
    data['runtimeProvider'] = value
    path.write_text(json.dumps(data))
    with pytest.raises(SystemExit, match='runtimeProvider'):
        bootstrap._native_worker_registry({'TE2_SERVER_APP_ROOTS': str(tmp_path)})


def test_duplicate_identity_preserves_registry_first_root_precedence(tmp_path: Path) -> None:
    first = declare(tmp_path / 'one', 'alpha')
    second = declare(tmp_path / 'two', 'alpha')
    second.write_text('shadowed invalid declaration must not be read')
    workers = bootstrap._native_worker_registry({'TE2_SERVER_APP_ROOTS': f'{tmp_path}/one:{tmp_path}/two'})
    assert len(workers) == 1
    assert workers[0].manifest.is_relative_to(first.parent)
    first.unlink()
    assert bootstrap._native_worker_registry({'TE2_SERVER_APP_ROOTS': f'{tmp_path}/one:{tmp_path}/two'}) == []


def test_distinct_apps_cannot_overwrite_same_environment_key(tmp_path: Path) -> None:
    declare(tmp_path, 'alpha')
    second = declare(tmp_path, 'beta')
    data = json.loads(second.read_text())
    data['environmentKey'] = 'ALPHA_BIN'
    second.write_text(json.dumps(data))
    with pytest.raises(SystemExit, match='Duplicate'):
        bootstrap._native_worker_registry({'TE2_SERVER_APP_ROOTS': str(tmp_path)})


def test_later_provider_failure_does_not_publish_partial_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    declare(tmp_path, 'alpha')
    path = declare(tmp_path, 'beta')
    data = json.loads(path.read_text())
    data['runtimeProvider'] = 'runtime.py'
    path.write_text(json.dumps(data))
    (path.parent / 'runtime.py').write_text('def prepare_runtime(context):\n    raise ValueError("bad runtime")\n')
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: None)
    env = {'TE2_SERVER_APP_ROOTS': str(tmp_path), 'TE2_CACHE_HOME': str(tmp_path / 'cache')}
    before = dict(env)
    with pytest.raises(ValueError, match='bad runtime'):
        bootstrap._prepare_native_workers(bootstrap._parse_args([]), env, build=False)
    assert env == before


def test_packaged_unknown_app_never_invokes_cargo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    declare(tmp_path, 'alpha')
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: Path('/server'))
    monkeypatch.setattr(bootstrap, '_prepare_native_build', lambda *a, **k: pytest.fail('Cargo fallback'))
    with pytest.raises(SystemExit, match='no runtimeProvider'):
        bootstrap._prepare_native_workers(bootstrap._parse_args([]),
            {'TE2_SERVER_APP_ROOTS': str(tmp_path)}, build=True)


def test_no_build_selection_observes_receipt_and_force_policy(tmp_path: Path) -> None:
    declare(tmp_path / 'apps', 'alpha')
    env = {'TE2_SERVER_APP_ROOTS': str(tmp_path / 'apps')}
    spec = bootstrap._native_worker_registry(env)[0]
    def select(force: bool = False) -> bootstrap.NativeBuildSelection:
        return bootstrap.select_native_build(spec, env, profile='release',
            features=(), root=tmp_path / 'cache', force_build=force)
    initial = select()
    initial.executable.parent.mkdir(parents=True)
    initial.executable.write_bytes(b'native')
    initial.executable.chmod(0o755)
    assert select().usable  # Legacy non-Python receipt exemption.
    initial.receipt.write_text('corrupt')
    assert not select().usable
    initial.receipt.write_text(json.dumps(dict(initial.compatibility)))
    assert select().usable
    assert not select(True).usable
    assert select(True).executable == initial.executable


def test_packaged_multiple_app_owned_providers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ('alpha', 'beta'):
        path = declare(tmp_path / 'apps', name)
        binary = path.parent / 'packaged-worker'
        binary.write_bytes(b'native')
        binary.chmod(0o755)
        data = json.loads(path.read_text())
        data['runtimeProvider'] = 'runtime.py'
        path.write_text(json.dumps(data))
        (path.parent / 'runtime.py').write_text(
            'from pathlib import Path\n'
            'from dataclasses import dataclass\n'
            'from app.cli.native_runtime import NativeRuntimeResult\n'
            '@dataclass\nclass Receipt:\n    valid: bool = True\n'
            'def prepare_runtime(context):\n'
            '    assert context.packaged and Receipt().valid\n'
            '    return NativeRuntimeResult({}, executable=Path(__file__).parent / "packaged-worker")\n')
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: Path('/server'))
    monkeypatch.setattr(bootstrap, '_prepare_native_build', lambda *a, **k: pytest.fail('Cargo fallback'))
    env = {'TE2_SERVER_APP_ROOTS': str(tmp_path / 'apps')}
    bootstrap._prepare_native_workers(bootstrap._parse_args([]), env, build=True)
    assert Path(env['ALPHA_BIN']).parent.name == 'alpha'
    assert Path(env['BETA_BIN']).parent.name == 'beta'
