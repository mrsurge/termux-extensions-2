"""Prepared, single-use Explorer restore intentions; Git mutations remain Rust-owned."""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
import secrets
import time
import hashlib
import logging

from ...stores import get_history_store
from ...restore_activity import active_paths
from ...worker_services import git_service
from ...worker_services.event_bus import build_event, current_project_generation, publish
from .git_comparison import selected_ref


@dataclass(frozen=True)
class RestoreIntent:
    project: Path
    client: str
    ref: str
    generation: int
    revision: int
    draft: bool
    preview: git_service.GitRestorePreview
    expires: float


_pending: OrderedDict[str, RestoreIntent] = OrderedDict()
_busy: set[tuple[str, str]] = set()
_operations: set[asyncio.Task[dict[str, object]]] = set()
logger = logging.getLogger(__name__)


def _check(intent: RestoreIntent) -> None:
    history = get_history_store()
    if history.get_active_project() != str(intent.project) or current_project_generation(intent.project) != intent.generation or selected_ref(intent.project) != intent.ref:
        raise ValueError("Project or comparison changed; confirm Restore again")
    path = str(intent.project / intent.preview['path'])
    if history.get_document_revision(str(intent.project), path) != intent.revision:
        raise ValueError("Draft state changed; confirm Restore again")


def _store(intent: RestoreIntent) -> dict[str, object]:
    now = time.monotonic()
    for key, old in list(_pending.items()):
        if old.expires <= now:
            del _pending[key]
    while len(_pending) >= 64:
        _ = _pending.popitem(last=False)
    token = secrets.token_urlsafe(24)
    _pending[token] = intent
    return {**intent.preview, 'token': token, 'hasDraft': intent.draft, 'ref': intent.ref}


async def prepare(project: Path, client: str, path: str) -> dict[str, object]:
    history = get_history_store()
    project = project.resolve()
    if not client or history.get_active_project() != str(project):
        raise ValueError("Active project/client required")
    ref = selected_ref(project)
    generation = current_project_generation(project)
    if generation is None:
        raise ValueError("Project is not ready for Restore")
    # Rust canonicalizes and validates the exact regular-file path, including symlinks.
    preview = await asyncio.to_thread(git_service.preview_restore, project, path, ref)
    absolute = str(project / preview['path'])
    revision = history.get_document_revision(str(project), absolute)
    draft = bool((history.get_cached_document(str(project), absolute) or {}).get('unsaved'))
    intent = RestoreIntent(project, client, ref, generation, revision, draft, preview, time.monotonic() + 300)
    _check(intent)
    return _store(intent)


async def execute(project: Path, client: str, path: str, token: str, *, unstage: bool, discard_draft: bool) -> dict[str, object]:
    intent = _pending.get(token)
    if intent is None or intent.expires <= time.monotonic():
        raise ValueError("Restore confirmation expired; confirm again")
    if intent.project != project.resolve() or intent.client != client or intent.preview['path'] != path:
        raise ValueError("Restore confirmation target mismatch")
    del _pending[token]
    _check(intent)
    if not unstage and intent.preview['staged']:
        raise ValueError("Unstage this file before restoring")
    if not unstage and intent.draft and not discard_draft:
        raise ValueError("Explicit draft-discard confirmation required")
    key = (str(intent.project), path)
    if key in _busy or str(intent.project / path) in active_paths:
        raise ValueError("This file already has a restore operation in progress")
    _busy.add(key)
    operation = asyncio.create_task(_execute_owned(intent, path, unstage, key), name='guarded_git_restore')
    _operations.add(operation)
    operation.add_done_callback(_operation_done)
    return await asyncio.shield(operation)


def _operation_done(operation: asyncio.Task[dict[str, object]]) -> None:
    _operations.discard(operation)
    if not operation.cancelled():
        error = operation.exception()
        if error is not None:
            logger.warning('Guarded restore failed: %s', error)


