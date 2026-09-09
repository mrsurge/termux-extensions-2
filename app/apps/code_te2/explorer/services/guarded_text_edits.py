# pyright: strict
"""Single-use draft consent for disk edits prepared by backend search/diff producers."""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
import logging
from pathlib import Path, PurePosixPath
import secrets
import time

from ...restore_activity import active_paths
from ...stores import get_history_store
from ...worker_services.event_bus import build_event, current_project_generation, publish
from ...worker_services.text_edit_service import ExactEdit, apply_disk_edits
from .git_comparison import selected_ref
from .guarded_restore import project_disk_result


@dataclass(frozen=True)
class EditIntent:
    project: Path
    client: str
    path: str
    generation: int
    revision: int
    draft: bool
    source_sha256: str
    edits: tuple[ExactEdit, ...]
    comparison: str | None
    expires: float


_pending: OrderedDict[str, EditIntent] = OrderedDict()
_operations: set[asyncio.Task[dict[str, object]]] = set()
logger = logging.getLogger(__name__)


def _check(intent: EditIntent) -> None:
    history = get_history_store()
    project = str(intent.project)
    if history.get_active_project() != project or current_project_generation(intent.project) != intent.generation:
        raise ValueError('Project changed; confirm edit again')
    if intent.comparison is not None and selected_ref(intent.project) != intent.comparison:
        raise ValueError('Comparison changed; confirm edit again')
    if history.get_document_revision(project, str(intent.project / intent.path)) != intent.revision:
        raise ValueError('Draft state changed; confirm edit again')


def prepare(
    project: Path, client: str, path: str, source_sha256: str,
    edits: tuple[ExactEdit, ...], *, comparison: str | None = None,
) -> dict[str, object]:
    """Retain backend-generated edits, never a mutable frontend patch payload."""
    # Lexical validation is cheap; Rust remains the filesystem/symlink authority.
    relative = PurePosixPath(path)
    if (not path or relative.is_absolute() or str(relative) != path
            or any(part in ('.', '..', '.git') for part in relative.parts)):
        raise ValueError('Invalid edit path')
    if len(source_sha256) != 64 or any(c not in '0123456789abcdefABCDEF' for c in source_sha256):
        raise ValueError('Invalid edit source hash')
    # Bound retained confirmations as well as the Rust request itself.
    if len(edits) > 10000 or sum(len(e.expected_text.encode('utf-8')) + len(e.replacement.encode('utf-8')) for e in edits) > 750 * 1024:
        raise ValueError('Edit confirmation too large')
    history = get_history_store()
    if not client or history.get_active_project() != str(project):
        raise ValueError('Active project/client required')
    generation = current_project_generation(project)
    if generation is None:
        raise ValueError('Project is not ready for edits')
    absolute = str(project / path)
    intent = EditIntent(project, client, path, generation,
        history.get_document_revision(str(project), absolute),
        bool((history.get_cached_document(str(project), absolute) or {}).get('unsaved')),
        source_sha256.lower(), edits, comparison, time.monotonic() + 300)
    _check(intent)
    now = time.monotonic()
    for token, old in list(_pending.items()):
        if old.expires <= now:
            del _pending[token]
    while len(_pending) >= 64:
        _ = _pending.popitem(last=False)
    token = secrets.token_urlsafe(24)
    _pending[token] = intent
    return {'token': token, 'path': path, 'hasDraft': intent.draft}


async def execute(
    project: Path, client: str, path: str, token: str, *, discard_draft: bool,
) -> dict[str, object]:
    intent = _pending.get(token)
    if intent is None or intent.expires <= time.monotonic():
        raise ValueError('Edit confirmation expired; confirm again')
    if (intent.project, intent.client, intent.path) != (project, client, path):
        raise ValueError('Edit confirmation target mismatch')
    del _pending[token]
    _check(intent)
    if intent.draft and not discard_draft:
        raise ValueError('Explicit draft-discard confirmation required')
    absolute = str(project / path)
    if absolute in active_paths:
        raise ValueError('This file already has an edit in progress')
    # Share the watcher suppression/ownership slot with whole-file Restore.
    active_paths.add(absolute)
    task = asyncio.create_task(_execute_owned(intent), name='guarded_text_edit')
    _operations.add(task)
    task.add_done_callback(_done)
    return await asyncio.shield(task)


def _done(task: asyncio.Task[dict[str, object]]) -> None:
    _operations.discard(task)
    if not task.cancelled() and task.exception() is not None:
        logger.warning('Guarded text edit failed: %s', task.exception())


async def _execute_owned(intent: EditIntent) -> dict[str, object]:
    project = str(intent.project)
    absolute = str(intent.project / intent.path)
    try:
        _check(intent)
        result = await apply_disk_edits(intent.project, intent.path, intent.source_sha256, intent.edits)
        # Consent is not an early clear: failed/no-op writes leave drafts intact.
        if not result.changed:
            return {'ok': True, 'path': intent.path, 'changed': False, 'draftRetained': intent.draft}
        history = get_history_store()
        newer = history.get_document_revision(project, absolute) != intent.revision
        if not newer:
            cleared = history.clear_cached_document(project, absolute)
            if intent.draft and not cleared:
                newer = True
            else:
                _ = history.advance_document_revision(project, absolute)
        revision = history.get_document_revision(project, absolute)
        await publish(build_event('GitSnapshotRequested', project_root=intent.project,
            project_generation=intent.generation, source='guarded_text_edit', payload={}))
        _ = await project_disk_result(intent.project, intent.path, intent.generation,
            absolute, revision, newer, result.content_sha256)
        return {'ok': True, 'path': intent.path, 'changed': True,
                'draftRetained': newer, 'directorySynced': result.directory_synced}
    finally:
        active_paths.discard(absolute)
