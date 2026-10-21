from __future__ import annotations

from contextlib import redirect_stdout
import hashlib
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import sysconfig
import shutil
import subprocess
import sys
import time

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/mypyc_build_workflow.py'
spec = importlib.util.spec_from_file_location('mypyc_build_workflow_test', SCRIPT)
assert spec is not None and spec.loader is not None
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)


@pytest.mark.parametrize('parallel', [None, 2])
def test_compile_progress_counts_success_and_up_to_date_targets(monkeypatch, parallel):
    from setuptools import Distribution, Extension
    from setuptools.command.build_ext import build_ext

    class Compiler:
        def _compile(self, obj, src, ext, cc_args, extra_postargs, pp_opts):
            print('detail stays in build log')

    def build_extension(command, extension):
        if extension.name != 'cached':
            for source in extension.sources:
                command.compiler._compile('object.o', source, '.c', [], [], [])

    monkeypatch.setattr(build_ext, 'build_extension', build_extension)
    output = io.StringIO()
    command_type = workflow.progress_build_ext(output)
    extensions = [Extension('first', ['one.c', 'shared.c']),
                  Extension('second', ['shared.c']), Extension('cached', ['cached.c'])]
    command = command_type(Distribution({'ext_modules': extensions}))
    command.ensure_finalized()
    compiler = Compiler()
    original = compiler._compile
    command.compiler = compiler
    command.parallel = parallel
    with redirect_stdout(io.StringIO()) as log:
        command.build_extensions()
    lines = output.getvalue().splitlines()
    assert lines[0] == '[mypyc 0/4] C compilation targets'
    assert [line.split(']')[0] for line in lines[1:]] == [
        f'[mypyc {index}/4' for index in range(1, 5)]
    assert sum('Compiled' in line for line in lines) == 3
    assert any('shared.c [first]' in line for line in lines)
    assert any('shared.c [second]' in line for line in lines)
    assert sum('Up-to-date cached.c' in line for line in lines) == 1
    assert 'detail stays in build log' in log.getvalue()
    assert 'detail stays in build log' not in output.getvalue()
    assert compiler._compile == original


def test_compile_progress_failure_does_not_complete_and_restores_compiler(monkeypatch):
    from setuptools import Distribution, Extension
    from setuptools.command.build_ext import build_ext

    class Compiler:
        def _compile(self, obj, src, ext, cc_args, extra_postargs, pp_opts):
            raise RuntimeError('compiler failed')

    def build_extension(command, extension):
        command.compiler._compile('object.o', extension.sources[0], '.c', [], [], [])

    monkeypatch.setattr(build_ext, 'build_extension', build_extension)
    output = io.StringIO()
    command = workflow.progress_build_ext(output)(Distribution({
        'ext_modules': [Extension('failed', ['failed.c'])]}))
    command.ensure_finalized()
    compiler = Compiler()
    original = compiler._compile
    command.compiler = compiler
    with pytest.raises(RuntimeError, match='compiler failed'):
        command.build_extensions()
    assert output.getvalue() == '[mypyc 0/1] C compilation targets\n'
    assert compiler._compile == original


@pytest.mark.parametrize(('counters', 'expected'), [
    ({'direct_cache_hit': 1, 'cache_miss': 0}, 'cache hit'),
    ({'direct_cache_miss': 1, 'preprocessed_cache_hit': 1}, 'cache hit'),
    ({'cache_miss': 1}, 'cache miss'),
    ({'unsupported_compiler_option': 1}, 'uncached'),
    ({'disabled': 1}, 'uncached'),
    ({'stats_updated_timestamp': 123, 'local_storage_read_hit': 1}, 'cache status unknown'),
    ({'direct_cache_hit': 'yes'}, 'cache status unknown'),
    ({'direct_cache_hit': True}, 'cache status unknown'),
    ([], 'cache status unknown'),
])
def test_per_target_cache_statistics(tmp_path, monkeypatch, counters, expected):
    log = tmp_path / 'stats.log'
    log.write_text('fixture')

    def stats(command, **kwargs):
        assert command == ['ccache', '--print-log-stats', '--format=json']
        assert kwargs['env']['CCACHE_STATSLOG'] == str(log)
        return subprocess.CompletedProcess(command, 0, json.dumps(counters), '')

    monkeypatch.setattr(workflow.subprocess, 'run', stats)
    assert workflow.ccache_target_status('ccache', log) == expected