async def _execute_owned(intent: RestoreIntent, path: str, unstage: bool, key: tuple[str, str]) -> dict[str, object]:
    absolute = str(intent.project / path)
    active_paths.add(absolute)
    try:
        # Each Rust mutation rechecks HEAD/index/worktree against the prepared fingerprint.
        def mutate() -> None:
            _check(intent)
            git_service.apply_guarded_restore(intent.project, intent.preview, unstage=unstage)
        await asyncio.to_thread(mutate)
        await publish(build_event('GitSnapshotRequested', project_root=intent.project,
            project_generation=intent.generation, source='guarded_restore', payload={}))
        if unstage:
            _check(intent)
            return await prepare(intent.project, intent.client, path)
        history = get_history_store()
        absolute = str(intent.project / path)
        disk_sha = None if intent.preview['delete'] else await asyncio.to_thread(_disk_sha, absolute)
        # Never discard an edit that arrived while the off-loop Git mutation was running.
        newer_draft = history.get_document_revision(str(intent.project), absolute) != intent.revision
        if not newer_draft:
            cleared = history.clear_cached_document(str(intent.project), absolute)
            if intent.draft and not cleared:
                newer_draft = True
            else:
                _ = history.advance_document_revision(str(intent.project), absolute)
        revision = history.get_document_revision(str(intent.project), absolute)
        editor_closed = await _project_result(intent, absolute, revision, newer_draft, disk_sha)
        return {'ok': True, 'path': path, 'draftRetained': newer_draft, 'deleted': intent.preview['delete'], 'editorClosed': editor_closed is True}
    finally:
        active_paths.discard(absolute)
        _busy.discard(key)


def _disk_sha(path: str) -> str:
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


async def _project_result(intent: RestoreIntent, absolute: str, revision: int, newer_draft: bool, disk_sha: str | None) -> bool:
    return await project_disk_result(intent.project, intent.preview['path'], intent.generation,
        absolute, revision, newer_draft, disk_sha, deleted=intent.preview['delete'])


async def project_disk_result(
    project_root: Path, relative_path: str, generation: int, absolute: str,
    revision: int, newer_draft: bool, disk_sha: str | None, *, deleted: bool = False,
) -> bool:
    """Shared post-write projection; never clear drafts from an external-change event."""
    from ...monaco_editor.editor_backend_services.document_open_policy import DocumentOpenRejectedError
    from ...monaco_editor.editor_ws import (
        editor_runtime_emit_room_event,
        editor_runtime_notify_draft_state_changed,
        editor_runtime_reload_disk_content_if_active,
        editor_runtime_record_save_sha,
    )
    from ...open_state_backend import remove_sidecar_recent_file
    from ...open_state_events import publish_document_closed
    from .file_ops import mark_draft_cache_dirty, mark_git_cache_dirty

    project = str(project_root)
    editor_closed = False
    if disk_sha is not None:
        editor_runtime_record_save_sha(absolute, disk_sha)
    mark_draft_cache_dirty(project_root)
    mark_git_cache_dirty(project_root)
    editor_runtime_notify_draft_state_changed(project)
    # Earlier fact delivery may have yielded to a fresh editor draft. Do not
    # publish a clean state for that newer revision.
    if not newer_draft and get_history_store().get_document_revision(project, absolute) == revision:
        await editor_runtime_emit_room_event('editor:cache_state', {
            'path': absolute, 'state': 'clean', 'unsaved': False,
            'reason': 'discard_external', 'document_revision': revision,
        })
        current = get_history_store().get_document_revision(project, absolute) == revision
        close_membership = deleted and current
        if not deleted and current and get_history_store().get_active_project() == project:
            try:
                _ = await editor_runtime_reload_disk_content_if_active(absolute, source='historical_restore')
            except DocumentOpenRejectedError:
                close_membership = True
                editor_closed = True
        if close_membership:
            removed, state, foregrounds = remove_sidecar_recent_file(project, absolute)
            if removed:
                _ = get_history_store().remove_file(project, absolute)
                await publish_document_closed(state, closed_path=absolute, affected_foregrounds=foregrounds,
                    source='historical_restore', project_generation=generation)
    # Let WBA reconcile background documents, without the external-change path clearing newer drafts.
    await publish(build_event('GitPathRestored', project_root=project, project_generation=generation,
        source='guarded_restore', payload={'path': relative_path, 'editorProjected': True}))
    await publish(build_event('ExplorerRenderStateChanged', project_root=project, project_generation=generation,
        source='guarded_restore', payload={'reason': 'git_restore', 'directories': [str(Path(relative_path).parent)]}))
    return editor_closed
