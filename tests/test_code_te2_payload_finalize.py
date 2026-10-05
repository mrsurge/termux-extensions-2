from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile

from tests.test_code_te2_release_runtime import payload  # noqa: F401
from scripts.finalize_code_te2_payload import finalize, finalize_wheel
from app.release_runtime.code_te2 import validate_runtime


def test_controlled_repair_refreshes_payload_digest(payload: Path) -> None:
    (payload / 'bin/code-te2-worker').write_bytes(b'repaired ELF fixture')
    finalize(payload)
    validate_runtime(payload)


def test_wheel_repair_recomputes_record_and_preserves_executable(payload: Path, tmp_path: Path) -> None:
    dependency_record = payload / 'python/lib/python3.14/site-packages/example-1.0.dist-info/RECORD'
    dependency_record.parent.mkdir(parents=True)
    dependency_record.write_text('nested dependency record\n')
    finalize(payload)
    wheel = tmp_path / 'te2-0.2.352-py3-none-manylinux_2_28_x86_64.whl'
    prefix = 'app/release_runtime/code_te2/'
    with zipfile.ZipFile(wheel, 'w') as archive:
        for path in payload.rglob('*'):
            if path.is_file():
                archive.write(path, prefix + path.relative_to(payload).as_posix())
        archive.writestr('te2-0.2.352.dist-info/WHEEL', 'Wheel-Version: 1.0\nTag: py3-none-manylinux_2_28_x86_64\n')
        archive.writestr('te2-0.2.352.dist-info/RECORD', 'stale record')
        archive.writestr('te2.libs/libexample-hashed.so', b'fixture grafted ELF')
    finalize_wheel(wheel)
    with zipfile.ZipFile(wheel) as archive:
        records = list(csv.reader(io.StringIO(archive.read('te2-0.2.352.dist-info/RECORD').decode())))
        names = archive.namelist()
        assert archive.read(prefix + dependency_record.relative_to(payload).as_posix()) == b'nested dependency record\n'
        assert len(records) == len(names)
        for name, digest, size in records:
            if digest:
                content = archive.read(name)
                expected = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b'=').decode()
                assert digest == f'sha256={expected}' and int(size) == len(content)
        worker = prefix + 'bin/code-te2-worker'
        assert archive.getinfo(worker).external_attr >> 16 & 0o111
        manifest = json.loads(archive.read(prefix + 'runtime.json'))
        assert manifest['files']['bin/code-te2-worker'] == hashlib.sha256(archive.read(worker)).hexdigest()
        assert manifest['wheelLibraries']['te2.libs/libexample-hashed.so'] == hashlib.sha256(b'fixture grafted ELF').hexdigest()