@pytest.mark.parametrize('failure', ['missing', 'invalid', 'exit', 'timeout'])
def test_cache_observation_failure_is_not_a_build_failure(tmp_path, monkeypatch, failure):
    log = tmp_path / 'stats.log'
    if failure != 'missing':
        log.write_text('fixture')

    def stats(command, **kwargs):
        if failure == 'timeout':
            raise subprocess.TimeoutExpired(command, 5)
        return subprocess.CompletedProcess(command, 1 if failure == 'exit' else 0, 'invalid', '')

    monkeypatch.setattr(workflow.subprocess, 'run', stats)
    assert workflow.ccache_target_status('ccache', log) == 'cache status unknown'
    assert workflow.ccache_target_status(None, log) == 'uncached'


@pytest.mark.parametrize('method', ['call', 'spawn'])
def test_cache_observer_is_per_context_and_does_not_change_environment(tmp_path, method):
    from contextvars import ContextVar, copy_context

    class Compiler:
        pass

    commands = []
    compiler = Compiler()

    def execute(command, **kwargs):
        commands.append((command, kwargs))

    setattr(compiler, method, execute)
    current = ContextVar('test_target', default=None)
    first = workflow.CacheInvocation(tmp_path / 'first.log')
    second = workflow.CacheInvocation(tmp_path / 'second.log')
    ctx1, ctx2 = copy_context(), copy_context()
    ctx1.run(current.set, first)
    ctx2.run(current.set, second)
    environment = dict(os.environ)
    command = ['/usr/bin/ccache', 'cc', '-c', 'test.c', '-o', 'test.o']
    with workflow.observe_compiler_cache(compiler, current) as available:
        assert available
        ctx1.run(getattr(compiler, method), command, env={'CUSTOM': 'preserved'})
        ctx2.run(getattr(compiler, method), command)
        getattr(compiler, method)(command)
    assert commands[0] == ([command[0], f'stats_log={first.log_path}', *command[1:]],
                           {'env': {'CUSTOM': 'preserved'}})
    assert commands[1][0][1] == f'stats_log={second.log_path}'
    assert commands[2][0] is command
    assert command[1] == 'cc'
    assert getattr(compiler, method) is execute
    assert dict(os.environ) == environment


def test_real_ccache_miss_then_hit_in_isolated_cache(tmp_path):
    executable = shutil.which('ccache')
    compiler = shutil.which('cc')
    if executable is None or compiler is None:
        pytest.skip('requires ccache and a C compiler')
    source = tmp_path / 'sample.c'
    source.write_text('int sample(void) { return 1; }\n')
    env = {key: value for key, value in os.environ.items() if not key.startswith('CCACHE_')}
    env['CCACHE_DIR'] = str(tmp_path / 'cache')
    env['CCACHE_CONFIGPATH'] = str(tmp_path / 'empty.conf')
    (tmp_path / 'empty.conf').write_text('')
    for expected, name in [('cache miss', 'miss'), ('cache hit', 'hit')]:
        target = workflow.CacheInvocation(tmp_path / (name + '.log'))
        command = target.command([executable, compiler, '-c', str(source),
                                  '-o', str(tmp_path / 'sample.o')])
        subprocess.run(command, env=env, check=True)
        assert workflow.ccache_target_status(target.executable, target.log_path) == expected


def test_real_build_ext_reports_target_cache_results(tmp_path, monkeypatch):
    from setuptools import Distribution, Extension

    executable = shutil.which('ccache')
    compiler = shutil.which('cc')
    if executable is None or compiler is None:
        pytest.skip('requires ccache and a C compiler')
    for key in os.environ:
        if key.startswith('CCACHE_'):
            monkeypatch.delenv(key)
    config = tmp_path / 'ccache.conf'
    config.write_text('')
    monkeypatch.setenv('CC', f'{executable} {compiler}')
    monkeypatch.setenv('CCACHE_DIR', str(tmp_path / 'isolated-cache'))
    monkeypatch.setenv('CCACHE_CONFIGPATH', str(config))
    source = tmp_path / 'fixture.c'
    source.write_text('int fixture(void) { return 1; }\n')
    output = io.StringIO()
    for expected in ['Compiled (cache miss)', 'Cache hit']:
        output.seek(0)
        output.truncate()
        command = workflow.progress_build_ext(output, cache_enabled=True)(Distribution({
            'ext_modules': [Extension('fixture', [str(source)])]}))
        command.build_lib = str(tmp_path / 'lib')
        command.build_temp = str(tmp_path / 'temp')
        command.force = True
        command.ensure_finalized()
        command.run()
        assert f'[mypyc 1/1] {expected} fixture.c' in output.getvalue()
    assert not list(tmp_path.rglob('.ccache-target-*'))


