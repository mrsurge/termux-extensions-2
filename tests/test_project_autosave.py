"""Project save modes and stale-consent fences, with disposable disk state."""
import asyncio
import hashlib
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.apps.code_te2 import project_autosave as owner
from app.apps.code_te2 import project_autosave_runtime as runtime
from app.apps.code_te2.project_sidecar import ProjectSidecar
from app.apps.code_te2.preferences_store import PreferencesStore
from app.apps.code_te2.monaco_editor.editor_backend_services import save_service


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


@pytest.mark.parametrize('lane', ['manual', 'autosave', 'save_all'])
def test_own_write_watcher_does_not_reopen_model(environment, lane):
    """Use the actual watcher before/after commit, not a mocked SHA predicate."""
    from app.apps.code_te2.monaco_editor import editor_ws as ws
    from app.apps.code_te2.restore_activity import active_paths

    async def run():
        projects, _, _, _ = environment
        project = projects[0]
        if lane == 'autosave':
            ProjectSidecar.load_or_create(str(project)).set_autosave_mode(True, 0)
        path, sidecar = draft(project)
        loop = asyncio.get_running_loop()
        original_write = save_service._typed_write_full
        original_record = ws.editor_runtime_record_save_sha
        notifications = []

        def watcher_during_write(*args, **kwargs):
            # Deliver once while disk is old and once after atomic replacement,
            # before the executor future has resumed its owning coroutine.
            notifications.append(asyncio.run_coroutine_threadsafe(
                ws.handle_external_file_change(str(path)), loop).result(timeout=3))
            result = original_write(*args, **kwargs)
            notifications.append(asyncio.run_coroutine_threadsafe(
                ws.handle_external_file_change(str(path)), loop).result(timeout=3))
            return result

        def record(absolute, digest):
            assert absolute in active_paths  # Publish SHA before releasing fence.
            original_record(absolute, digest)

        history = SimpleNamespace(get_cached_document=lambda *_: None,
                                  advance_document_revision=lambda *_: 1)
        emit = AsyncMock()
        with patch.object(ws, '_LAST_SAVE_SHA', {}), \
             patch.object(ws, '_active_project', return_value=str(project)), \
             patch.object(ws, 'list_client_foregrounds', return_value=[{'path': str(path), 'clientInstanceId': 'client'}]), \
             patch.object(ws, '_history_store', history), \
             patch.object(ws, '_read_file_payload', return_value={}), \
             patch.object(ws, 'editor_runtime_emit_room_event', emit), \
             patch.object(ws, 'editor_runtime_record_save_sha', side_effect=record), \
             patch.object(save_service, '_typed_write_full', side_effect=watcher_during_write):
            if lane == 'manual':
                await save_service.write_editor_file(project, path.name, 'draft\r\n🍋',
                    base_sha256=sha('disk\r\n🍊'), mode=0o755, record_save_sha=ws.editor_runtime_record_save_sha)
            elif lane == 'autosave':
                await runtime._write(str(project), str(path), runtime.Pending(1, 1, 0))
            else:
                token = await preview(project)
                result = await owner.transition({'project': str(project), 'value': True,
                                                'token': token, 'choice': 'save'})
                assert result['ok'], result
            assert notifications == [False, False]
            assert str(path) not in active_paths
            for _ in range(3):
                assert not await ws.handle_external_file_change(str(path))
            assert all(call.args[0] != 'editor:open' for call in emit.call_args_list)

            # A real subsequent external edit still refreshes exactly its client.
            path.write_text('external edit', encoding='utf-8')
            assert await ws.handle_external_file_change(str(path))
            opens = [call for call in emit.call_args_list if call.args[0] == 'editor:open']
            assert len(opens) == 1
            assert opens[0].kwargs['client_instance_id'] == 'client'
            assert str(path) not in ws._LAST_SAVE_SHA
    asyncio.run(run())


def test_failed_own_write_releases_watcher_fence(environment):
    from app.apps.code_te2.restore_activity import active_paths

    async def run():
        project = environment[0][0]
        path, _ = draft(project)
        from unittest.mock import Mock
        record = Mock()
        with patch.object(save_service, '_typed_write_full', side_effect=OSError('failed')):
            with pytest.raises(OSError, match='failed'):
                await save_service.write_editor_file(project, path.name, 'new',
                    base_sha256=sha('disk\r\n🍊'), mode=0o755, record_save_sha=record)
        assert str(path) not in active_paths
        record.assert_not_called()
    asyncio.run(run())


