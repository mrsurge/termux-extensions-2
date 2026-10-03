"""Developer-only cached compilation and immutable mypyc snapshot publication."""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shlex
import shutil
import subprocess
import sys
import sysconfig
import tempfile
from typing import Callable, Iterator, cast

SCHEMA = 1


def source_digest(repo: Path, modules: dict[str, str]) -> str:
    digest = hashlib.sha256()
    for name, value in sorted(modules.items()):
        path = Path(value)
        digest.update(name.encode() + b'\0')
        digest.update(path.relative_to(repo).as_posix().encode() + b'\0')
        digest.update(path.read_bytes())
    return digest.hexdigest()


def toolchain(repo: Path, sources: list[str]) -> dict[str, object]:
    cc = shlex.split(os.environ.get('CC') or str(sysconfig.get_config_var('CC')))
    if not cc:
        raise RuntimeError('no C compiler configured')
    resolved = shutil.which(cc[0])
    if resolved is None:
        raise RuntimeError(f'C compiler not found: {cc[0]}')
    cc[0] = resolved
    version = subprocess.check_output([*cc, '--version'], text=True).splitlines()[0]
    return {
        'schema': SCHEMA, 'repo': str(repo), 'python': sys.version,
        'executable': sys.executable, 'soabi': sysconfig.get_config_var('SOABI'),
        'platform': platform.platform(), 'machine': platform.machine(),
        'mypy': importlib.metadata.version('mypy'),
        'setuptools': importlib.metadata.version('setuptools'),
        'cc': cc, 'compiler_version': version,
        'flags': {key: os.environ.get(key, '') for key in ('CFLAGS', 'CPPFLAGS', 'LDFLAGS', 'LDSHARED')},
        'sysconfig': {key: sysconfig.get_config_var(key) for key in ('CC', 'CFLAGS', 'LDSHARED', 'INCLUDEPY')},
        'sources': sorted(sources), 'opt_level': '3', 'multi_file': True,
    }


def cache_key(identity: dict[str, object]) -> str:
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:24]


@contextmanager
def build_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError(f'another mypyc build/publication owns {path}') from exc
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


@contextmanager
def compiler_cache(cache_root: Path, identity: dict[str, object]) -> Iterator[bool]:
    """Content/header/flags-aware compiler reuse; never cache linking."""
    if os.environ.get('NO_CACHE') == '1':
        previous = os.environ.get('CCACHE_DISABLE')
        os.environ['CCACHE_DISABLE'] = '1'
        try:
            yield False
        finally:
            if previous is None:
                os.environ.pop('CCACHE_DISABLE', None)
            else:
                os.environ['CCACHE_DISABLE'] = previous
        return
    executable = shutil.which('ccache')
    keys = ('CC', 'CCACHE_DIR', 'CCACHE_MAXSIZE', 'CCACHE_COMPILERCHECK')
    saved = {key: os.environ.get(key) for key in keys}
    enabled = executable is not None
    if enabled:
        compiler = identity['cc']
        assert isinstance(compiler, list)
        # Don't double-wrap a user-supplied ccache compiler command.
        command = compiler if Path(str(compiler[0])).name == 'ccache' else [executable, *compiler]
        os.environ.update(CC=shlex.join(command), CCACHE_DIR=str(cache_root / 'ccache'),
                          CCACHE_MAXSIZE='512M', CCACHE_COMPILERCHECK='content')
    try:
        yield enabled
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def publish_snapshot(repo: Path, cache: Path, output: Path, manifest: dict[str, object],
                     extension_names: list[str], identity: dict[str, object],
                     digest: str, elapsed: float, resources: Callable[[Path], None]) -> None:
    if output.exists() or output.is_symlink():
        raise RuntimeError(f'output already exists: {output}')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.mypyc-publish-', dir=output.parent) as temporary:
        stage = Path(temporary) / 'snapshot'
        stage.mkdir()
        suffix = str(sysconfig.get_config_var('EXT_SUFFIX'))
        for name in extension_names:
            relative = Path(name.replace('.', '/') + suffix)
            source = cache / 'lib' / relative
            target = stage / 'lib' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            # Copy, not hard-link: future cache rebuilds may overwrite libraries.
            shutil.copy2(source, target)
        resources(stage / 'lib')
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        shutil.copy2(cache / 'startup.json', stage / 'startup.json')
        shutil.copy2(cache / 'build.log', stage / 'build.log')
        subprocess.run([sys.executable, '-B', str(repo / 'scripts/probe_code_te2_mypyc.py'),
                        'validate', '--manifest', str(stage / 'manifest.json'),
                        '--lib', str(stage / 'lib')], cwd=repo, check=True)
        modules = manifest['modules']
        assert isinstance(modules, dict)
        if source_digest(repo, modules) != digest:
            raise RuntimeError('source changed during build; refusing snapshot publication')
        (stage / 'artifact.json').write_text(json.dumps({
            'workflow': 'te2-mypyc-snapshot', 'schema': SCHEMA, 'validated': True,
            'source_digest': digest, 'toolchain': identity, 'build_seconds': elapsed,
            'manifest_sha256': hashlib.sha256((stage / 'manifest.json').read_bytes()).hexdigest(),
            'libraries': {str(path.relative_to(stage)): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in (stage / 'lib').rglob('*.so')},
        }, indent=2))
        # Rename only after successful validation; failed builds never publish.
        stage.rename(output)


