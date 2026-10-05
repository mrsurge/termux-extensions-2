from __future__ import annotations

import json
import os
from pathlib import Path
import sysconfig
import subprocess

import pytest

from app.release_runtime.code_te2 import MANIFEST, sha256, validate_runtime, python_identity
from scripts import materialize_code_te2_runtime as builder
from scripts.mypyc_build_workflow import source_digest


@pytest.fixture
def inputs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    repo = tmp_path / 'checkout'
    source = repo / 'app/apps/code_te2/native_worker.py'
    source.parent.mkdir(parents=True)
    source.write_text('value: int = 1\n')
    resource = repo / 'app/apps/code_te2/static'
    resource.mkdir()
    (resource / 'template.html').write_text('<html></html>')
    (resource / 'node_modules').mkdir()
    (resource / 'node_modules/dev.js').write_text('excluded')
    monkeypatch.setattr(builder, 'RESOURCE_PATHS', ('app/apps/code_te2/static',))
    monkeypatch.setattr(builder, 'PRIVATE_VENDOR_PATHS', ())
    snapshot = tmp_path / 'snapshot'
    library = snapshot / 'lib/app/apps/code_te2'
    library.mkdir(parents=True)
    (library / 'static').symlink_to(resource, target_is_directory=True)
    extension = library / f'native_worker{sysconfig.get_config_var("EXT_SUFFIX")}'
    extension.write_bytes(b'fixture extension')
    common = snapshot / f'lib/shared__mypyc{sysconfig.get_config_var("EXT_SUFFIX")}'
    common.write_bytes(b'fixture common group')
    modules = {'app.apps.code_te2.native_worker': str(source)}
    manifest = snapshot / 'manifest.json'
    manifest.write_text(json.dumps({'modules': modules,
        'compiled_sources': ['app/apps/code_te2/native_worker.py'], 'interpreted': []}))
    artifact = {'workflow': 'te2-mypyc-snapshot', 'schema': 1, 'validated': True,
        'toolchain': {'soabi': sysconfig.get_config_var('SOABI'), 'machine': os.uname().machine},
        'manifest_sha256': sha256(manifest), 'source_digest': source_digest(repo, modules),
        'libraries': {path.relative_to(snapshot).as_posix(): sha256(path) for path in (extension, common)}}
    (snapshot / 'artifact.json').write_text(json.dumps(artifact))
    worker = tmp_path / 'worker'
    worker.write_bytes(b'fixture executable')
    worker.chmod(0o755)
    return {'repo': repo, 'snapshot': snapshot, 'worker': worker,
            'output': tmp_path / 'payload', 'package_version': '0.2.352', 'rust_fingerprint': 'a' * 64}


def test_materialized_payload_relocates_without_checkout(inputs: dict[str, object], tmp_path: Path) -> None:
    output = builder.materialize(**inputs)  # type: ignore[arg-type]
    text = (output / 'domain/manifest.json').read_text()
    assert str(inputs['repo']) not in text
    assert (output / f'domain/lib/shared__mypyc{sysconfig.get_config_var("EXT_SUFFIX")}').is_file()
    resource = output / 'domain/lib/app/apps/code_te2/static'
    assert not resource.is_symlink()
    assert not (resource / 'node_modules').exists()
    assert (resource / 'template.html').read_text() == '<html></html>'
    # Removing source is intentionally limited to this synthetic fixture.
    builder.shutil.rmtree(inputs['repo'])
    destination = tmp_path / 'relocated'
    output.rename(destination)
    validate_runtime(destination, package_version='0.2.352')
    assert str(inputs['snapshot']) not in (destination / MANIFEST).read_text()


def test_declared_vendor_preserves_package_build_outputs(tmp_path: Path) -> None:
    source, target = tmp_path / 'vendor', tmp_path / 'copied'
    runtime = source / 'node_modules/engine.io/build/engine.io.js'
    runtime.parent.mkdir(parents=True)
    runtime.write_text('module.exports = {};')
    nested = source / 'node_modules/example/target/index.js'
    nested.parent.mkdir(parents=True)
    nested.write_text('module.exports = {};')
    builder._copy_resources(source, target, vendored=True)
    assert (target / runtime.relative_to(source)).read_bytes() == runtime.read_bytes()
    assert (target / nested.relative_to(source)).read_bytes() == nested.read_bytes()
    builder._copy_resources(source, tmp_path / 'ordinary')
    assert not (tmp_path / 'ordinary/node_modules').exists()