@pytest.fixture
def environment(tmp_path):
    projects = [tmp_path / 'a', tmp_path / 'b']
    for project in projects:
        project.mkdir()
    active = [str(projects[0])]
    history = SimpleNamespace(get_active_project=lambda: active[0])
    clients = {}
    frozen = set()
    with ExitStack() as stack:
        stack.enter_context(patch.object(ProjectSidecar, 'get_sidecar_path', side_effect=lambda project: tmp_path / (sha(project) + '.json')))
        stack.enter_context(patch.object(ProjectSidecar, '_instances', {}))
        stack.enter_context(patch.object(owner, '_busy', set()))
        stack.enter_context(patch.object(owner, '_writes', {}))
        stack.enter_context(patch.object(owner, '_held', {}))
        stack.enter_context(patch.object(owner, '_receipts', {}))
        stack.enter_context(patch.object(owner, '_switching', False))
        stack.enter_context(patch.object(runtime, '_pending', {}))
        stack.enter_context(patch.object(runtime, '_tasks', {}))
        stack.enter_context(patch.object(runtime, '_blocked', {}))
        stack.enter_context(patch.object(runtime, '_commits', {}))
        stack.enter_context(patch.object(runtime, 'DELAY', 0))
        stack.enter_context(patch.object(runtime, 'current_project_generation', return_value=1))
        stack.enter_context(patch.object(owner, 'current_project_generation', return_value=1))
        stack.enter_context(patch('app.apps.code_te2.stores.get_history_store', return_value=history))
        for project in projects:
            ProjectSidecar.load_or_create(str(project)).save()

        async def snapshot(_request, *, client_instance_id, extra):
            freeze, release = extra.get('autosaveFreeze'), extra.get('autosaveRelease')
            if freeze:
                frozen.add(client_instance_id)
            if release:
                frozen.discard(client_instance_id)
            return {**clients[client_instance_id], 'autosaveFreeze': freeze}

        async def mirror(_event, payload):
            for snapshot in clients.values():
                if snapshot['path'] == payload['path'] and sha(snapshot['content']) == payload['expected_content_sha256']:
                    snapshot.update(content=payload['content'], base_sha256=payload['base_sha256'])

        stack.enter_context(patch('app.apps.code_te2.monaco_editor.editor_client_registry.connected_editor_client_instance_ids', side_effect=lambda: list(clients)))
        stack.enter_context(patch('app.apps.code_te2.monaco_editor.editor_ws.editor_runtime_request_save_snapshot', side_effect=snapshot))
        stack.enter_context(patch('app.apps.code_te2.monaco_editor.editor_ws.editor_runtime_emit_room_event', side_effect=mirror))
        stack.enter_context(patch('app.apps.code_te2.monaco_editor.editor_ws.editor_runtime_notify_draft_state_changed'))
        stack.enter_context(patch('app.apps.code_te2.file_save_events.publish_file_saved'))
        stack.enter_context(patch('app.apps.code_te2.explorer.services.file_ops.mark_git_cache_dirty'))
        stack.enter_context(patch('app.apps.code_te2.explorer.services.file_ops.mark_draft_cache_dirty'))
        yield projects, active, clients, frozen


def draft(project, name='one.txt', disk='disk\r\n🍊', text='draft\r\n🍋'):
    path = project / name
    path.write_bytes(disk.encode())
    path.chmod(0o755)
    sidecar = ProjectSidecar.load_or_create(str(project))
    sidecar.upsert_cached_document(str(path), text, sha(disk), '', '', '', 0, 0)
    sidecar.save()
    return path, sidecar


async def preview(project):
    response = await owner.transition({'project': str(project), 'value': True, 'stage': 'preview'})
    return response['preview']['token']