def read_artifact(path: Path) -> dict[str, object]:
    raw: object = json.loads((path / 'artifact.json').read_text())
    if not isinstance(raw, dict):
        raise RuntimeError(f'invalid snapshot metadata: {path}')
    data = cast(dict[str, object], raw)
    if data.get('workflow') != 'te2-mypyc-snapshot' or data.get('schema') != SCHEMA or data.get('validated') is not True:
        raise RuntimeError(f'not a validated managed snapshot: {path}')
    return data


def activate(snapshot: Path, link: Path) -> None:
    snapshot = snapshot.resolve(strict=True)
    data = read_artifact(snapshot)
    identity = data.get('toolchain')
    if not isinstance(identity, dict):
        raise RuntimeError('snapshot toolchain missing')
    if identity.get('soabi') != sysconfig.get_config_var('SOABI'):
        raise RuntimeError('snapshot Python ABI does not match this interpreter')
    expected_manifest = data['manifest_sha256']
    if hashlib.sha256((snapshot / 'manifest.json').read_bytes()).hexdigest() != expected_manifest:
        raise RuntimeError('snapshot manifest checksum mismatch')
    libraries = data.get('libraries')
    if not isinstance(libraries, dict) or not libraries:
        raise RuntimeError('snapshot libraries missing')
    for relative, expected in libraries.items():
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise RuntimeError('invalid snapshot library checksum')
        target = (snapshot / relative).resolve(strict=True)
        if not target.is_relative_to(snapshot) or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'snapshot library checksum mismatch: {relative}')
    link.parent.mkdir(parents=True, exist_ok=True)
    with build_lock(link.parent / '.mypyc-publication.lock'):
        if link.exists() and not link.is_symlink():
            raise RuntimeError(f'refusing to replace non-symlink: {link}')
        previous = link.with_name(link.name + '-previous')
        if previous.exists() and not previous.is_symlink():
            raise RuntimeError(f'refusing to replace non-symlink: {previous}')
        with tempfile.TemporaryDirectory(prefix='.mypyc-links-', dir=link.parent) as temporary:
            stage = Path(temporary)
            if link.is_symlink() and link.resolve() != snapshot:
                (stage / 'previous').symlink_to(link.resolve())
                (stage / 'previous').replace(previous)
            (stage / 'active').symlink_to(snapshot)
            (stage / 'active').replace(link)
    print(f'Selected {snapshot}; running workers are unchanged until restarted')


def prune(root: Path, link: Path, *, keep: int = 2, apply: bool = False) -> list[Path]:
    if keep < 2:
        raise ValueError('retain at least two snapshots')
    with build_lock(link.parent / '.mypyc-publication.lock'):
        protected = {link.resolve(), link.with_name(link.name + '-previous').resolve()}
        snapshots = []
        for path in root.iterdir():
            if path.is_symlink() or not path.is_dir() or '.release' in path.parts:
                continue
            try:
                read_artifact(path)
            except (OSError, ValueError, RuntimeError):
                continue
            snapshots.append(path)
        snapshots.sort(key=lambda path: path.stat().st_mtime_ns, reverse=True)
        retained = set(snapshots[:keep]) | protected
        candidates = [path for path in snapshots if path.resolve() not in retained]
        for path in candidates:
            print(f'{"REMOVE" if apply else "WOULD REMOVE"} {path}')
            if apply:
                shutil.rmtree(path)
        return candidates
