from __future__ import annotations

from contextlib import nullcontext
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from framework.bootstrap import bootstrap


@pytest.fixture
def worker_setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    project = tmp_path / 'project'
    framework = project / 'framework'
    workspace = framework / 'native_editor_worker'
    (workspace / 'src').mkdir(parents=True)
    (project / 'app').mkdir()
    (workspace / 'Cargo.toml').write_text('[package]\nname="worker"\nversion="0.1.0"\n')
    (workspace / 'Cargo.lock').write_text('version = 4\n')
    (workspace / 'src/main.rs').write_text('fn main() {}\n')
    registry = project / 'app/native_worker_builds.json'
    registry.write_text(json.dumps({'schemaVersion': 1, 'workers': [{
        'appId': 'code_te2', 'manifest': 'native_editor_worker/Cargo.toml',
        'binary': 'code-te2-worker', 'environmentKey': 'CODE_TE2_WORKER_BIN', 'pythonAbi': True,
    }]}))
    monkeypatch.setattr(bootstrap, '_project_root', lambda: project)
    monkeypatch.setattr(bootstrap, '_source_root', lambda: framework)
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: None)
    monkeypatch.setattr(bootstrap.subprocess, 'check_output', lambda *args, **kwargs: 'rustc test toolchain')
    env = dict(os.environ, TE2_CACHE_HOME=str(tmp_path / 'cache'))
    return workspace, registry, env


def test_cached_worker_publication_reuses_and_invalidates_source(worker_setup, monkeypatch):
    workspace, _, env = worker_setup
    calls = []
    def compile_worker(command, *, env, check):
        calls.append((command, env))
        binary = Path(env['CARGO_TARGET_DIR']) / 'release/code-te2-worker'
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes(b'compiled-test-executable')
        binary.chmod(0o755)
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr(bootstrap.subprocess, 'run', compile_worker)
    args = bootstrap._parse_args(['--build-only'])
    bootstrap._prepare_native_workers(args, env, build=True)
    selected = Path(env['CODE_TE2_WORKER_BIN'])
    assert selected.is_file() and os.access(selected, os.X_OK)
    assert selected.is_relative_to(Path(env['TE2_CACHE_HOME']) / 'code_te2/build/bin')
    assert calls[0][1]['PYO3_PYTHON'] == sys.executable
    assert '--locked' in calls[0][0] and '--bin' in calls[0][0]
    bootstrap._prepare_native_workers(args, env, build=True)
    assert len(calls) == 1
    (workspace / 'src/main.rs').write_text('fn main() { println!("changed"); }')
    bootstrap._prepare_native_workers(args, env, build=True)
    assert len(calls) == 2
    assert Path(env['CODE_TE2_WORKER_BIN']) != selected
    assert not selected.exists()


def test_worker_identity_includes_python_abi(worker_setup, monkeypatch):
    _, _, env = worker_setup
    worker = bootstrap._native_worker_registry()[0]
    before = bootstrap._native_worker_fingerprint(worker, 'release', env)
    original = bootstrap.sysconfig.get_config_var
    monkeypatch.setattr(bootstrap.sysconfig, 'get_config_var', lambda key: 'different-abi' if key == 'SOABI' else original(key))
    assert bootstrap._native_worker_fingerprint(worker, 'release', env) != before


def test_shared_asset_policy_invalidates_both_binary_caches(worker_setup):
    workspace, _, env = worker_setup
    worker = bootstrap._native_worker_registry()[0]
    policy = workspace.parent / 'asset_gzip.rs'
    policy.write_text('// gzip policy v1\n')
    native_before = bootstrap._native_worker_fingerprint(worker, 'release', env)
    server_before = bootstrap._rust_source_fingerprint(workspace / 'Cargo.toml', profile='release', features=[])
    policy.write_text('// gzip policy v2\n')
    assert bootstrap._native_worker_fingerprint(worker, 'release', env) != native_before
    assert bootstrap._rust_source_fingerprint(workspace / 'Cargo.toml', profile='release', features=[]) != server_before