@pytest.fixture(autouse=True)
def working_ccache(monkeypatch):
    monkeypatch.setattr(workflow, 'ccache_health', lambda: (True, ''))


def snapshot(path, *, abi=None):
    path.mkdir(parents=True)
    (path / 'manifest.json').write_text('{}')
    (path / 'lib').mkdir()
    (path / 'lib/module.so').write_bytes(b'fixture')
    (path / 'artifact.json').write_text(json.dumps({
        'workflow': 'te2-mypyc-snapshot', 'schema': 1, 'validated': True,
        'toolchain': {'soabi': abi or sysconfig.get_config_var('SOABI')},
        'manifest_sha256': hashlib.sha256(b'{}').hexdigest(),
        'libraries': {'lib/module.so': hashlib.sha256(b'fixture').hexdigest()},
    }))
    return path


def test_source_digest_changes_without_changing_toolchain_cache_key(tmp_path):
    path = tmp_path / 'module.py'
    path.write_text('x = 1')
    modules = {'module': str(path)}
    first = workflow.source_digest(tmp_path, modules)
    path.write_text('x = 2')
    assert workflow.source_digest(tmp_path, modules) != first
    assert workflow.cache_key({'abi': 'one', 'sources': ['module.py']}) == workflow.cache_key({'sources': ['module.py'], 'abi': 'one'})
    assert workflow.cache_key({'abi': 'two'}) != workflow.cache_key({'abi': 'one'})


def test_lock_rejects_concurrent_writer(tmp_path):
    with workflow.build_lock(tmp_path / 'lock'):
        with pytest.raises(RuntimeError, match='another mypyc'):
            with workflow.build_lock(tmp_path / 'lock'):
                pytest.fail('second writer acquired lock')


def test_activation_keeps_previous_and_does_not_modify_libraries(tmp_path):
    old = snapshot(tmp_path / 'old')
    new = snapshot(tmp_path / 'new')
    active = tmp_path / 'active'
    active.symlink_to(old)
    workflow.activate(new, active)
    assert active.resolve() == new
    assert active.with_name('active-previous').resolve() == old
    workflow.activate(new, active)
    assert active.with_name('active-previous').resolve() == old
    assert (old / 'lib/module.so').read_bytes() == b'fixture'


@pytest.mark.parametrize('failure', ['abi', 'library', 'manifest', 'unvalidated', 'directory'])
def test_activation_failure_preserves_active(tmp_path, failure):
    old = snapshot(tmp_path / 'old')
    new = snapshot(tmp_path / 'new', abi='wrong' if failure == 'abi' else None)
    active = tmp_path / 'active'
    active.symlink_to(old)
    if failure == 'library':
        (new / 'lib/module.so').write_bytes(b'changed')
    if failure == 'manifest':
        (new / 'manifest.json').write_text('changed')
    if failure == 'unvalidated':
        data = json.loads((new / 'artifact.json').read_text())
        data['validated'] = False
        (new / 'artifact.json').write_text(json.dumps(data))
    if failure == 'directory':
        active.unlink()
        active.mkdir()
    with pytest.raises(RuntimeError):
        workflow.activate(new, active)
    assert active.is_dir() if failure == 'directory' else active.resolve() == old


def test_prune_is_dry_run_and_protects_active_previous_legacy_and_release(tmp_path):
    root = tmp_path / 'snapshots'
    root.mkdir()
    managed = [snapshot(root / str(i)) for i in range(5)]
    for i, path in enumerate(managed):
        os.utime(path, ns=(i + 1, i + 1))
    legacy = root / 'legacy'
    legacy.mkdir()
    release = root / '.release'
    snapshot(release)
    (root / 'alias').symlink_to(managed[1])
    active = tmp_path / 'active'
    active.symlink_to(managed[0])
    active.with_name('active-previous').symlink_to(managed[1])
    assert workflow.prune(root, active) == [managed[2]]
    assert managed[2].exists()
    workflow.prune(root, active, apply=True)
    assert not managed[2].exists()
    assert all(path.exists() for path in [*managed[:2], *managed[3:], legacy, release])


