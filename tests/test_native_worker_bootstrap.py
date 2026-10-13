from __future__ import annotations

from contextlib import nullcontext
import json
import hashlib
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
    app = project / 'app/apps/code_te2'
    app.mkdir(parents=True)
    (workspace / 'Cargo.toml').write_text('[package]\nname="worker"\nversion="0.1.0"\n')
    (workspace / 'Cargo.lock').write_text('version = 4\n')
    (workspace / 'src/main.rs').write_text('fn main() {}\n')
    registry = app / 'native_build.json'
    registry.write_text(json.dumps({'schemaVersion': 1,
        'appId': 'code_te2', 'manifest': 'native_editor_worker/Cargo.toml',
        'binary': 'code-te2-worker', 'environmentKey': 'CODE_TE2_WORKER_BIN', 'pythonAbi': True,
        'cache': {'root': 'code_te2/build', 'targetDirectory': 'cargo-target', 'publishedDirectory': 'bin'},
        'fingerprint': {'policy': 'framework-source-v2', 'inputs': ['Cargo.toml', 'Cargo.lock', 'src/**/*.rs', 'build.rs'],
                        'sharedInputs': ['../asset_gzip.rs']},
    }))
    monkeypatch.setattr(bootstrap, '_project_root', lambda: project)
    monkeypatch.setattr(bootstrap, '_source_root', lambda: framework)
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: None)
    monkeypatch.setattr(bootstrap.subprocess, 'check_output', lambda *args, **kwargs: 'rustc test toolchain')
    env = dict(os.environ, TE2_CACHE_HOME=str(tmp_path / 'cache'))
    for key in ('CODE_TE2_WORKER_BIN', 'CODE_TE2_MYPYC_DIR'):
        env.pop(key, None)
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
    assert '--bin' in calls[0][0]
    bootstrap._prepare_native_workers(args, env, build=True)
    assert len(calls) == 1
    (workspace / 'src/main.rs').write_text('fn main() { println!("changed"); }')
    bootstrap._prepare_native_workers(args, env, build=True)
    assert len(calls) == 2
    assert Path(env['CODE_TE2_WORKER_BIN']) != selected
    assert selected.exists()  # Another running framework may still own this path.


def test_worker_identity_reuses_interpreter_aliases(worker_setup, monkeypatch):
    _, _, env = worker_setup
    worker = bootstrap._native_worker_registry()[0]
    before = bootstrap._native_worker_fingerprint(worker, 'release', env)
    monkeypatch.setattr(bootstrap.sys, 'executable', '/different/venv/bin/python3')
    assert bootstrap._native_worker_fingerprint(worker, 'release', env) == before


def test_alternating_build_flags_do_not_evict_each_other(worker_setup, monkeypatch):
    _, _, env = worker_setup
    calls = []
    def compile_worker(command, *, env, check):
        calls.append(command)
        binary = Path(env['CARGO_TARGET_DIR']) / 'release/code-te2-worker'
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes(b'compiled-test-executable')
        binary.chmod(0o755)
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr(bootstrap.subprocess, 'run', compile_worker)
    args = bootstrap._parse_args(['--build-only'])
    original_flags = env.get('CFLAGS')
    bootstrap._prepare_native_workers(args, env, build=True)
    first = Path(env['CODE_TE2_WORKER_BIN'])
    env['CFLAGS'] = (original_flags or '') + ' -DTE2_TEST_VARIANT=1'
    bootstrap._prepare_native_workers(args, env, build=True)
    second = Path(env['CODE_TE2_WORKER_BIN'])
    assert first == second and first.exists()
    if original_flags is None:
        env.pop('CFLAGS')
    else:
        env['CFLAGS'] = original_flags
    bootstrap._prepare_native_workers(args, env, build=True)
    assert Path(env['CODE_TE2_WORKER_BIN']) == first
    assert len(calls) == 1


