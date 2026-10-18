import asyncio
import hashlib
from unittest.mock import AsyncMock, patch

import pytest

from app.apps.code_te2.explorer.services.review_hunks import build_hunks, revert_hunk, revert_hunks
from app.apps.code_te2.explorer.services import review_projection as projection
from app.apps.code_te2.project_sidecar import ProjectSidecar
from app.apps.code_te2.explorer.contracts.search_review import parse_review_revert_hunk_params, ExplorerSearchReviewContractError


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


@pytest.mark.parametrize('disk,draft', [
    ('a\nb\n', 'a\ninserted\nb\n'), ('a\nb\n', 'b\n'),
    ('a\nb', 'a\nc'), ('a\n', 'a'), ('a', 'a\n'),
    ('α\r\nβ\r\n', 'α\r\n🍊\r\n'), ('', 'new file'), ('removed\n', ''),
])
def test_exact_hunk_reversion_preserves_endings_and_unicode(disk, draft):
    assert revert_hunk(disk, draft, 0) == disk


def test_context_and_independent_distant_hunks():
    disk = ''.join(f'line {i}\n' for i in range(30))
    draft = disk.replace('line 3\n', 'first edit\n').replace('line 24\n', 'second edit\n')
    hunks = build_hunks(disk, draft)
    assert len(hunks) == 2
    assert hunks[0].display['oldStart'] == 1
    assert hunks[0].display['newStart'] == 1
    lines = hunks[0].display['lines']
    assert sum(line['type'] == 'context' for line in lines) == 6
    assert revert_hunk(disk, draft, 0) == disk.replace('line 24\n', 'second edit\n')
    assert revert_hunk(disk, draft, 1) == disk.replace('line 3\n', 'first edit\n')


def test_multiple_selected_hunks_use_one_original_coordinate_space():
    disk = ''.join(f'line {i}\n' for i in range(60))
    draft = disk.replace('line 3\n', 'much longer first edit\n').replace('line 24\n', 'second edit\n').replace('line 50\n', 'third\n')
    assert revert_hunks(disk, draft, [2, 0]) == disk.replace('line 24\n', 'second edit\n')
    assert revert_hunks(disk, draft, [0, 1, 2]) == disk
    for indexes in ([], [0, 0], [3], [True]):
        with pytest.raises(ValueError):
            revert_hunks(disk, draft, indexes)


def test_selected_hunk_contract_rejects_empty_duplicate_and_invalid_indexes():
    assert parse_review_revert_hunk_params({'rel': 'a', 'identity': 'receipt', 'hunkIndices': [2, 0]})['hunkIndices'] == [2, 0]
    for indexes in ([], [0, 0], [True], [-1], '0'):
        with pytest.raises(ExplorerSearchReviewContractError):
            parse_review_revert_hunk_params({'rel': 'a', 'identity': 'receipt', 'hunkIndices': indexes})


@pytest.mark.parametrize('raw', [
    {'rel': '../escape', 'identity': 'x', 'hunkIndex': 0},
    {'rel': '/escape', 'identity': 'x', 'hunkIndex': 0},
    {'rel': 'a', 'identity': 'x', 'hunkIndex': True},
    {'rel': 'a', 'identity': '', 'hunkIndex': 0},
])
def test_bad_hunk_targets_rejected(raw):
    with pytest.raises(ExplorerSearchReviewContractError):
        parse_review_revert_hunk_params(raw)


def test_hunk_rpc_resolves_to_the_real_dispatcher():
    from app.apps.code_te2.explorer_runtime import ExplorerDispatcher
    from app.apps.code_te2.explorer.transport.rpc_contract import dispatcher_message_type_from_rpc_method
    from types import SimpleNamespace
    dispatcher = ExplorerDispatcher(SimpleNamespace(client_instance_id='client'))
    method = dispatcher_message_type_from_rpc_method('explorer.review.revertHunk')
    assert dispatcher._resolve_handler(method).__name__ == 'handle_review_revertHunk'


def test_guarded_sidecar_commit_rejects_newer_draft_and_does_not_write_source(tmp_path):
    path = tmp_path / 'file.txt'
    disk, draft = 'disk\n', 'draft\n'
    path.write_text(disk)
    with patch.object(ProjectSidecar, 'get_sidecar_path', return_value=tmp_path / 'sidecar.json'):
        sidecar = ProjectSidecar(str(tmp_path))
    entry = sidecar.upsert_cached_document(str(path), draft, digest(disk), '', '', '', 0, 0)
    sidecar.save()
    changed = sidecar.replace_review_draft(str(path), entry['document_revision'], digest(draft), disk, digest(disk))
    assert changed['unsaved'] is False
    assert path.read_text() == disk
    with pytest.raises(ValueError, match='Draft changed'):
        sidecar.replace_review_draft(str(path), entry['document_revision'], digest(draft), 'stale', digest(disk))


