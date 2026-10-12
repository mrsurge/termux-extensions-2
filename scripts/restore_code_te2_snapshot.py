"""Restore an unchanged compiled domain from a verified prior wheel, not a cache.

The caller supplies the wheel digest. Current startup sources and native ABI
must match; the existing snapshot publisher imports the restored group before
publication. Resources and interpreted packaging helpers remain source-owned.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import sysconfig
import tempfile
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.materialize_code_te2_runtime import _mapping, _relative
from scripts.mypyc_build_workflow import publish_snapshot, source_digest
from scripts.probe_code_te2_mypyc import link_resources
from app.release_runtime.code_te2 import compiled_module_names


def matching_sources(repo: Path, runtime: dict[str, object], domain: dict[str, object]) -> dict[str, str]:
    identity = _mapping(runtime.get('python'), 'original Python identity')
    if (identity.get('soabi') != sysconfig.get_config_var('SOABI')
            or runtime.get('machine') != os.uname().machine
            or runtime.get('platform') != sys.platform):
        raise RuntimeError('reused domain ABI/platform mismatch')
    modules: dict[str, str] = {}
    for name, value in _mapping(domain.get('modules'), 'portable modules').items():
        if not isinstance(value, str):
            raise RuntimeError('invalid portable source path')
        path = repo / _relative(value)
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(repo.resolve()):
            raise RuntimeError('reused source is missing or escapes repository')
        modules[name] = str(path)
    if source_digest(repo, modules) != runtime.get('domainFingerprint'):
        raise RuntimeError('startup sources changed; compiled domain cannot be reused')
    return modules


def restore(wheel: Path, expected: str, output: Path) -> None:
    with wheel.open('rb') as source:
        actual = hashlib.file_digest(source, 'sha256').hexdigest()
    if actual != expected:
        raise RuntimeError('reused wheel checksum mismatch')
    prefix = 'app/release_runtime/code_te2/'
    with ZipFile(wheel) as archive:
        runtime = _mapping(json.loads(archive.read(prefix + 'runtime.json')), 'runtime')
        files = _mapping(runtime.get('files'), 'verified files')
        body = archive.read(prefix + 'domain/manifest.json')
        if hashlib.sha256(body).hexdigest() != files.get('domain/manifest.json'):
            raise RuntimeError('reused domain manifest checksum mismatch')
        domain = _mapping(json.loads(body), 'domain')
        modules = matching_sources(ROOT, runtime, domain)
        suffix = str(sysconfig.get_config_var('EXT_SUFFIX'))
        required = {f'lib/{name.replace(".", "/")}{suffix}' for name in compiled_module_names(domain)}
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.restore-domain-', dir=output.parent) as directory:
            cache = Path(directory)
            extensions: list[str] = []
            selected: set[str] = set()
            for name, digest in files.items():
                if not name.startswith('domain/lib/') or not name.endswith(suffix):
                    continue
                relative = _relative(name).relative_to('domain')
                info = archive.getinfo(prefix + name)
                if stat.S_ISLNK(info.external_attr >> 16):
                    raise RuntimeError('reused native library is a symlink')
                data = archive.read(info)
                if hashlib.sha256(data).hexdigest() != digest:
                    raise RuntimeError('reused native library checksum mismatch')
                target = cache / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                selected.add(relative.as_posix())
                extensions.append(relative.relative_to('lib').as_posix()[:-len(suffix)].replace('/', '.'))
            if not required.issubset(selected) or not any('__mypyc' in name for name in extensions):
                raise RuntimeError('reused wheel omits compiled libraries')
            manifest = dict(domain, modules=modules)
            (cache / 'startup.json').write_text(json.dumps({'count': len(modules), 'modules': modules}))
            (cache / 'build.log').write_text('Verified domain restored from wheel SHA-256 ' + actual + '\n')
            identity: dict[str, object] = {
                'soabi': sysconfig.get_config_var('SOABI'), 'machine': os.uname().machine,
                'reusedWheelSha256': actual,
            }
            publish_snapshot(ROOT, cache, output, manifest, extensions, identity,
                             source_digest(ROOT, modules), 0.0, link_resources)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wheel', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    restore(args.wheel, args.sha256, args.output)
