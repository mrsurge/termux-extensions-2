from __future__ import annotations

import json
from pathlib import Path
import sysconfig
import sys

import pytest

from app.release_runtime import ReleaseRuntimeError
from app.release_runtime import code_te2 as runtime
from framework.bootstrap import bootstrap
from app.apps.code_te2 import mypyc_overlay


@pytest.fixture
def payload(tmp_path: Path) -> Path:
    root = tmp_path / 'payload'
    (root / 'bin').mkdir(parents=True)
    worker = root / 'bin/code-te2-worker'
    worker.write_bytes(b'fixture executable')
    worker.chmod(0o755)
    module = root / 'domain/lib/app/apps/code_te2'
    module.mkdir(parents=True)
    (module / f'native_worker{sysconfig.get_config_var("EXT_SUFFIX")}').write_bytes(b'fixture extension')
    (root / 'domain/manifest.json').write_text(json.dumps({
        'schemaVersion': 2,
        'modules': {'app.apps.code_te2.native_worker': 'app/apps/code_te2/native_worker.py'},
        'compiled_sources': ['app/apps/code_te2/native_worker.py'],
        'interpreted': [],
    }))
    manifest: dict[str, object] = {
        'schemaVersion': 1, 'appId': 'code_te2', 'packageVersion': '0.2.352',
        'python': runtime.python_identity(), 'platform': runtime.sys.platform,
        'machine': runtime.os.uname().machine, 'libc': 'glibc',
        'executable': 'bin/code-te2-worker', 'domain': 'domain',
        'rustFingerprint': 'a' * 64, 'domainFingerprint': 'b' * 64,
        'files': {path.relative_to(root).as_posix(): runtime.sha256(path)
                  for path in root.rglob('*') if path.is_file()},
    }
    (root / runtime.MANIFEST).write_text(json.dumps(manifest))
    return root


def amend(root: Path, **values: object) -> None:
    file = root / runtime.MANIFEST
    manifest = json.loads(file.read_text())
    manifest.update(values)
    file.write_text(json.dumps(manifest))


def test_complete_set_is_relocatable(payload: Path, tmp_path: Path) -> None:
    destination = tmp_path / 'installed-runtime'
    payload.rename(destination)
    selected = runtime.validate_runtime(destination, package_version='0.2.352')
    assert selected.executable == destination / 'bin/code-te2-worker'
    assert selected.domain == destination / 'domain'


def test_portable_overlay_does_not_need_build_checkout(payload: Path, tmp_path: Path) -> None:
    paths = list(sys.path)
    finders = list(sys.meta_path)
    try:
        count = mypyc_overlay.install(str(tmp_path / 'nonexistent-checkout'), str(payload / 'domain'))
        assert count == 1
        assert str(payload / 'domain/lib') in sys.path
    finally:
        sys.path[:] = paths
        sys.meta_path[:] = finders


def test_developer_overlay_keeps_existing_absolute_inventory_support(payload: Path, tmp_path: Path) -> None:
    root = tmp_path / 'checkout'
    file = payload / 'domain/manifest.json'
    manifest = json.loads(file.read_text())
    manifest.pop('schemaVersion')
    manifest['modules'] = {'app.apps.code_te2.native_worker': str(root / 'app/apps/code_te2/native_worker.py')}
    file.write_text(json.dumps(manifest))
    paths, finders = list(sys.path), list(sys.meta_path)
    try:
        assert mypyc_overlay.install(str(root), str(payload / 'domain')) == 1
    finally:
        sys.path[:] = paths
        sys.meta_path[:] = finders


@pytest.mark.parametrize('field,value', [
    ('schemaVersion', 99), ('appId', 'other'), ('packageVersion', 'other'),
    ('python', {}), ('machine', 'other'), ('libc', 'bionic'),
    ('rustFingerprint', 'invalid'), ('domainFingerprint', 'invalid'),
    ('executable', '/outside/worker'), ('domain', '../outside'),
])
def test_bad_identity_or_paths_reject(payload: Path, field: str, value: object) -> None:
    amend(payload, **{field: value})
    with pytest.raises(ReleaseRuntimeError):
        runtime.validate_runtime(payload, package_version='0.2.352')


@pytest.mark.parametrize('action', ['missing', 'corrupt', 'symlink', 'extra', 'permission'])
def test_incomplete_or_modified_payload_rejects(payload: Path, action: str) -> None:
    worker = payload / 'bin/code-te2-worker'
    if action == 'missing':
        worker.unlink()
    elif action == 'corrupt':
        worker.write_bytes(b'changed')
    elif action == 'symlink':
        worker.rename(payload / 'other')
        worker.symlink_to(payload / 'other')
    elif action == 'extra':
        (payload / 'unexpected.py').write_text('pass')
    else:
        worker.chmod(0o644)
    with pytest.raises(ReleaseRuntimeError):
        runtime.validate_runtime(payload)


@pytest.mark.parametrize('source', ['/build-host/module.py', '../escape.py', 'a/../escape.py'])
def test_portable_inventory_rejects_build_host_or_escape_paths(source: str) -> None:
    with pytest.raises(ReleaseRuntimeError):
        runtime.compiled_module_names({
            'schemaVersion': 2, 'modules': {'app.example': source}, 'compiled_sources': [source],
        })