@pytest.mark.parametrize('choice', ['save', 'discard'])
def test_resolve_all_then_enable_only_this_project(environment, choice):
    async def run():
        projects, _, clients, frozen = environment
        first, sidecar = draft(projects[0])
        second, _ = draft(projects[0], 'two.txt')
        other, other_sidecar = draft(projects[1])
        clients['client'] = {'path': str(first), 'content': 'draft\r\n🍋', 'base_sha256': sha('disk\r\n🍊')}
        token = await preview(projects[0])
        result = await owner.transition({'project': str(projects[0]), 'value': True, 'token': token, 'choice': choice})
        assert result['ok'], result
        assert sidecar.get_autosave_state() == (True, 1)
        assert sidecar.read_review_snapshot()[1] == []
        expected = 'draft\r\n🍋' if choice == 'save' else 'disk\r\n🍊'
        assert first.read_bytes().decode() == second.read_bytes().decode() == expected
        assert first.stat().st_mode & 0o777 == 0o755
        assert clients['client']['content'] == expected
        assert other.read_bytes().decode() == 'disk\r\n🍊'
        assert len(other_sidecar.read_review_snapshot()[1]) == 1
        assert not frozen
        with pytest.raises(ValueError):
            await owner.transition({'project': str(projects[0]), 'value': True, 'token': token, 'choice': choice})
    asyncio.run(run())


@pytest.mark.parametrize('change', ['draft', 'client', 'project', 'disk', 'membership'])
def test_stale_consent_or_conflict_never_enables(environment, change):
    async def run():
        projects, active, clients, frozen = environment
        path, sidecar = draft(projects[0])
        clients['client'] = {'path': str(path), 'content': 'draft\r\n🍋', 'base_sha256': sha('disk\r\n🍊')}
        token = await preview(projects[0])
        if change == 'draft':
            sidecar.upsert_cached_document(str(path), 'newer draft', sha('disk\r\n🍊'), '', '', '', 0, 0)
            sidecar.save()
        elif change == 'client':
            clients['client']['content'] = 'new typing'
        elif change == 'project':
            active[0] = str(projects[1])
        elif change == 'disk':
            path.write_text('external change')
        else:
            clients['second'] = dict(clients['client'])
        try:
            result = await owner.transition({'project': str(projects[0]), 'value': True, 'token': token, 'choice': 'save'})
            assert result['ok'] is False
        except ValueError:
            pass
        assert sidecar.get_autosave_state()[0] is False
        assert len(sidecar.read_review_snapshot()[1]) == 1
        assert not frozen
    asyncio.run(run())


def test_cancel_preview_does_not_write_and_legacy_global_true_is_ignored(environment, tmp_path):
    async def run():
        projects, active, _, _ = environment
        path, sidecar = draft(projects[0])
        before = path.read_bytes()
        await preview(projects[0])  # Closing the dialog submits no mutation.
        assert path.read_bytes() == before
        assert sidecar.get_autosave_state() == (False, 0)
        preferences = PreferencesStore(tmp_path / 'preferences.json')
        raw = preferences._read_from_disk()
        raw['editor']['autoSave'] = True
        preferences._path.write_text(__import__('json').dumps(raw))
        assert preferences.get_preferences(active[0])['editor']['autoSave'] is False
        ProjectSidecar.load_or_create(str(projects[1])).set_autosave_mode(True, 0)
        for project, expected in [(projects[0], False), (projects[1], True), (projects[0], False)]:
            active[0] = str(project)
            assert preferences.get_preferences()['editor']['autoSave'] is expected
        # A new instance/cold load retains the explicit project choice.
        assert ProjectSidecar(str(projects[1])).get_autosave_state() == (True, 1)
    asyncio.run(run())


def test_inflight_writes_switches_and_transitions_exclude_each_other(environment):
    projects, _, _, _ = environment
    project = str(projects[0])
    with owner.project_write(project):
        with pytest.raises(ValueError):
            owner.require_project_idle(project)
        with pytest.raises(ValueError):
            with owner.project_switch(project, str(projects[1])):
                pass
    with owner.project_switch(project, str(projects[1])):
        with pytest.raises(ValueError):
            with owner.project_write(project):
                pass
    owner._busy.add(project)
    with pytest.raises(ValueError):
        draft(projects[0])
    owner._busy.clear()


def test_autosave_switch_flushes_pending_text_and_holds_until_handoff(environment):
    async def run():
        projects, _, clients, frozen = environment
        project = str(projects[0])
        path = projects[0] / 'live.txt'
        path.write_text('disk')
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.set_autosave_mode(True, 0)
        clients['client'] = {'path': str(path), 'content': 'pending', 'base_sha256': sha('disk')}
        token = await owner.flush_before_project_switch(project)
        assert token and frozen == {'client'}
        assert path.read_text() == 'pending'
        assert sidecar.read_review_snapshot()[1] == []
        with owner.project_switch(project, str(projects[1]), token):
            assert frozen == {'client'}
        await owner.release_project_switch(token)
        assert not frozen and not owner._busy and not owner._held
    asyncio.run(run())


