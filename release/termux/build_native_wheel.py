"""Assemble an Android wheel from matched native build artifacts.

Run on ordinary Termux CPython 3.14. Compilation and runtime activation are
separate: this command does neither and never uploads a release. Production
assembly requires --release-tag matching the version and clean source HEAD.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import sysconfig
import tarfile
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.materialize_code_te2_runtime import materialize
from app.release_runtime.code_te2 import sha256


def validate_release_source(tag: str | None, version: str, commit: str,
                            dirty: str, tag_commit: str | None) -> bool:
    if tag is None:
        return False
    if tag != version or tag_commit != commit or dirty:
        raise ValueError('production assembly requires the version tag at clean source HEAD')
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--worker', type=Path, required=True)
    parser.add_argument('--server', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--release-tag', help='Production version tag; omitted means validation only')
    args = parser.parse_args()
    if (sys.platform != 'android' or sys.version_info[:2] != (3, 14)
            or sysconfig.get_config_var('Py_GIL_DISABLED') or os.uname().machine != 'aarch64'):
        parser.error('requires ordinary Termux CPython 3.14 on AArch64')
    output = args.output.expanduser().absolute()
    if output.exists():
        parser.error('output must be a new directory')
    server = args.server.resolve(strict=True)
    info = json.loads(subprocess.check_output([str(server), '--build-info'], text=True))
    if 'ferrous-framework-native' not in info.get('features', []):
        parser.error('server lacks ferrous-framework-native')
    import tomllib
    version = tomllib.loads((ROOT / 'pyproject.toml').read_text())['project']['version']
    if info.get('version') != version:
        parser.error('server/package versions differ')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True)
    tag_commit = (subprocess.check_output(
        ['git', 'rev-parse', f'refs/tags/{args.release_tag}^{{commit}}'],
        cwd=ROOT, text=True).strip() if args.release_tag else None)
    eligible = validate_release_source(args.release_tag, version, commit, dirty, tag_commit)
    output.mkdir(parents=True)
    source = output / 'source'
    source.mkdir()
    archive_path = output / 'source.tar'
    with archive_path.open('wb') as archive:
        subprocess.run(['git', 'archive', commit], cwd=ROOT, stdout=archive, check=True)
    with tarfile.open(archive_path) as archive:
        archive.extractall(source, filter='data')
    patch = subprocess.check_output(['git', 'diff', '--binary', 'HEAD'], cwd=ROOT)
    if patch:
        subprocess.run(['git', 'apply', '-'], cwd=source, input=patch, check=True)
    (output / 'source.patch').write_bytes(patch)
    payload = materialize(repo=ROOT, snapshot=args.snapshot, worker=args.worker,
                          output=output / 'payload', package_version=version,
                          rust_fingerprint=sha256(args.worker))
    env = dict(os.environ, TE2_RELEASE_SERVER_BIN=str(server),
               TE2_RELEASE_SERVER_VERSION=version,
               TE2_RELEASE_CODE_TE2_RUNTIME=str(payload),
               TE2_RELEASE_PLATFORM_TAG='android_24_arm64_v8a',
               TE2_RELEASE_MINIMUM_GLIBC='none',
               TE2_RELEASE_TAG=args.release_tag or f'validation-termux-{version}-{commit[:8]}',
               TE2_RELEASE_COMMIT=commit)
    with (output / 'wheel-build.log').open('w') as log:
        subprocess.run([sys.executable, '-m', 'build', '--wheel', '--no-isolation',
                        '--outdir', str(output / 'dist'), str(source)], env=env, check=True,
                       stdout=log, stderr=subprocess.STDOUT)
    wheel, = (output / 'dist').glob('*.whl')
    with ZipFile(wheel) as archive:
        if any('node_modules' in Path(name).parts and '/vendor/' not in name
               for name in archive.namelist()):
            raise RuntimeError('wheel includes non-vendored development node_modules')
        if not wheel.name.endswith('-cp314-cp314-android_24_arm64_v8a.whl'):
            raise RuntimeError('unexpected Android wheel ABI/platform')
        for path in ('bin/code-te2-worker', 'runtime.json', 'domain/manifest.json'):
            archive.getinfo('app/release_runtime/code_te2/' + path)
        for path in ('engine.io/build/engine.io.js', 'socket.io/dist/index.js'):
            archive.getinfo('app/release_runtime/code_te2/domain/lib/app/apps/code_te2/'
                            'vendor/node_socketio/node_modules/' + path)
    metadata = {'publicationEligible': eligible, 'releaseTag': env['TE2_RELEASE_TAG'], 'sourceCommit': commit,
                'sourceDirty': dirty.splitlines(), 'packageVersion': version,
                'wheel': wheel.name, 'sha256': sha256(wheel),
                'serverSha256': sha256(server), 'workerSha256': sha256(args.worker)}
    (output / 'build-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
