"""Review-only contextual hunks and exact draft replacements (never disk writes)."""
from __future__ import annotations

import difflib
from dataclasses import dataclass
from pathlib import Path
from ...worker_services.text_edit_service import ExactEdit

MAX_REVIEW_CHARS = 1024 * 1024


def read_disk(path: Path) -> str:
    try:
        with path.open('rb') as stream:
            raw = stream.read(MAX_REVIEW_CHARS * 4 + 1)
    except FileNotFoundError:
        return ''
    if len(raw) > MAX_REVIEW_CHARS * 4:
        raise ValueError('File too large for draft hunk review')
    return raw.decode('utf-8', errors='replace')


@dataclass(frozen=True)
class ReviewHunk:
    display: dict[str, object]
    edits: tuple[tuple[int, int, str], ...]
    disk_edits: tuple[ExactEdit, ...]


def build_hunks(disk: str, draft: str) -> list[ReviewHunk]:
    if len(disk) > MAX_REVIEW_CHARS or len(draft) > MAX_REVIEW_CHARS:
        raise ValueError('File too large for draft hunk review')
    old, new = disk.splitlines(keepends=True), draft.splitlines(keepends=True)
    offsets = [0]
    for line in new:
        offsets.append(offsets[-1] + len(line))
    byte_offsets = [0]
    for line in old:
        byte_offsets.append(byte_offsets[-1] + len(line.encode('utf-8')))
    result: list[ReviewHunk] = []
    for group in difflib.SequenceMatcher(None, old, new, autojunk=False).get_grouped_opcodes(n=3):
        lines: list[dict[str, object]] = []
        edits: list[tuple[int, int, str]] = []
        disk_edits: list[ExactEdit] = []
        for tag, i, end_i, j, end_j in group:
            if tag != 'equal':
                edits.append((offsets[j], offsets[end_j], ''.join(old[i:end_i])))
                disk_edits.append(ExactEdit(byte_offsets[i], byte_offsets[end_i], ''.join(old[i:end_i]), ''.join(new[j:end_j])))
            if tag in ('equal', 'replace', 'delete'):
                kind = 'context' if tag == 'equal' else 'del-draft'
                lines.extend({'type': kind, 'text': line.rstrip('\r\n')} for line in old[i:end_i])
            if tag in ('replace', 'insert'):
                lines.extend({'type': 'add-draft', 'text': line.rstrip('\r\n')} for line in new[j:end_j])
        first, last = group[0], group[-1]
        result.append(ReviewHunk({'oldStart': first[1] + 1, 'oldLines': last[2] - first[1],
            'newStart': first[3] + 1, 'newLines': last[4] - first[3], 'lines': lines}, tuple(edits), tuple(disk_edits)))
    return result


def revert_hunk(disk: str, draft: str, index: int) -> str:
    return revert_hunks(disk, draft, [index])


def revert_hunks(disk: str, draft: str, indexes: list[int]) -> str:
    hunks = build_hunks(disk, draft)
    if not indexes or len(set(indexes)) != len(indexes) or any(type(index) is not int or not 0 <= index < len(hunks) for index in indexes):
        raise ValueError('Draft hunk no longer exists')
    result = draft
    edits = [edit for index in indexes for edit in hunks[index].edits]
    for start, end, replacement in sorted(edits, reverse=True):
        result = result[:start] + replacement + result[end:]
    return result
