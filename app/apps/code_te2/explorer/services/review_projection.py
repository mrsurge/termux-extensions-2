"""Atomic, generation-scoped draft review snapshots; never lightweight rows."""
from __future__ import annotations

import asyncio
import hashlib
import logging
from pathlib import Path
from typing import TypedDict
from uuid import uuid4

from ...project_sidecar import ProjectSidecar
from ...worker_services.event_bus import current_project_generation, next_project_generation
from .project_root_state import get_project_root
from .review_hunks import build_hunks, read_disk
from .review_hunks import revert_hunks
from ...stores import get_history_store
from ...worker_services.text_edit_service import apply_disk_edits
from ...restore_activity import active_paths

Row = dict[str, object]
Stamp = tuple[int, int, int]
Key = tuple[str, Stamp, int]


class ReviewProjection(TypedDict):
    projectRoot: str
    projectGeneration: int
    projectionId: str
    revision: int
    complete: bool
    entries: list[Row]


def _stamp(path: Path) -> Stamp:
    try:
        stat = path.stat()
        return (stat.st_ino, stat.st_size, stat.st_mtime_ns)
    except FileNotFoundError:
        return (0, 0, 0)


def _build(root: Path, previous: dict[str, tuple[Key, Row]]) -> dict[str, tuple[Key, Row]]:
    # Do not use list_reviews' best-effort empty-on-error result as membership
    # authority. A failed/inconsistent read must retain the last good projection.
    sidecar = ProjectSidecar.load_or_create(str(root))
    watermark, drafts = sidecar.read_review_snapshot()
    result: dict[str, tuple[Key, Row]] = {}
    for draft in drafts:
        file_path = draft.get('file_path')
        if not isinstance(file_path, str):
            continue
        path = Path(file_path)
        if not path.is_absolute() or not path.is_relative_to(root):
            continue
        rel = str(path.relative_to(root))
        content = str(draft.get('content') or '')
        stamp = _stamp(path)
        revision = draft.get('document_revision', 0)
        if type(revision) is not int:
            raise ValueError('Invalid draft revision')
        key = (hashlib.sha256(content.encode('utf-8')).hexdigest(), stamp, revision)
        cached = previous.get(rel)
        if cached is not None and cached[0] == key:
            result[rel] = cached
            continue
        disk = ''
        error: str | None = None
        try:
            disk = read_disk(path)
            hunks = build_hunks(disk, content)
        except ValueError as exc:
            # A known preview-size limit suppresses only this file's hunks.
            # I/O/decoding failures must still reject the whole snapshot.
            error = str(exc)
            hunks = []
        if _stamp(path) != stamp:
            raise RuntimeError('Draft review disk snapshot changed')
        row: Row = {'path': str(path), 'rel': rel, 'has_draft': True,
            'timestamp': draft.get('updated_at'), 'hunks': [hunk.display for hunk in hunks],
            'draftRevision': revision, 'draftSha256': key[0],
            'diskExists': path.is_file(),
            'diskSha256': hashlib.sha256(disk.encode('utf-8')).hexdigest(),
            'identity': f'{key[0]}:{stamp[0]}:{stamp[1]}:{stamp[2]}:{revision}'}
        if error is not None:
            row['error'] = error
        result[rel] = (key, row)
    next_watermark, _ = sidecar.read_review_snapshot()
    if next_watermark != watermark:
        raise RuntimeError('Draft review membership changed')
    return result