def test_failed_worker_build_never_selects(worker_setup, monkeypatch):
    _, _, env = worker_setup
    monkeypatch.setattr(bootstrap.subprocess, 'run', lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 9))
    with pytest.raises(SystemExit) as error:
        bootstrap._prepare_native_workers(bootstrap._parse_args([]), env, build=True)
    assert error.value.code == 9
    assert 'CODE_TE2_WORKER_BIN' not in env


def test_print_worker_plan_does_not_build_or_create_cache(worker_setup, monkeypatch):
    _, _, env = worker_setup
    monkeypatch.setattr(bootstrap.subprocess, 'run', lambda *args, **kwargs: pytest.fail('must not build'))
    bootstrap._prepare_native_workers(bootstrap._parse_args([]), env, build=False)
    assert 'CODE_TE2_WORKER_BIN' in env
    assert not Path(env['TE2_CACHE_HOME']).exists()


def test_registry_rejects_manifest_escape(worker_setup):
    _, registry, _ = worker_setup
    data = json.loads(registry.read_text())
    data['workers'][0]['manifest'] = '../outside/Cargo.toml'
    registry.write_text(json.dumps(data))
    with pytest.raises(SystemExit, match='within the framework'):
        bootstrap._native_worker_registry()


def test_binary_release_does_not_fall_back_to_worker_cargo(worker_setup, monkeypatch):
    _, _, env = worker_setup
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: Path('/package/bin/te2-server'))
    monkeypatch.setattr(bootstrap.subprocess, 'run', lambda *args, **kwargs: pytest.fail('must not build'))
    with pytest.raises(SystemExit, match='refusing a Cargo fallback'):
        bootstrap._prepare_native_workers(bootstrap._parse_args([]), env, build=True)


@pytest.mark.parametrize('build_only', [True, False])
def test_bootstrap_prepares_workers_before_launch(monkeypatch, build_only):
    env = {}
    calls = []
    monkeypatch.setattr(bootstrap, '_build_env', lambda args: env)
    monkeypatch.setattr(bootstrap, '_framework_migration_guard', lambda env: nullcontext())
    monkeypatch.setattr(bootstrap, '_server_command', lambda *args, **kwargs: bootstrap.ServerCommand(['/server'], True))
    monkeypatch.setattr(bootstrap, '_prepare_native_workers', lambda args, env, **kwargs: calls.append('workers'))
    monkeypatch.setattr(bootstrap, '_run_child', lambda *args, **kwargs: calls.append('launch') or 0)
    assert bootstrap.main(['--build-only'] if build_only else []) == 0
    assert calls == (['workers'] if build_only else ['workers', 'launch'])


def test_source_package_includes_registry_and_worker_sources():
    import tomllib
    root = Path(__file__).resolve().parents[1]
    config = tomllib.loads((root / 'pyproject.toml').read_text())['tool']['setuptools']
    assert 'native_worker_builds.json' in config['package-data']['app']
    assert 'framework/native_editor_worker/Cargo.lock' in config['data-files']['te2/framework/native_editor_worker']
    assert config['data-files']['te2/framework/native_editor_worker/src'] == ['framework/native_editor_worker/src/*.rs']
    import yaml
    shell = yaml.safe_load((root / 'app/apps/code_te2/shellspec/app_worker.yaml').read_text())['shells']['app-worker']
    assert shell['backend'] == 'pipe'
    assert shell['command'][0] == '${env:CODE_TE2_WORKER_BIN}'
    assert shell['command'][1:] == ['${ctx:PROJECT_ROOT}', '${free_port}']


def test_source_change_during_build_refuses_publication(worker_setup, monkeypatch):
    workspace, _, env = worker_setup
    def compile_worker(command, *, env, check):
        binary = Path(env['CARGO_TARGET_DIR']) / 'release/code-te2-worker'
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes(b'test')
        binary.chmod(0o755)
        (workspace / 'src/main.rs').write_text('changed during compile')
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr(bootstrap.subprocess, 'run', compile_worker)
    with pytest.raises(SystemExit, match='changed during build'):
        bootstrap._prepare_native_workers(bootstrap._parse_args([]), env, build=True)
    assert 'CODE_TE2_WORKER_BIN' not in env
    assert not (Path(env['TE2_CACHE_HOME']) / 'code_te2/build/bin').exists()
