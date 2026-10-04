from __future__ import annotations

import json
import os
from pathlib import Path
import sysconfig

import pytest

from app.release_runtime.code_te2 import MANIFEST, sha256, validate_runtime
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