def test_failed_draft_persistence_is_not_reported_as_success(tmp_path):
    path = tmp_path / 'file.txt'
    with patch.object(ProjectSidecar, 'get_sidecar_path', return_value=tmp_path / 'sidecar.json'):
        sidecar = ProjectSidecar(str(tmp_path))
    entry = sidecar.upsert_cached_document(str(path), 'draft', digest('disk'), '', '', '', 0, 0)
    sidecar.save()
    with patch.object(sidecar, 'save', side_effect=OSError('disk full')):
        with pytest.raises(OSError, match='disk full'):
            sidecar.replace_review_draft(str(path), entry['document_revision'], digest('draft'), 'new', digest('disk'))
    assert sidecar.read_review_snapshot()[1][0]['content'] == 'draft'


def test_oversized_preview_preserves_other_drafts(tmp_path):
    from app.apps.code_te2.explorer.services.review_hunks import MAX_REVIEW_CHARS
    async def run():
        class Sidecar:
            def read_review_snapshot(self):
                return 1, [{'file_path': str(tmp_path / 'large'), 'content': 'a' * (MAX_REVIEW_CHARS + 1)},
                           {'file_path': str(tmp_path / 'small'), 'content': 'small draft'}]
        with patch.object(projection, 'get_project_root', return_value=tmp_path), \
             patch.object(projection, 'current_project_generation', return_value=1), \
             patch.object(ProjectSidecar, 'load_or_create', return_value=Sidecar()):
            rows = (await projection.ReviewProjectionOwner().snapshot(tmp_path))['entries']
            assert len(rows) == 2 and rows[0]['error'] and rows[1]['hunks']
    asyncio.run(run())


@pytest.mark.parametrize('indexes', [0, [0]])
def test_owner_reverts_only_selected_hunk_and_rejects_stale_disk(tmp_path, indexes):
    async def run():
        path = tmp_path / 'file.txt'
        disk = ''.join(f'{i}\n' for i in range(30))
        draft = disk.replace('2\n', 'first\n', 1).replace('25\n', 'second\n')
        path.write_text(disk)
        with patch.object(ProjectSidecar, 'get_sidecar_path', return_value=tmp_path / 'sidecar.json'):
            sidecar = ProjectSidecar(str(tmp_path))
        sidecar.upsert_cached_document(str(path), draft, digest(disk), '', '', '', 0, 0)
        sidecar.save()
        owner = projection.ReviewProjectionOwner()
        class History:
            def replace_review_draft(self, project, path, *args):
                return sidecar.replace_review_draft(path, *args)
        with patch.object(projection, 'get_project_root', return_value=tmp_path), \
             patch.object(projection, 'current_project_generation', return_value=1), \
             patch.object(ProjectSidecar, 'load_or_create', return_value=sidecar), \
             patch.object(projection, 'get_history_store', return_value=History()), \
             patch('app.apps.code_te2.monaco_editor.editor_ws.editor_runtime_emit_room_event', AsyncMock()) as emit, \
             patch('app.apps.code_te2.explorer.services.runtime_notifications.notify_draft_state_changed'):
            row = (await owner.snapshot(tmp_path))['entries'][0]
            await owner.revert(tmp_path, 'file.txt', row['identity'], indexes)
            assert path.read_text() == disk
            persisted = sidecar.read_review_snapshot()[1][0]
            assert persisted['content'] == disk.replace('25\n', 'second\n')
            assert emit.await_args.args[1]['expected_content_sha256'] == digest(draft)
            with pytest.raises(ValueError, match='Draft changed'):
                await owner.revert(tmp_path, 'file.txt', row['identity'], 0)
            latest = (await owner.snapshot(tmp_path))['entries'][0]
            path.write_text('external edit\n')
            with pytest.raises(ValueError, match='Disk changed'):
                await owner.revert(tmp_path, 'file.txt', latest['identity'], 0)
            assert sidecar.read_review_snapshot()[1][0]['content'] == persisted['content']
    asyncio.run(run())