def test_actual_socketio_vendor_has_a_complete_copy(tmp_path: Path) -> None:
    source = builder.REPO / 'app/apps/code_te2/vendor/node_socketio'
    builder._copy_resources(source, tmp_path / 'vendor', vendored=True)
    expected = {p.relative_to(source).as_posix(): sha256(p)
                for p in source.rglob('*') if p.is_file()
                and not any(part in {'.git', '__pycache__'} for part in p.relative_to(source).parts)}
    actual = {p.relative_to(tmp_path / 'vendor').as_posix(): sha256(p)
              for p in (tmp_path / 'vendor').rglob('*') if p.is_file()}
    assert actual == expected
    assert 'node_modules/engine.io/build/engine.io.js' in actual


@pytest.mark.parametrize('failure', ['source', 'library', 'manifest', 'abi', 'resource', 'missing', 'output'])
def test_bad_inputs_do_not_publish(inputs: dict[str, object], failure: str) -> None:
    repo, snapshot, output = (Path(str(inputs[key])) for key in ('repo', 'snapshot', 'output'))
    if failure == 'source':
        (repo / 'app/apps/code_te2/native_worker.py').write_text('changed')
    elif failure == 'library':
        (snapshot / f'lib/shared__mypyc{sysconfig.get_config_var("EXT_SUFFIX")}').write_bytes(b'corrupt')
    elif failure == 'manifest':
        (snapshot / 'manifest.json').write_text('{}')
    elif failure == 'abi':
        file = snapshot / 'artifact.json'
        artifact = json.loads(file.read_text())
        artifact['toolchain']['soabi'] = 'wrong'
        file.write_text(json.dumps(artifact))
    elif failure == 'resource':
        (repo / 'app/apps/code_te2/static/escape').symlink_to(repo / 'app/apps/code_te2/native_worker.py')
    elif failure == 'missing':
        file = snapshot / 'artifact.json'
        artifact = json.loads(file.read_text())
        common = f'lib/shared__mypyc{sysconfig.get_config_var("EXT_SUFFIX")}'
        artifact['libraries'] = {common: sha256(snapshot / common)}
        file.write_text(json.dumps(artifact))
    else:
        output.mkdir()
        (output / 'user-file').write_text('preserve')
    with pytest.raises(RuntimeError):
        builder.materialize(**inputs)  # type: ignore[arg-type]
    if failure == 'output':
        assert (output / 'user-file').read_text() == 'preserve'
    else:
        assert not output.exists()
    assert not list(output.parent.glob('.code-te2-publish-*'))


def test_private_payload_materializes_contained_links_and_sources(inputs: dict[str, object],
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    prefix = tmp_path / 'python'
    for relative in ('bin/python3.14', 'lib/libpython3.14.so.1.0', 'lib/python3.14/encodings/__init__.py'):
        path = prefix / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'fixture runtime')
    (prefix / 'bin/python3.14').chmod(0o755)
    (prefix / 'lib/libpython3.14.so').symlink_to('libpython3.14.so.1.0')
    dependencies = tmp_path / 'dependencies'
    dependencies.mkdir()
    (dependencies / 'dependency.py').write_text('value = 1')
    monkeypatch.setattr(builder.subprocess, 'run', lambda *args, **kwargs:
        subprocess.CompletedProcess([], 0, stdout=json.dumps(python_identity())))
    inputs.update(private_python=prefix, private_dependencies=dependencies)
    output = builder.materialize(**inputs)  # type: ignore[arg-type]
    selected = validate_runtime(output)
    assert selected.source_root == output / 'domain/lib'
    assert selected.python_home == output / 'python'
    assert (output / 'python/lib/libpython3.14.so').is_file()
    assert not (output / 'python/lib/libpython3.14.so').is_symlink()
    assert (output / 'python/lib/python3.14/site-packages/dependency.py').is_file()
    assert (output / 'domain/lib/app/apps/code_te2/native_worker.py').is_file()


@pytest.mark.parametrize('failure', ['escape', 'cycle'])
def test_private_runtime_rejects_unsafe_links(tmp_path: Path, failure: str) -> None:
    root = tmp_path / 'root'
    root.mkdir()
    target = tmp_path / 'outside' if failure == 'escape' else root
    target.mkdir(exist_ok=True)
    (root / 'link').symlink_to(target, target_is_directory=True)
    with pytest.raises(RuntimeError, match='escape|cycle'):
        builder._copy_private_tree(root, tmp_path / 'out', boundary=root)