def test_missing_default_mypyc_uses_interpreted_domain(worker_setup, capsys):
    _, _, env = worker_setup
    env.pop('CODE_TE2_MYPYC_DIR', None)
    bootstrap._select_editable_domain(env)
    assert env['CODE_TE2_MYPYC_DIR'] == ''
    assert 'interpreted' in capsys.readouterr().out


@pytest.mark.parametrize('kind', ['directory', 'broken_link'])
def test_existing_default_mypyc_remains_selected(worker_setup, kind):
    workspace, _, env = worker_setup
    env.pop('CODE_TE2_MYPYC_DIR', None)
    selected = workspace.parents[1] / '.codex-scratch/mypyc-active'
    selected.parent.mkdir()
    if kind == 'directory':
        selected.mkdir()
    else:
        selected.symlink_to(selected.parent / 'missing')
    bootstrap._select_editable_domain(env)
    assert env['CODE_TE2_MYPYC_DIR'] == str(selected)


@pytest.mark.parametrize('selection', ['', '/explicit/missing/snapshot'])
def test_explicit_editable_domain_selection_is_preserved(worker_setup, selection):
    _, _, env = worker_setup
    env['CODE_TE2_MYPYC_DIR'] = selection
    bootstrap._select_editable_domain(env)
    assert env['CODE_TE2_MYPYC_DIR'] == selection


def test_worker_compatibility_includes_python_abi(worker_setup, monkeypatch):
    _, _, env = worker_setup
    worker = bootstrap._native_worker_registry()[0]
    before = bootstrap._native_build_compatibility(worker)
    original = bootstrap.sysconfig.get_config_var
    monkeypatch.setattr(bootstrap.sysconfig, 'get_config_var', lambda key: 'different-abi' if key == 'SOABI' else original(key))
    assert bootstrap._native_build_compatibility(worker) != before


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
    data['manifest'] = '../outside/Cargo.toml'
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
    assert (root / 'app/apps/code_te2/native_build.json').is_file()
    assert 'apps/**/*' in config['package-data']['app']
    assert 'framework/bootstrap/native_build.json' in config['data-files']['te2/framework/bootstrap']
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


def test_framework_manifest_preserves_legacy_key_and_cached_binary(worker_setup, monkeypatch):
    workspace, _, env = worker_setup
    framework = workspace.parent
    source = framework / 'rust'
    (source / 'crates/te2-server/src').mkdir(parents=True)
    (source / 'Cargo.toml').write_text('[workspace]\n')
    (source / 'Cargo.lock').write_text('version = 4\n')
    (source / 'crates/te2-server/Cargo.toml').write_text('[package]\nname="te2-server"\n')
    (source / 'crates/te2-server/src/main.rs').write_text('fn main() {}\n')
    (framework / 'asset_gzip.rs').write_text('// shared policy\n')
    config = Path(bootstrap.__file__).parent / 'native_build.json'
    (framework / 'bootstrap').mkdir()
    (framework / 'bootstrap/native_build.json').write_text(config.read_text())
    spec = bootstrap._load_native_build(framework / 'bootstrap/native_build.json')
    features = ['ferrous-framework-native']
    # Exact previous algorithm, independent of new manifest input enumeration.
    hasher = hashlib.sha256()
    hasher.update(b'te2-server-build-cache-v2\0')
    for value in (str(source.resolve()), 'release', ','.join(features), sys.platform, os.uname().machine):
        hasher.update(value.encode())
        if value != os.uname().machine:
            hasher.update(b'\0')
    for path in bootstrap._rust_fingerprint_paths(source):
        hasher.update(b'\0path:' + path.relative_to(source).as_posix().encode() + b'\0')
        hasher.update(path.read_bytes())
    hasher.update(b'\0../asset_gzip.rs\0' + (framework / 'asset_gzip.rs').read_bytes())
    expected = hasher.hexdigest()[:24]
    assert bootstrap._rust_source_fingerprint(spec.manifest, profile='release',
        features=features, inputs=spec.source_inputs) == expected
    selected = Path(env['TE2_CACHE_HOME']) / 'framework/build/bin' / expected / 'release/te2-server'
    selected.parent.mkdir(parents=True)
    selected.write_bytes(b'existing-framework')
    selected.chmod(0o755)
    monkeypatch.setattr(bootstrap.subprocess, 'run', lambda *a, **k: pytest.fail('cached framework must not rebuild'))
    monkeypatch.delenv('TE2_SERVER_DISABLE_FERROUS_FRAMEWORK', raising=False)
    command = bootstrap._cached_server_command(bootstrap._parse_args([]), env, source / 'Cargo.toml', build=True)
    assert command.argv == [str(selected)] and command.build_already_done


