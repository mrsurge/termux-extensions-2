import asyncio
import hashlib
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import pytest

from app.apps.code_te2.explorer.services import review_projection as projection
from app.apps.code_te2.explorer.services.review_hunks import build_hunks
from app.apps.code_te2.project_sidecar import ProjectSidecar
from app.apps.code_te2.worker_services.text_edit_service import DiskEditResult


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def test_selective_save_rpc_uses_real_dispatcher():
    from types import SimpleNamespace
    from app.apps.code_te2.explorer_runtime import ExplorerDispatcher
    from app.apps.code_te2.explorer.transport.rpc_contract import dispatcher_message_type_from_rpc_method
    dispatcher = ExplorerDispatcher(SimpleNamespace(client_instance_id='client'))
    method = dispatcher_message_type_from_rpc_method('explorer.review.saveHunks')
    assert dispatcher._resolve_handler(method).__name__ == 'handle_review_saveHunks'


@pytest.mark.parametrize('mode', ['partial', 'all', 'newer', 'timeout', 'postcommit', 'persist_failure', 'cancel', 'stale'])
def test_pipe_save_reconciles_full_draft_without_replaying(tmp_path, mode):
    async def run():
        path = tmp_path / 'a.py'
        disk = ''.join(f'α🍊 line {i}\r\n' for i in range(60)) + 'no final newline'
        draft = disk.replace('α🍊 line 2\r\nα🍊 line 3\r\n', '').replace('α🍊 line 40\r\n', 'new 🍋\r\n')
        path.write_bytes(disk.encode())
        with patch.object(ProjectSidecar, 'get_sidecar_path', return_value=tmp_path / 'sidecar.json'):
            sidecar = ProjectSidecar(str(tmp_path))
        sidecar.upsert_cached_document(str(path), draft, sha(disk), '', '', '', 0, 0)
        sidecar.save()
        calls = []
        issued, proceed = asyncio.Event(), asyncio.Event()

        class History:
            def replace_review_draft(self, project, path, *args, **kwargs):
                if mode == 'persist_failure':
                    raise OSError('disk full for sidecar')
                return sidecar.replace_review_draft(path, *args, **kwargs)

        async def pipe(root, rel, expected, edits):
            calls.append((root, rel, expected, edits))
            assert expected == sha(disk) and path.read_bytes() == disk.encode()
            raw = disk.encode()
            for edit in sorted(edits, key=lambda e: e.start_byte, reverse=True):
                assert raw[edit.start_byte:edit.end_byte].decode() == edit.expected_text
                raw = raw[:edit.start_byte] + edit.replacement.encode() + raw[edit.end_byte:]
            if mode == 'timeout':
                raise RuntimeError('pipe outcome unknown')
            if mode == 'cancel':
                issued.set()
                await proceed.wait()
            path.write_bytes(raw)
            if mode == 'newer':
                sidecar.upsert_cached_document(str(path), draft + '\r\nnew typing', sha(disk), '', '', '', 0, 0)
                sidecar.save()
            if mode == 'postcommit':
                sidecar.clear_cached_document(str(path))
                sidecar.save()
            return DiskEditResult(rel, raw.decode(), expected, sha(raw.decode()), True, len(edits), True)

        with ExitStack() as stack:
            for obj, name, value in [
                (projection, 'get_project_root', lambda: tmp_path),
                (projection, 'current_project_generation', lambda root: 1),
                (ProjectSidecar, 'load_or_create', lambda root: sidecar),
                (projection, 'get_history_store', lambda: History()),
                (projection, 'apply_disk_edits', pipe),
            ]:
                stack.enter_context(patch.object(obj, name, value))
            stack.enter_context(patch('app.apps.code_te2.monaco_editor.editor_ws.editor_runtime_emit_room_event', AsyncMock()))
            stack.enter_context(patch('app.apps.code_te2.explorer.services.runtime_notifications.notify_draft_state_changed'))
            stack.enter_context(patch('app.apps.code_te2.file_save_events.publish_file_saved'))
            stack.enter_context(patch('app.apps.code_te2.worker_services.event_bus.publish', AsyncMock()))
            owner = projection.ReviewProjectionOwner()
            row = (await owner.snapshot(tmp_path))['entries'][0]
            indexes = [0, 1] if mode == 'all' else [0]
            if mode == 'stale':
                path.write_bytes(b'external change')
                with pytest.raises(ValueError, match='Disk changed'):
                    await owner.save_hunks(tmp_path, 'a.py', row['identity'], indexes)
                assert not calls
                return
            if mode == 'timeout':
                with pytest.raises(RuntimeError, match='outcome unknown'):
                    await owner.save_hunks(tmp_path, 'a.py', row['identity'], indexes)
            elif mode == 'cancel':
                caller = asyncio.create_task(owner.save_hunks(tmp_path, 'a.py', row['identity'], indexes))
                await issued.wait()
                caller.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await caller
                proceed.set()
                result = await asyncio.gather(*owner._operations)
                assert result[0]['draftReconciled'] is True
            else:
                result = await owner.save_hunks(tmp_path, 'a.py', row['identity'], indexes)
                assert result['diskSaved'] is True
                assert result['draftReconciled'] is (mode not in ('postcommit', 'persist_failure'))
                if mode in ('postcommit', 'persist_failure'):
                    assert 'Do not retry' in result['message']
            assert len(calls) == 1
            with pytest.raises(ValueError, match='already attempted'):
                await owner.save_hunks(tmp_path, 'a.py', row['identity'], indexes)
            if mode not in ('postcommit', 'persist_failure', 'timeout'):
                expected_disk = draft if mode == 'all' else disk.replace('α🍊 line 2\r\nα🍊 line 3\r\n', '')
                assert path.read_bytes() == expected_disk.encode()
                _, drafts = sidecar.read_review_snapshot()
                if mode == 'all':
                    assert drafts == []
                else:
                    assert drafts[0]['content'] == draft + ('\r\nnew typing' if mode == 'newer' else '')
                    assert drafts[0]['base_sha256'] == sha(expected_disk)
                    remaining = build_hunks(expected_disk, drafts[0]['content'])
                    assert remaining[0].display['oldStart'] > 30
    asyncio.run(run())