def test_partial_write_reports_completed_files_without_replay(environment):
    async def run():
        projects, _, _, _ = environment
        first, sidecar = draft(projects[0])
        second, _ = draft(projects[0], 'two.txt')
        token = await preview(projects[0])
        original = save_service._typed_write_full
        calls = []
        def write(root, rel, content, **options):
            calls.append(rel)
            if len(calls) == 2:
                raise OSError('test disk failure')
            return original(root, rel, content, **options)
        with patch.object(save_service, '_typed_write_full', side_effect=write):
            result = await owner.transition({'project': str(projects[0]), 'value': True, 'token': token, 'choice': 'save'})
        assert result['ok'] is False and result['resolved'] == [str(first)]
        assert first.read_bytes().decode() == 'draft\r\n🍋'
        assert second.read_bytes().decode() == 'disk\r\n🍊'
        assert len(sidecar.read_review_snapshot()[1]) == 1
        assert not sidecar.get_autosave_state()[0]
        assert calls == ['one.txt', 'two.txt']
    asyncio.run(run())


def test_confirmation_includes_newer_unpersisted_live_buffer(environment):
    async def run():
        projects, _, clients, _ = environment
        path, sidecar = draft(projects[0])
        clients['client'] = {'path': str(path), 'content': 'new typing not yet persisted', 'base_sha256': sha('disk\r\n🍊')}
        token = await preview(projects[0])
        result = await owner.transition({'project': str(projects[0]), 'value': True, 'token': token, 'choice': 'save'})
        assert result['ok'], result
        assert path.read_text() == 'new typing not yet persisted'
        assert not sidecar.read_review_snapshot()[1]
    asyncio.run(run())


def test_old_client_without_freeze_support_prevents_mode_change(environment):
    async def run():
        projects, _, clients, frozen = environment
        path, sidecar = draft(projects[0])
        clients['client'] = {'path': str(path), 'content': 'draft\r\n🍋', 'base_sha256': sha('disk\r\n🍊')}
        token = await preview(projects[0])
        with patch('app.apps.code_te2.monaco_editor.editor_ws.editor_runtime_request_save_snapshot', new=AsyncMock(return_value=clients['client'])):
            result = await owner.transition({'project': str(projects[0]), 'value': True, 'token': token, 'choice': 'save'})
        assert result['ok'] is False
        assert 'Editor client did not acknowledge' in result['error']
        assert result['message'].endswith('No files were changed.')
        assert not sidecar.get_autosave_state()[0]
        assert path.read_bytes().decode() == 'disk\r\n🍊'
        assert not frozen
    asyncio.run(run())


def test_mode_disable_requires_current_project_and_revision(environment):
    async def run():
        projects, _, _, _ = environment
        project = str(projects[0])
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.set_autosave_mode(True, 0)
        with pytest.raises(ValueError):
            await owner.transition({'project': project, 'value': False, 'expected_revision': 0})
        assert sidecar.get_autosave_state() == (True, 1)
        assert (await owner.transition({'project': project, 'value': False, 'expected_revision': 1}))['ok']
        assert sidecar.get_autosave_state() == (False, 2)
    asyncio.run(run())


def test_mixed_persisted_mode_recovers_as_draft_without_losing_content(environment):
    projects, _, _, _ = environment
    _, sidecar = draft(projects[0])
    sidecar._data['autosave'] = {'enabled': True, 'revision': 5}
    sidecar.save()
    ProjectSidecar._instances.clear()  # A new worker adopts the recovered state.
    restored = ProjectSidecar.load_or_create(str(projects[0]))
    assert restored.get_autosave_state() == (False, 6)
    assert restored.get_autosave_state() == (False, 6)
    assert len(restored.read_review_snapshot()[1]) == 1