def test_changed_abi_rebuilds_same_source_key(worker_setup, monkeypatch):
    _, _, env = worker_setup
    calls = []
    def compile_worker(command, *, env, check):
        calls.append(command)
        binary = Path(env['CARGO_TARGET_DIR']) / 'release/code-te2-worker'
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes(b'compiled-test-executable')
        binary.chmod(0o755)
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr(bootstrap.subprocess, 'run', compile_worker)
    args = bootstrap._parse_args([])
    bootstrap._prepare_native_workers(args, env, build=True)
    before = env['CODE_TE2_WORKER_BIN']
    original = bootstrap.sysconfig.get_config_var
    monkeypatch.setattr(bootstrap.sysconfig, 'get_config_var', lambda key: 'new-abi' if key == 'SOABI' else original(key))
    bootstrap._prepare_native_workers(args, env, build=True)
    assert env['CODE_TE2_WORKER_BIN'] == before and len(calls) == 2
    bootstrap._prepare_native_workers(args, env, build=True)
    assert len(calls) == 2


def test_debug_worker_uses_same_profile_rule(worker_setup, monkeypatch):
    _, _, env = worker_setup
    calls = []
    def compile_worker(command, *, env, check):
        calls.append(command)
        binary = Path(env['CARGO_TARGET_DIR']) / 'debug/code-te2-worker'
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes(b'compiled')
        binary.chmod(0o755)
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr(bootstrap.subprocess, 'run', compile_worker)
    bootstrap._prepare_native_workers(bootstrap._parse_args(['--debug']), env, build=True)
    assert '/debug/' in env['CODE_TE2_WORKER_BIN'] and '--release' not in calls[0]


@pytest.mark.parametrize('field,value', [
    ('root', '../escape'), ('targetDirectory', '/absolute'), ('publishedDirectory', '../bin')])
def test_manifest_rejects_unsafe_cache_paths(worker_setup, field, value):
    _, registry, _ = worker_setup
    data = json.loads(registry.read_text())
    data['cache'][field] = value
    registry.write_text(json.dumps(data))
    with pytest.raises(SystemExit, match='cache paths'):
        bootstrap._native_worker_registry()


def test_discovery_rejects_mismatched_app_owner(worker_setup):
    _, registry, _ = worker_setup
    data = json.loads(registry.read_text())
    data['appId'] = 'different_app'
    registry.write_text(json.dumps(data))
    with pytest.raises(SystemExit, match='owning app'):
        bootstrap._native_worker_registry()


def test_app_owned_cargo_tree_is_discoverable(worker_setup):
    _, registry, _ = worker_setup
    data = json.loads(registry.read_text())
    data['manifestBase'] = 'app'
    data['manifest'] = 'native/Cargo.toml'
    data['fingerprint']['sharedInputs'] = []
    registry.write_text(json.dumps(data))
    native = registry.parent / 'native'
    native.mkdir()
    (native / 'Cargo.toml').write_text('[package]\n')
    spec = bootstrap._native_worker_registry()[0]
    assert spec.manifest == native / 'Cargo.toml'
    data['manifest'] = '../another-app/Cargo.toml'
    registry.write_text(json.dumps(data))
    with pytest.raises(SystemExit, match='declared owning app'):
        bootstrap._native_worker_registry()