def test_compiler_cache_restores_environment_and_sets_bound(tmp_path, monkeypatch):
    monkeypatch.delenv('NO_CACHE', raising=False)
    monkeypatch.setenv('CC', 'old-cc')
    monkeypatch.delenv('CCACHE_DIR', raising=False)
    monkeypatch.delenv('CCACHE_MAXSIZE', raising=False)
    monkeypatch.setattr(workflow.shutil, 'which', lambda name: '/usr/bin/ccache')
    with workflow.compiler_cache(tmp_path, {'cc': ['/usr/bin/cc']}) as enabled:
        assert enabled
        assert os.environ['CC'] == '/usr/bin/ccache /usr/bin/cc'
        assert os.environ['CCACHE_MAXSIZE'] == '512M'
    assert os.environ['CC'] == 'old-cc'
    assert 'CCACHE_DIR' not in os.environ


def test_compiler_cache_honors_local_budget_and_explicit_override(tmp_path, monkeypatch):
    monkeypatch.delenv('NO_CACHE', raising=False)
    monkeypatch.delenv('CCACHE_MAXSIZE', raising=False)
    monkeypatch.setattr(workflow.shutil, 'which', lambda name: '/usr/bin/ccache')
    cache = tmp_path / 'ccache'
    cache.mkdir()
    (cache / 'ccache.conf').write_text('max_size = 1 GiB\ncompression = true\n')
    with workflow.compiler_cache(tmp_path, {'cc': ['/usr/bin/cc']}):
        assert 'CCACHE_MAXSIZE' not in os.environ
        assert os.environ['CCACHE_DIR'] == str(cache)
    monkeypatch.setenv('CCACHE_MAXSIZE', '768M')
    with workflow.compiler_cache(tmp_path, {'cc': ['/usr/bin/cc']}):
        assert os.environ['CCACHE_MAXSIZE'] == '768M'
    assert os.environ['CCACHE_MAXSIZE'] == '768M'


@pytest.mark.parametrize('supported', [True, False])
def test_snapshot_clone_or_copy_never_shares_mutable_inode(tmp_path, monkeypatch, supported):
    monkeypatch.setattr(workflow.sys, 'platform', 'linux')
    source = tmp_path / 'mutable.so'
    target = tmp_path / 'snapshot.so'
    source.write_bytes(b'original')

    def clone(dst, request, src):
        assert request == 0x40049409
        if not supported:
            raise OSError(errno.EOPNOTSUPP, 'no reflinks')
        os.write(dst, os.read(src, 1024))

    monkeypatch.setattr(workflow.fcntl, 'ioctl', clone)
    assert workflow.clone_or_copy_library(source, target) is supported
    assert source.stat().st_ino != target.stat().st_ino
    source.write_bytes(b'updated!')
    assert target.read_bytes() == b'original'
    target.write_bytes(b'snapshot')
    assert source.read_bytes() == b'updated!'


def test_android_snapshot_copy_skips_restricted_clone_ioctl(tmp_path, monkeypatch):
    source, target = tmp_path / 'source.so', tmp_path / 'target.so'
    source.write_bytes(b'original')
    monkeypatch.setattr(workflow.sys, 'platform', 'android')
    monkeypatch.setattr(workflow.fcntl, 'ioctl', lambda *args: pytest.fail('Android must not attempt FICLONE'))
    assert workflow.clone_or_copy_library(source, target) is False
    assert source.stat().st_ino != target.stat().st_ino
    source.write_bytes(b'updated')
    assert target.read_bytes() == b'original'
    with pytest.raises(FileExistsError):
        workflow.clone_or_copy_library(source, target)


def test_android_snapshot_copy_failure_is_not_suppressed(tmp_path, monkeypatch):
    source, target = tmp_path / 'source.so', tmp_path / 'target.so'
    source.write_bytes(b'original')
    monkeypatch.setattr(workflow.sys, 'platform', 'android')
    def denied(*args):
        raise PermissionError(errno.EACCES, 'copy denied')
    monkeypatch.setattr(workflow.shutil, 'copyfile', denied)
    with pytest.raises(PermissionError):
        workflow.clone_or_copy_library(source, target)
    assert not target.exists()
    assert source.read_bytes() == b'original'