def test_save_snapshot_cannot_cross_project_or_mode_change(environment):
    async def run():
        projects, active, _, _ = environment
        sidecar = ProjectSidecar.load_or_create(active[0])
        sidecar.set_autosave_mode(True, 0)
        path = projects[0] / 'file'
        path.write_text('disk')
        async def snapshot(_request):
            active[0] = str(projects[1])
            return {'path': str(path), 'content': 'pending', 'base_sha256': sha('disk')}
        with patch.object(save_service, '_typed_write_full') as writer:
            result = await save_service.handle_editor_save_request(
                'client', {'project': str(projects[0]), 'is_autosave': True, 'autosave_revision': 1, 'expected_path': str(path)},
                active_project=lambda: active[0], normalize_abs_path=lambda p: p,
                is_under_project=lambda root, p: True, request_snapshot=snapshot,
                emit_to_room=AsyncMock(), notify_draft_state_changed=lambda p: None,
                record_save_sha=lambda p, sha: None,
            )
        assert result['ok'] is False and 'Project changed' in result['error']
        writer.assert_not_called()
        assert not owner._writes
    asyncio.run(run())


def test_backend_autosave_follows_each_file_without_active_tab_snapshots(environment):
    async def run():
        projects, _, _, _ = environment
        project = str(projects[0])
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.set_autosave_mode(True, 0)
        first, _ = draft(projects[0])
        second, _ = draft(projects[0], 'two.txt')
        # Ordinary projection reads must not turn a running project's mode off.
        assert ProjectSidecar(project).get_autosave_state() == (True, 1)
        runtime.schedule(project, str(first), 1)
        runtime.schedule(project, str(second), 1)
        await asyncio.gather(*runtime._tasks.values())
        assert first.read_bytes().decode() == second.read_bytes().decode() == 'draft\r\n🍋'
        assert sidecar.read_review_snapshot()[1] == []
        assert sidecar.get_autosave_state() == (True, 1)
    asyncio.run(run())


def test_backend_autosave_rebases_typing_during_write_and_delayed_mirror(environment):
    async def run():
        projects, _, _, _ = environment
        project = str(projects[0])
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.set_autosave_mode(True, 0)
        path, _ = draft(projects[0])
        original = save_service._typed_write_full
        calls = []
        def write(root, rel, content, **options):
            calls.append(content)
            result = original(root, rel, content, **options)
            if len(calls) == 1:
                # Model mirror arrives while the worker is awaiting its write.
                sidecar.upsert_cached_document(str(path), 'newer typing', sha('disk\r\n🍊'), '', '', '', 0, 0)
                sidecar.save()
            return result
        with patch.object(save_service, '_typed_write_full', side_effect=write):
            runtime.schedule(project, str(path), 1)
            await asyncio.gather(*runtime._tasks.values())
        assert calls == ['draft\r\n🍋', 'newer typing']
        assert path.read_text() == 'newer typing'
        assert sidecar.read_review_snapshot()[1] == []
        assert runtime.rebase_mirror(project, str(path), sha('disk\r\n🍊'), sha('newer typing'), 1) == sha('newer typing')
        assert runtime.rebase_mirror(project, str(path), sha('disk\r\n🍊'), sha('external'), 1) == sha('disk\r\n🍊')
        assert runtime.rebase_mirror(project, str(path), sha('disk\r\n🍊'), sha('newer typing'), 2) == sha('disk\r\n🍊')
    asyncio.run(run())


def test_commit_lineage_retains_only_eight_recent_ancestors(environment):
    project = str(environment[0][0])
    path = str(environment[0][0] / 'lineage.txt')
    for index in range(12):
        runtime.record_commit(project, path, f'hash-{index}', f'hash-{index + 1}', 1)

    for index in range(12):
        base = f'hash-{index}'
        expected = 'hash-12' if index >= 4 else base
        assert runtime.rebase_mirror(project, path, base, 'hash-12', 1) == expected

    # An unrelated base starts a fresh lineage rather than adopting old commits.
    runtime.record_commit(project, path, 'external', 'saved', 1)
    assert runtime.rebase_mirror(project, path, 'hash-11', 'saved', 1) == 'hash-11'
    assert runtime.rebase_mirror(project, path, 'external', 'saved', 1) == 'saved'


def test_backend_autosave_failure_keeps_draft_and_never_replays(environment):
    async def run():
        projects, _, _, _ = environment
        project = str(projects[0])
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.set_autosave_mode(True, 0)
        path, _ = draft(projects[0])
        with patch.object(save_service, '_typed_write_full', side_effect=OSError('uncertain write outcome')) as writer, patch.object(runtime, '_failed', new=AsyncMock()) as failed:
            runtime.schedule(project, str(path), 1)
            await asyncio.gather(*runtime._tasks.values())
            runtime.schedule(project, str(path), 1)
            assert not runtime._tasks
        writer.assert_called_once()
        failed.assert_awaited_once()
        assert len(sidecar.read_review_snapshot()[1]) == 1
        assert not owner._writes
    asyncio.run(run())


