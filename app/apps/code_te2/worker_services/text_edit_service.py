# pyright: strict
"""Typed disk-edit transport; callers own draft consent and result projection."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import cast

from app.libs import pipe_runtime


@dataclass(frozen=True)
class ExactEdit:
    start_byte: int
    end_byte: int
    expected_text: str
    replacement: str


@dataclass(frozen=True)
class DiskEditResult:
    path: str
    content: str
    source_sha256: str
    content_sha256: str
    changed: bool
    applied_edits: int
    directory_synced: bool


def _mapping(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("Invalid disk-edit result object")
    return cast(dict[str, object], value)


def _hash(value: object) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdefABCDEF' for c in value):
        raise ValueError("Invalid disk-edit hash")
    return value.lower()


def _result(raw: object, path: str, source_sha256: str) -> DiskEditResult:
    value = _mapping(raw)
    edit = _mapping(value.get('edit'))
    if (value.get('dto') != 'DiskEditsResult' or type(value.get('version')) is not int
            or value.get('version') != 1 or value.get('path') != path
            or edit.get('dto') != 'TextEditsResult' or type(edit.get('version')) is not int
            or edit.get('version') != 1):
        raise ValueError("Unexpected disk-edit result identity")
    content, changed = edit.get('content'), edit.get('changed')
    count, synced = edit.get('appliedEdits'), value.get('directorySynced')
    if (not isinstance(content, str) or not isinstance(changed, bool)
            or not isinstance(count, int) or isinstance(count, bool) or count < 0
            or not isinstance(synced, bool)):
        raise ValueError("Invalid disk-edit result fields")
    source = _hash(edit.get('sourceSha256'))
    output = _hash(edit.get('contentSha256'))
    if source != _hash(source_sha256):
        raise ValueError("Unexpected disk-edit source identity")
    return DiskEditResult(path, content, source, output, changed, count, synced)


async def apply_disk_edits(
    project: Path, path: str, source_sha256: str, edits: tuple[ExactEdit, ...],
) -> DiskEditResult:
    """Apply once through Rust. A timeout is not permission to retry a mutation."""
    expected = _hash(source_sha256)
    # The async pipe adapter moves its blocking wait off the app event loop.
    # No autosave/draft field is sent: this operation always targets disk.
    raw = await pipe_runtime.call_async(
        'fs.textEdits.apply',
        {'dto': 'DiskEditsRequest', 'version': 1, 'root': str(project),
         'path': path, 'expectedSha256': expected,
         'edits': [{'startByte': edit.start_byte, 'endByte': edit.end_byte,
                    'expectedText': edit.expected_text, 'replacement': edit.replacement}
                   for edit in edits]},
        target_nid=2100, target_name='service.fs', workspace_root=str(project),
        origin_name='code_te2.explorer.text_edits',
    )
    return _result(raw, path, expected)
