from __future__ import annotations

import hashlib
import importlib.util
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
    monkeypatch.setenv('CC', 'old-cc')
    monkeypatch.delenv('CCACHE_DIR', raising=False)
    monkeypatch.setattr(workflow.shutil, 'which', lambda name: '/usr/bin/ccache')
    with workflow.compiler_cache(tmp_path, {'cc': ['/usr/bin/cc']}) as enabled:
        assert enabled
        assert os.environ['CC'] == '/usr/bin/ccache /usr/bin/cc'
        assert os.environ['CCACHE_MAXSIZE'] == '512M'
    assert os.environ['CC'] == 'old-cc'
    assert 'CCACHE_DIR' not in os.environ


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