def test_packaged_bootstrap_exports_pair_without_cargo(payload: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from importlib import metadata
    worker = bootstrap.NativeWorkerBuild('code_te2', Path('/no/Cargo.toml'), 'code-te2-worker', 'CODE_TE2_WORKER_BIN', True)
    monkeypatch.setattr(bootstrap, '_native_worker_registry', lambda: [worker])
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: Path('/packaged-server'))
    monkeypatch.setattr(metadata, 'version', lambda name: '0.2.352')
    monkeypatch.setattr(runtime, 'packaged_runtime', lambda version: runtime.validate_runtime(payload, package_version=version))
    monkeypatch.setattr(bootstrap, '_native_worker_fingerprint', lambda *args: pytest.fail('must not invoke rustc'))
    env: dict[str, str] = {}
    bootstrap._prepare_native_workers(bootstrap._parse_args([]), env, build=True)
    assert env['CODE_TE2_WORKER_BIN'] == str(payload / 'bin/code-te2-worker')
    assert env['CODE_TE2_MYPYC_DIR'] == str(payload / 'domain')


def test_bad_packaged_pair_does_not_fall_back_to_cargo(monkeypatch: pytest.MonkeyPatch) -> None:
    from importlib import metadata
    worker = bootstrap.NativeWorkerBuild('code_te2', Path('/no/Cargo.toml'), 'code-te2-worker', 'CODE_TE2_WORKER_BIN', True)
    monkeypatch.setattr(bootstrap, '_native_worker_registry', lambda: [worker])
    monkeypatch.setattr(bootstrap, 'packaged_server_path', lambda: Path('/packaged-server'))
    monkeypatch.setattr(metadata, 'version', lambda name: '0.2.352')
    def fail(version: str) -> runtime.CodeTe2Runtime:
        raise ReleaseRuntimeError('missing matched artifact')
    monkeypatch.setattr(runtime, 'packaged_runtime', fail)
    with pytest.raises(SystemExit, match='refusing a Cargo fallback'):
        bootstrap._prepare_native_workers(bootstrap._parse_args([]), {}, build=True)


def test_release_wheel_requires_pair_and_uses_exact_cpython_tag(payload: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import runpy
    import setuptools
    from setuptools.errors import SetupError

    monkeypatch.setattr(setuptools, 'setup', lambda **kwargs: None)
    namespace = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'setup.py'))
    for key in namespace['_RELEASE_ENVIRONMENT']:
        monkeypatch.delenv(key, raising=False)
    values = {
        'TE2_RELEASE_SERVER_BIN': str(payload / 'bin/code-te2-worker'),
        'TE2_RELEASE_PLATFORM_TAG': 'manylinux_2_28_x86_64',
        'TE2_RELEASE_MINIMUM_GLIBC': '2.28', 'TE2_RELEASE_TAG': 'test-only',
        'TE2_RELEASE_COMMIT': 'a' * 40,
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    with pytest.raises(SetupError, match='TE2_RELEASE_CODE_TE2_RUNTIME'):
        namespace['_release_wheel_config']()
    monkeypatch.setenv('TE2_RELEASE_CODE_TE2_RUNTIME', str(payload))
    config = namespace['_release_wheel_config']()
    assert config.code_te2 == payload
    command = namespace['Te2BdistWheel'](setuptools.Distribution())
    command.ensure_finalized()
    python_tag, abi_tag, platform_tag = command.get_tag()
    assert python_tag == f'cp{sys.version_info.major}{sys.version_info.minor}'
    assert abi_tag.startswith(python_tag)
    assert platform_tag == 'manylinux_2_28_x86_64'


def test_wheel_build_copies_complete_payload_and_source_build_removes_it(payload: Path, tmp_path: Path,
                                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    import runpy
    import setuptools
    from setuptools.command.build_py import build_py

    monkeypatch.setattr(setuptools, 'setup', lambda **kwargs: None)
    monkeypatch.setattr(build_py, 'run', lambda self: None)
    namespace = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'setup.py'))
    for key, value in {
        'TE2_RELEASE_SERVER_BIN': str(payload / 'bin/code-te2-worker'),
        'TE2_RELEASE_CODE_TE2_RUNTIME': str(payload),
        'TE2_RELEASE_PLATFORM_TAG': 'manylinux_2_28_x86_64',
        'TE2_RELEASE_MINIMUM_GLIBC': '2.28', 'TE2_RELEASE_TAG': 'test-only',
        'TE2_RELEASE_COMMIT': 'a' * 40,
    }.items():
        monkeypatch.setenv(key, value)
    command = namespace['Te2BuildPy'](setuptools.Distribution({'version': '0.2.352'}))
    command.build_lib = str(tmp_path / 'build')
    command.run()
    installed = tmp_path / 'build/app/release_runtime'
    runtime.validate_runtime(installed / 'code_te2', package_version='0.2.352')
    for key in namespace['_RELEASE_ENVIRONMENT']:
        monkeypatch.delenv(key)
    command.run()
    assert not (installed / 'code_te2').exists()
    assert not (installed / 'bin').exists()
