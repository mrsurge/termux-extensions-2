"""Current-release archive operations, independent of app HTTP/presentation.

This boundary is intentionally replaceable by framework-pipe operations later.
ZIP writes are atomic; libarchive remains the read/extract implementation.
"""
from __future__ import annotations

import os
from pathlib import Path
from itertools import chain
import stat
import tempfile
from typing import cast
import zipfile

import msgspec
from libarchive import file_reader  # type: ignore[import-untyped]
from starlette.exceptions import HTTPException

from app.libs.jobs import JobContext, register_job_handler
from app.utils.paths import _resolve_user_path


def archive_path(raw: str, *, must_exist: bool) -> Path:
    from app.utils import paths
    try:
        result = _resolve_user_path(raw, must_exist=must_exist)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    if not result.is_relative_to(paths.HOME_DIR.resolve()):
        raise HTTPException(403, 'Archive path is outside the user home')
    return result


class CreateRequest(msgspec.Struct, forbid_unknown_fields=True):
    archive_path: str
    sources: list[str]
    options: dict[str, object] = msgspec.field(default_factory=dict)


class TestRequest(msgspec.Struct, forbid_unknown_fields=True):
    archive_path: str


def create_params(payload: dict[str, object]) -> dict[str, object]:
    try:
        request = msgspec.convert(payload, type=CreateRequest, strict=True)
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    if not request.sources or len(request.sources) > 1000:
        raise HTTPException(422, 'Select between 1 and 1000 source items')
    target = archive_path(request.archive_path, must_exist=False)
    if target.suffix.lower() != '.zip':
        raise HTTPException(422, 'Archive creation/update supports ZIP (.zip)')
    if any(key not in {'overwrite', 'update'} or type(value) is not bool for key, value in request.options.items()):
        raise HTTPException(422, 'Unsupported ZIP creation option')
    sources = [archive_path(source, must_exist=True) for source in request.sources]
    if any(source == target or target.is_relative_to(source) for source in sources):
        raise HTTPException(422, 'Archive destination must be outside its source items')
    if request.options.get('update') and not target.is_file():
        raise HTTPException(404, 'Archive to update does not exist')
    if target.exists() and not (request.options.get('overwrite') or request.options.get('update')):
        raise HTTPException(409, 'Archive already exists; explicit overwrite confirmation is required')
    return {'archive_path': str(target), 'sources': [str(p) for p in sources], 'options': request.options}


def test_params(payload: dict[str, object]) -> dict[str, object]:
    try:
        request = msgspec.convert(payload, type=TestRequest, strict=True)
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    target = archive_path(request.archive_path, must_exist=True)
    if not target.is_file():
        raise HTTPException(422, 'Select an archive file')
    return {'archive_path': str(target)}


def _stamp(path: Path) -> tuple[int, int, int, int] | None:
    try:
        st = path.stat()
    except FileNotFoundError:
        return None
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns


def _copy(ctx: JobContext, source: object, destination: object) -> None:
    # BinaryIO includes many unrelated methods; these are the actual stream edge.
    from typing import BinaryIO
    reader, writer = cast(BinaryIO, source), cast(BinaryIO, destination)
    while True:
        ctx.check_cancelled()
        block = reader.read(1024 * 1024)
        if not block:
            break
        writer.write(block)


@register_job_handler('create_archive')
def job_create_archive(ctx: JobContext, params: dict[str, object]) -> None:
    params = create_params(params)
    target = Path(cast(str, params['archive_path']))
    sources = [Path(value) for value in cast(list[str], params['sources'])]
    options = cast(dict[str, object], params['options'])
    receipt = _stamp(target)
    entries: dict[str, Path] = {}
    for source in sources:
        for path in chain((source,), source.rglob('*')) if source.is_dir() else (source,):
            ctx.check_cancelled()
            if path.is_symlink() or not (path.is_dir() or path.is_file()):
                raise ValueError('ZIP creation does not follow symlinks or special files')
            name = path.relative_to(source.parent).as_posix() + ('/' if path.is_dir() else '')
            if name in entries:
                raise ValueError(f'Duplicate archive path: {name}')
            entries[name] = path
            if len(entries) > 100000:
                raise ValueError('Too many archive entries')
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.te2-archive-', suffix='.zip', dir=target.parent)
    os.close(fd)
    stage = Path(temporary)
    try:
        with zipfile.ZipFile(stage, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as output:
            if options.get('update'):
                with zipfile.ZipFile(target) as previous:
                    for entry in previous.infolist():
                        ctx.check_cancelled()
                        if entry.filename in entries:
                            continue
                        if stat.S_ISLNK(entry.external_attr >> 16):
                            raise ValueError('Cannot update a ZIP containing symlinks')
                        with previous.open(entry) as src, output.open(entry, 'w', force_zip64=True) as dst:
                            _copy(ctx, src, dst)
            total = len(entries)
            for index, (name, path) in enumerate(entries.items(), 1):
                ctx.check_cancelled()
                info = zipfile.ZipInfo.from_file(path, name)
                info.compress_type = zipfile.ZIP_DEFLATED
                with output.open(info, 'w', force_zip64=True) as dst:
                    if path.is_file():
                        with path.open('rb') as src:
                            _copy(ctx, src, dst)
                ctx.set_progress(index, total, name)
        ctx.check_cancelled()
        if _stamp(target) != receipt:
            raise ValueError('Archive changed while the job was running')
        if receipt is None:
            # Atomic non-overwrite admission even when another writer races us.
            os.link(stage, target)
        else:
            os.replace(stage, target)
        ctx.finish(message=f'Archive written: {target.name}', result={'archive_path': str(target), 'destination': str(target.parent)})
    finally:
        stage.unlink(missing_ok=True)


@register_job_handler('test_archive')
def job_test_archive(ctx: JobContext, params: dict[str, object]) -> None:
    archive = Path(cast(str, test_params(params)['archive_path']))
    count = 0
    with file_reader(str(archive)) as reader:
        for entry in reader:
            ctx.check_cancelled()
            for _ in entry.get_blocks():
                ctx.check_cancelled()
            count += 1
            ctx.set_progress(count, detail=entry.pathname)
    ctx.finish(message=f'Archive verified: {count} entries', result={'archive_path': str(archive), 'entries': count})