@pytest.mark.parametrize('stale', ['mode', 'project'])
def test_pending_backend_autosave_rejects_stale_context(environment, stale):
    async def run():
        projects, active, _, _ = environment
        project = str(projects[0])
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.set_autosave_mode(True, 0)
        path, _ = draft(projects[0])
        runtime.schedule(project, str(path), 1)
        if stale == 'mode':
            sidecar.set_autosave_mode(False, 1)
        else:
            active[0] = str(projects[1])
        with patch.object(save_service, '_typed_write_full') as writer:
            await asyncio.gather(*runtime._tasks.values())
        writer.assert_not_called()
        assert len(sidecar.read_review_snapshot()[1]) == 1
    asyncio.run(run())


def test_actual_mirror_handler_persists_then_schedules_own_file(environment):
    async def run():
        projects, active, _, _ = environment
        project = str(projects[0])
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.set_autosave_mode(True, 0)
        path = projects[0] / 'wire.txt'
        path.write_text('disk')
        def upsert(**data):
            data.pop('project_path')
            entry = sidecar.upsert_cached_document(**data)
            sidecar.save()
            return entry
        history = SimpleNamespace(upsert_cached_document=upsert)
        with patch.object(save_service, '_history_store', history):
            await save_service.handle_editor_mirror('client', {'path': str(path), 'content': 'wire change', 'base_sha256': sha('disk')},
                active_project=lambda: active[0], normalize_abs_path=lambda path: path,
                is_under_project=lambda root, path: True,
                runtime_meta=lambda: dict(run_id='', shell_id='', shell_run_id='', launcher_pid=0, worker_pid=0),
                emit_to_room=AsyncMock(), notify_draft_state_changed=lambda project: None)
        assert sidecar.list_project_drafts()[0]['content'] == 'wire change'
        await asyncio.gather(*runtime._tasks.values())
        assert path.read_text() == 'wire change'
        assert not sidecar.list_project_drafts()
    asyncio.run(run())


def test_failure_recovery_publishes_draft_mode_and_preserves_pending_content(environment):
    async def run():
        projects, _, _, _ = environment
        project = str(projects[0])
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.set_autosave_mode(True, 0)
        path, _ = draft(projects[0])
        preferences = {'editor': {'autoSave': False, 'autosaveProject': project, 'autosaveRevision': 2}}
        with patch('app.apps.code_te2.stores.get_preferences_store', return_value=SimpleNamespace(get_preferences=lambda project: preferences)), patch('app.apps.code_te2.monaco_editor.editor_backend._get_view_state_dict', return_value=preferences['editor']), patch('app.apps.code_te2.ui_ipc.notifications.emit_ui_ipc_rpc_notification', new=AsyncMock()) as notification:
            await runtime.stop(project, 1, 'disk conflict')
        assert sidecar.get_autosave_state() == (False, 2)
        assert sidecar.list_project_drafts()[0]['content'] == 'draft\r\n🍋'
        assert path.read_bytes().decode() == 'disk\r\n🍊'
        assert notification.await_count == 1
        assert notification.call_args.args[1]['view_state']['autoSave'] is False
    asyncio.run(run())


def test_snapshot_timeout_names_client_and_does_not_claim_files_were_changed(environment):
    async def run():
        projects, _, clients, _ = environment
        path, _ = draft(projects[0])
        clients['slow-client'] = {'path': str(path), 'content': 'draft\r\n🍋', 'base_sha256': sha('disk\r\n🍊')}
        token = await preview(projects[0])
        with patch('app.apps.code_te2.monaco_editor.editor_ws.editor_runtime_request_save_snapshot', new=AsyncMock(side_effect=TimeoutError())):
            result = await owner.transition({'project': str(projects[0]), 'value': True, 'token': token, 'choice': 'save'})
        assert result['ok'] is False
        assert 'Editor slow-client did not answer' in result['error']
        assert '3 seconds' in result['error']
        assert result['message'].endswith('No files were changed.')
    asyncio.run(run())