class ReviewProjectionOwner:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._identity: tuple[str, int] | None = None
        self._rows: dict[str, tuple[Key, Row]] = {}
        self._revision = 0
        self._id = uuid4().hex
        self._save_attempts: dict[str, str] = {}
        self._operations: set[asyncio.Task[Row]] = set()

    async def save_hunks(self, project: Path, rel: str, identity: str, indexes: list[int]) -> Row:
        # Caller disconnect/cancellation must not abandon post-write reconciliation.
        if len(self._operations) >= 64:
            raise ValueError('Too many draft saves pending')
        task = asyncio.create_task(self._save_hunks(project, rel, identity, indexes))
        self._operations.add(task)
        def done(finished: asyncio.Task[Row]) -> None:
            self._operations.discard(finished)
            if not finished.cancelled() and finished.exception() is not None:
                logging.getLogger(__name__).warning('Draft hunk save failed: %s', finished.exception())
        task.add_done_callback(done)
        return await asyncio.shield(task)

    async def _save_hunks(self, project: Path, rel: str, identity: str, indexes: list[int]) -> Row:
        root = project.resolve()
        path = root / rel
        absolute = str(path)
        async with self._lock:
            generation = current_project_generation(root)
            if get_project_root().resolve() != root or self._identity != (str(root), generation):
                raise ValueError('Draft review project changed')
            retained = self._rows.get(rel)
            if retained is None or retained[1].get('identity') != identity or self._save_attempts.get(absolute) == identity:
                raise ValueError('Draft changed or save already attempted; refresh before saving')
            key, row = retained
            if row.get('error') is not None or not path.is_file() or not path.resolve().is_relative_to(root):
                raise ValueError('Hunk save requires an existing file with an available preview; use whole-file Save for new files')
            if absolute in active_paths:
                raise ValueError('This file already has an edit in progress')
            # Read fresh authoritative draft, never a potentially stale store cache.
            _, drafts = ProjectSidecar.load_or_create(str(root)).read_review_snapshot()
            draft = next((item for item in drafts if item.get('file_path') == absolute), None)
            if draft is None:
                raise ValueError('Draft changed; refresh before saving')
            content = draft.get('content')
            if (not isinstance(content, str) or draft.get('document_revision', 0) != key[2]
                    or hashlib.sha256(content.encode('utf-8')).hexdigest() != key[0]):
                raise ValueError('Draft changed; refresh before saving')
            disk = read_disk(path)
            disk_sha = hashlib.sha256(disk.encode('utf-8')).hexdigest()
            if _stamp(path) != key[1] or disk_sha != row.get('diskSha256') or draft.get('base_sha256') != disk_sha:
                raise ValueError('Disk changed relative to the draft base; resolve before saving')
            hunks = await asyncio.to_thread(build_hunks, disk, content)
            _, admitted_drafts = ProjectSidecar.load_or_create(str(root)).read_review_snapshot()
            admitted = next((item for item in admitted_drafts if item.get('file_path') == absolute), None)
            if (get_project_root().resolve() != root or current_project_generation(root) != generation
                    or _stamp(path) != key[1] or admitted is None
                    or admitted.get('document_revision', 0) != key[2] or admitted.get('content') != content
                    or admitted.get('base_sha256') != disk_sha or absolute in active_paths):
                raise ValueError('Draft, disk or project changed before saving')
            if not indexes or len(set(indexes)) != len(indexes) or any(type(i) is not int or not 0 <= i < len(hunks) for i in indexes):
                raise ValueError('Draft hunk no longer exists')
            edits = tuple(edit for i in sorted(indexes) for edit in hunks[i].disk_edits)
            disk_bytes = len(disk.encode('utf-8'))
            output_bytes = disk_bytes + sum(len(e.replacement.encode('utf-8')) - len(e.expected_text.encode('utf-8')) for e in edits)
            if (len(edits) > 10000 or max(disk_bytes, output_bytes) > 375 * 1024
                    or sum(len(e.expected_text.encode('utf-8')) + len(e.replacement.encode('utf-8')) for e in edits) > 750 * 1024):
                raise ValueError('Selected hunk save exceeds pipe edit limits')
            if absolute not in self._save_attempts and len(self._save_attempts) >= 4096:
                raise ValueError('Draft save receipt limit reached')
            self._save_attempts[absolute] = identity
            active_paths.add(absolute)
            try:
                result = await apply_disk_edits(root, rel, disk_sha, edits)
                # The disk commit is complete. Reconcile the latest full draft,
                # retaining edits that arrived while the pipe request was pending.
                try:
                    if hashlib.sha256(read_disk(path).encode('utf-8')).hexdigest() != result.content_sha256:
                        raise ValueError('Disk changed again after saving')
                    _, latest = ProjectSidecar.load_or_create(str(root)).read_review_snapshot()
                    current = next((item for item in latest if item.get('file_path') == absolute), None)
                    if current is None or current.get('base_sha256') != disk_sha:
                        raise ValueError('Draft was removed or its base changed during saving')
                    latest_content = current.get('content')
                    revision = current.get('document_revision', 0)
                    if not isinstance(latest_content, str) or type(revision) is not int:
                        raise ValueError('Invalid current draft')
                    latest_sha = hashlib.sha256(latest_content.encode('utf-8')).hexdigest()
                    entry = get_history_store().replace_review_draft(str(root), absolute, revision,
                        latest_sha, latest_content, result.content_sha256, advance_base=True)
                    reconciled = True
                    message = ''
                except Exception as exc:
                    entry = {}
                    reconciled = False
                    message = f'Disk saved, but draft reconciliation failed: {exc}. Do not retry the write.'
                from ...file_save_events import publish_file_saved
                from ...worker_services.event_bus import build_event, publish
                publish_file_saved(project_root=root, path=path, source='draft_hunk_save', sha256=result.content_sha256)
                await publish(build_event('GitSnapshotRequested', project_root=root,
                    project_generation=generation, source='draft_hunk_save', payload={}))
                if reconciled and get_project_root().resolve() == root and current_project_generation(root) == generation:
                    from ...monaco_editor.editor_ws import editor_runtime_emit_room_event
                    await editor_runtime_emit_room_event('editor:mirror', {
                        'path': absolute, 'content': latest_content, 'expected_content_sha256': latest_sha,
                        'base_sha256': result.content_sha256, 'content_sha256': latest_sha,
                        'unsaved': entry.get('unsaved'), 'document_revision': entry.get('document_revision'),
                        'source_client': 'draft_hunk_save'})
                return {'diskSaved': True, 'draftReconciled': reconciled, 'message': message,
                    'path': rel, 'directorySynced': result.directory_synced}
            finally:
                active_paths.discard(absolute)
                from .runtime_notifications import notify_draft_state_changed
                notify_draft_state_changed(str(root))

    async def snapshot(self, project: Path) -> ReviewProjection:
        root = project.resolve()
        if get_project_root().resolve() != root:
            raise RuntimeError('Draft review project is no longer current')
        generation = current_project_generation(root)
        if generation is None:
            # Cold restoration can precede History/search/project-switch, which
            # otherwise initialize the shared fact generation. Only the active
            # backend project may establish it; never revive a stale caller.
            generation = next_project_generation(root)
        identity = (str(root), generation)
        async with self._lock:
            if get_project_root().resolve() != root or current_project_generation(root) != generation:
                raise RuntimeError('Draft review project changed')
            previous = self._rows if self._identity == identity else {}
            rows = await asyncio.to_thread(_build, root, previous)
            if get_project_root().resolve() != root or current_project_generation(root) != generation:
                raise RuntimeError('Draft review project changed')
            for _, row in rows.values():
                if row.get('projectionId') != self._id or row.get('projectGeneration') != generation:
                    row['identity'] = f'{self._id}:{generation}:{row["identity"]}'
                    row['projectionId'] = self._id
                    row['projectGeneration'] = generation
            if self._identity != identity or rows != self._rows:
                self._revision += 1
            self._identity = identity
            self._rows = rows
            return {'projectRoot': str(root), 'projectGeneration': generation,
                'projectionId': self._id, 'revision': self._revision, 'complete': True,
                'entries': [row for _, row in rows.values()]}

    async def revert(self, project: Path, rel: str, identity: str, index: int | list[int]) -> Row:
        root = project.resolve()
        async with self._lock:
            generation = current_project_generation(root)
            if get_project_root().resolve() != root or self._identity != (str(root), generation):
                raise ValueError('Draft review project changed')
            retained = self._rows.get(rel)
            if retained is None or retained[1].get('identity') != identity:
                raise ValueError('Draft changed; refresh the review before reverting')
            key, row = retained
            if row.get('error') is not None:
                raise ValueError('Draft hunk preview is unavailable')
            path = root / rel
            if not path.resolve().is_relative_to(root):
                raise ValueError('Draft hunk path is outside the project')

            def prepare() -> tuple[str, str]:
                if _stamp(path) != key[1]:
                    raise ValueError('Disk changed; refresh the review before reverting')
                _, drafts = ProjectSidecar.load_or_create(str(root)).read_review_snapshot()
                draft = next((item for item in drafts if item.get('file_path') == str(path)), None)
                if draft is None or draft.get('document_revision', 0) != key[2]:
                    raise ValueError('Draft changed; refresh the review before reverting')
                content = draft.get('content')
                if not isinstance(content, str) or hashlib.sha256(content.encode('utf-8')).hexdigest() != key[0]:
                    raise ValueError('Draft changed; refresh the review before reverting')
                disk = read_disk(path)
                disk_sha = hashlib.sha256(disk.encode('utf-8')).hexdigest()
                if disk_sha != row.get('diskSha256'):
                    raise ValueError('Disk changed; refresh the review before reverting')
                return revert_hunks(disk, content, [index] if isinstance(index, int) else index), disk_sha

            content, disk_sha = await asyncio.to_thread(prepare)
            if (get_project_root().resolve() != root or current_project_generation(root) != generation
                    or not path.resolve().is_relative_to(root)):
                raise ValueError('Draft review project changed')
            # No suspension between final source validation and the strict
            # sidecar compare/commit. This never calls a disk-edit/save service.
            disk = read_disk(path)
            if _stamp(path) != key[1] or hashlib.sha256(disk.encode('utf-8')).hexdigest() != disk_sha:
                raise ValueError('Disk changed; refresh the review before reverting')
            entry = get_history_store().replace_review_draft(str(root), str(path), key[2], key[0], content, disk_sha)
        from ...monaco_editor.editor_ws import editor_runtime_emit_room_event
        payload: Row = {'path': str(path), 'content': content,
            'expected_content_sha256': key[0], 'base_sha256': entry.get('base_sha256'),
            'content_sha256': entry.get('content_sha256'), 'unsaved': entry.get('unsaved'),
            'source_client': 'draft_hunk_revert', 'document_revision': entry.get('document_revision')}
        await editor_runtime_emit_room_event('editor:mirror', payload)
        from .runtime_notifications import notify_draft_state_changed
        notify_draft_state_changed(str(root))
        return {'reverted': True, 'path': rel, 'document_revision': entry.get('document_revision')}


owner = ReviewProjectionOwner()