def test_clone_failure_preserves_existing_target_and_propagates_disk_full(tmp_path, monkeypatch):
    monkeypatch.setattr(workflow.sys, 'platform', 'linux')
    source, target = tmp_path / 'source.so', tmp_path / 'target.so'
    source.write_bytes(b'source')
    target.write_bytes(b'existing')
    with pytest.raises(FileExistsError):
        workflow.clone_or_copy_library(source, target)
    assert target.read_bytes() == b'existing'
    target.unlink()
    def full(*args):
        raise OSError(errno.ENOSPC, 'disk full')
    monkeypatch.setattr(workflow.fcntl, 'ioctl', full)
    with pytest.raises(OSError) as error:
        workflow.clone_or_copy_library(source, target)
    assert error.value.errno == errno.ENOSPC
    assert not target.exists()
    assert source.read_bytes() == b'source'


def test_explicit_no_cache_disables_even_user_wrapped_compiler(tmp_path, monkeypatch):
    monkeypatch.setenv('NO_CACHE', '1')
    monkeypatch.setenv('CC', 'ccache cc')
    monkeypatch.setenv('CCACHE_DISABLE', 'old')
    monkeypatch.setattr(workflow.shutil, 'which', lambda name: pytest.fail('must not enable cache'))
    with workflow.compiler_cache(tmp_path, {'cc': ['cc']}) as enabled:
        assert not enabled
        assert os.environ['CCACHE_DISABLE'] == '1'
        assert os.environ['CC'] == 'cc'
    assert os.environ['CCACHE_DISABLE'] == 'old'
    assert os.environ['CC'] == 'ccache cc'


def test_broken_ccache_falls_back_and_restores_environment(tmp_path, monkeypatch):
    monkeypatch.delenv('NO_CACHE', raising=False)
    monkeypatch.setenv('CC', 'ccache cc')
    monkeypatch.setattr(workflow, 'ccache_health', lambda: (False, 'linker symbol missing'))
    with workflow.compiler_cache(tmp_path, {'cc': ['cc']}) as enabled:
        assert not enabled
        assert os.environ['CC'] == 'cc'
    assert os.environ['CC'] == 'ccache cc'


def test_finished_fingerprint_tracks_source_toolchain_and_recipe(tmp_path):
    identity = {'soabi': 'abi'}
    first = workflow.build_fingerprint(tmp_path, identity, 'source1')
    assert workflow.build_fingerprint(tmp_path, identity, 'source1') == first
    assert workflow.build_fingerprint(tmp_path, identity, 'source2') != first
    assert workflow.build_fingerprint(tmp_path, {'soabi': 'new-abi'}, 'source1') != first
    (tmp_path / 'scripts').mkdir()
    (tmp_path / 'scripts/mypyc_build_workflow.py').write_text('# changed recipe')
    assert workflow.build_fingerprint(tmp_path, identity, 'source1') != first


def test_fingerprint_tracks_mypy_policy_not_package_version(tmp_path):
    config = tmp_path / 'pyproject.toml'
    identity = {'soabi': 'abi'}
    config.write_text('[project]\nversion = "1.0"\n[tool.mypy]\nstrict = true\n')
    first = workflow.build_fingerprint(tmp_path, identity, 'source')
    config.write_text('[project]\nversion = "2.0"\n[tool.mypy]\nstrict = true\n')
    assert workflow.build_fingerprint(tmp_path, identity, 'source') == first
    config.write_text('[project]\nversion = "2.0"\n[tool.mypy]\nstrict = false\n')
    assert workflow.build_fingerprint(tmp_path, identity, 'source') != first


def test_compiler_uses_actual_strict_config_from_any_working_directory(tmp_path, monkeypatch):
    main = pytest.importorskip('mypy.main')
    repo = SCRIPT.parents[1]
    source = str(repo / 'app/apps/code_te2/code_server_install_state.py')
    monkeypatch.chdir(tmp_path)
    args = workflow.mypy_build_args(repo, [source])
    assert args == ['--config-file', str(repo / 'pyproject.toml'), source]
    _, options = main.process_options(args)
    for name in ('disallow_any_generics', 'disallow_subclassing_any',
                 'disallow_untyped_defs', 'disallow_incomplete_defs',
                 'check_untyped_defs', 'warn_return_any', 'strict_equality'):
        assert getattr(options, name) is True, name


def test_reuse_requires_integrity_and_fingerprint(tmp_path):
    path = snapshot(tmp_path / 'snapshot')
    metadata = json.loads((path / 'artifact.json').read_text())
    metadata['build_fingerprint'] = 'matching'
    (path / 'artifact.json').write_text(json.dumps(metadata))
    assert workflow.reusable_snapshot(path, 'matching')
    assert not workflow.reusable_snapshot(path, 'other')
    (path / 'lib/module.so').write_bytes(b'corrupted')
    with pytest.raises(RuntimeError, match='checksum mismatch'):
        workflow.reusable_snapshot(path, 'matching')


def test_status_identifies_current_stale_and_missing(tmp_path, monkeypatch):
    source = tmp_path / 'module.py'
    source.write_text('value = 1')
    path = snapshot(tmp_path / 'snapshot')
    manifest = {'modules': {'module': str(source)}, 'compiled_sources': ['module.py']}
    (path / 'manifest.json').write_text(json.dumps(manifest))
    identity = {'soabi': sysconfig.get_config_var('SOABI')}
    metadata = json.loads((path / 'artifact.json').read_text())
    digest = workflow.source_digest(tmp_path, manifest['modules'])
    metadata.update(source_digest=digest, toolchain=identity,
        manifest_sha256=hashlib.sha256((path / 'manifest.json').read_bytes()).hexdigest(),
        build_fingerprint=workflow.build_fingerprint(tmp_path, identity, digest))
    (path / 'artifact.json').write_text(json.dumps(metadata))
    monkeypatch.setattr(workflow, 'toolchain', lambda *a: identity)
    assert workflow.snapshot_status(tmp_path, path)[0] == 'current'
    source.write_text('value = 2')
    assert workflow.snapshot_status(tmp_path, path)[0] == 'stale'
    assert workflow.snapshot_status(tmp_path, tmp_path / 'missing')[0] == 'missing'


def test_fingerprinted_build_reuses_snapshot_without_compilation(tmp_path, monkeypatch):
    from scripts import probe_code_te2_mypyc as probe
    repo = tmp_path / 'repo'
    repo.mkdir()
    (repo / 'module.py').write_text('value = 1')
    modules = {'module': str(repo / 'module.py')}
    identity = {'soabi': sysconfig.get_config_var('SOABI')}
    digest = workflow.source_digest(repo, modules)
    fingerprint = workflow.build_fingerprint(repo, identity, digest)
    selected = snapshot(tmp_path / 'snapshots' / f'domain-{fingerprint}')
    metadata = json.loads((selected / 'artifact.json').read_text())
    metadata['build_fingerprint'] = fingerprint
    metadata['source_digest'] = digest
    (selected / 'artifact.json').write_text(json.dumps(metadata))
    monkeypatch.setattr(probe, 'REPO', repo)
    monkeypatch.setattr(probe, 'toolchain', lambda *a: identity)
    monkeypatch.setenv('NO_CACHE', '1')
    calls = []
    def inventory_only(command, **kwargs):
        calls.append(command)
        assert 'inventory' in command
        Path(command[command.index('--output') + 1]).write_text(json.dumps({'modules': modules}))
    monkeypatch.setattr(probe.subprocess, 'run', inventory_only)
    monkeypatch.setattr(probe, 'compiler_cache', lambda *a: pytest.fail('matching snapshot must not compile'))
    result = probe.build(tmp_path / 'snapshots' / 'request', tmp_path / 'compiler', fingerprinted=True)
    assert result == selected and len(calls) == 1


def test_status_rejects_abi_and_corruption(tmp_path, monkeypatch):
    source = tmp_path / 'module.py'
    source.write_text('value = 1')
    path = snapshot(tmp_path / 'snapshot', abi='wrong-abi')
    manifest = {'modules': {'module': str(source)}, 'compiled_sources': ['module.py']}
    (path / 'manifest.json').write_text(json.dumps(manifest))
    metadata = json.loads((path / 'artifact.json').read_text())
    metadata.update(source_digest=workflow.source_digest(tmp_path, manifest['modules']),
        manifest_sha256=hashlib.sha256((path / 'manifest.json').read_bytes()).hexdigest())
    (path / 'artifact.json').write_text(json.dumps(metadata))
    assert workflow.snapshot_status(tmp_path, path)[0] == 'incompatible'
    (path / 'lib/module.so').write_bytes(b'corrupted')
    status, detail = workflow.snapshot_status(tmp_path, path)
    assert status == 'incompatible' and 'checksum mismatch' in detail


@pytest.mark.parametrize('failure', [None, 'validation', 'source-change'])
def test_snapshot_publish_is_validated_copied_and_failure_safe(tmp_path, monkeypatch, failure):
    repo = tmp_path / 'repo'
    repo.mkdir()
    source = repo / 'module.py'
    source.write_text('value = 1')
    modules = {'module': str(source)}
    digest = workflow.source_digest(repo, modules)
    cache = tmp_path / 'cache'
    (cache / 'lib').mkdir(parents=True)
    binary = cache / 'lib' / ('module' + sysconfig.get_config_var('EXT_SUFFIX'))
    binary.write_bytes(b'compiled-fixture')
    (cache / 'startup.json').write_text('{}')
    (cache / 'build.log').write_text('fixture build')
    output = tmp_path / 'snapshot'
    def validate(*args, **kwargs):
        if failure == 'validation':
            raise subprocess.CalledProcessError(1, args[0])
        if failure == 'source-change':
            source.write_text('value = 2')
    monkeypatch.setattr(workflow.subprocess, 'run', validate)
    def publish():
        workflow.publish_snapshot(repo, cache, output, {'modules': modules}, ['module'],
                                  {'soabi': sysconfig.get_config_var('SOABI')}, digest, 1.0, lambda lib: None)
    if failure:
        with pytest.raises((RuntimeError, subprocess.CalledProcessError)):
            publish()
        assert not output.exists()
    else:
        publish()
        assert workflow.read_artifact(output)['validated'] is True
        binary.write_bytes(b'future-rebuild')
        assert (output / 'lib' / binary.name).read_bytes() == b'compiled-fixture'
    assert not list(tmp_path.glob('.mypyc-publish-*'))


@pytest.mark.skipif(os.environ.get('TE2_MYPYC_CACHE_BENCHMARK') != '1', reason='opt-in real compiler benchmark')
def test_real_shared_group_reuses_unchanged_compilation(tmp_path):
    if shutil.which('ccache') is None:
        pytest.skip('ccache not installed')
    (tmp_path / 'a.py').write_text('def value() -> int:\n    return 1\n')
    (tmp_path / 'b.py').write_text('def other() -> str:\n    return "unchanged"\n')
    code = '''
from setuptools import setup
from mypyc.build import mypycify
setup(name="cache-fixture", ext_modules=mypycify(["a.py", "b.py"], multi_file=True, target_dir="csrc"),
      script_args=["build_ext", "--build-lib", "lib", "--build-temp", "temp"])
'''
    cc = str(sysconfig.get_config_var('CC')).split()[0]
    durations = []
    with workflow.compiler_cache(tmp_path / 'compiler-cache', {'cc': [cc]}):
        def stats():
            return {key: int(value) for key, value in
                    (line.split() for line in subprocess.check_output(['ccache', '--print-stats'], text=True).splitlines())}
        for iteration in range(3):
            if iteration == 2:
                (tmp_path / 'a.py').write_text('def value() -> int:\n    return 2\n')
            started = time.monotonic()
            result = subprocess.run([sys.executable, '-B', '-c', code], cwd=tmp_path,
                                    capture_output=True, text=True, timeout=120)
            assert result.returncode == 0, result.stdout + result.stderr
            durations.append(round(time.monotonic() - started, 3))
            if iteration == 1:
                before_change = stats()
        final = stats()
        hits_before = sum(before_change.get(name, 0) for name in ('direct_cache_hit', 'preprocessed_cache_hit'))
        hits_after = sum(final.get(name, 0) for name in ('direct_cache_hit', 'preprocessed_cache_hit'))
        assert hits_after > hits_before, final
        assert final['cache_miss'] > before_change['cache_miss'], 'changed module must be compiled'
        result = subprocess.run([sys.executable, '-B', '-c',
                                 'import sys; sys.path.insert(0, "lib"); import a,b; assert a.value()==2; assert b.other()=="unchanged"'],
                                cwd=tmp_path, capture_output=True, text=True)
        assert result.returncode == 0, result.stdout + result.stderr
        print({'seconds_clean_noop_changed': durations,
               'changed_build_hits': hits_after - hits_before,
               'changed_build_misses': final['cache_miss'] - before_change['cache_miss']})
