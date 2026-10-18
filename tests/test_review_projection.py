from pathlib import Path
import asyncio
import json
from functools import wraps
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.apps.code_te2.explorer.services import review_projection as projection
from app.apps.code_te2.explorer.handlers import review as handlers
from app.apps.code_te2.worker_services import event_bus


@pytest.fixture(autouse=True)
def active_project(tmp_path, monkeypatch):
    monkeypatch.setattr(projection, 'get_project_root', lambda: tmp_path)


def async_test(fn):
    @wraps(fn)
    def run(*args, **kwargs):
        return asyncio.run(fn(*args, **kwargs))
    return run


class Sidecar:
    def __init__(self, root: Path):
        self.revision = 1
        self.drafts = [dict(file_path=str(root / name), content=f'new {name}\n', updated_at=1)
                       for name in ('one.txt', 'two.txt')]

    def read_review_snapshot(self):
        return self.revision, list(self.drafts)


@async_test
async def test_item_eviction_retains_other_draft_hunks_and_reuses_diff(tmp_path):
    sidecar = Sidecar(tmp_path)
    owner = projection.ReviewProjectionOwner()
    with patch.object(projection.ProjectSidecar, 'load_or_create', return_value=sidecar), \
         patch.object(projection, 'current_project_generation', return_value=1), \
         patch.object(projection, 'build_hunks', wraps=projection.build_hunks) as compute:
        first = await owner.snapshot(tmp_path)
        assert len(first['entries']) == 2
        retained = first['entries'][1]
        assert retained['hunks']
        sidecar.drafts = sidecar.drafts[1:]
        sidecar.revision += 1
        second = await owner.snapshot(tmp_path)
        assert second['entries'] == [retained]
        assert second['entries'][0] is retained
        assert second['revision'] > first['revision']
        assert compute.call_count == 2
        assert (await owner.snapshot(tmp_path))['revision'] == second['revision']


@async_test
async def test_failed_or_racing_snapshot_cannot_commit_empty_membership(tmp_path):
    sidecar = Sidecar(tmp_path)
    owner = projection.ReviewProjectionOwner()
    with patch.object(projection.ProjectSidecar, 'load_or_create', return_value=sidecar), \
         patch.object(projection, 'current_project_generation', return_value=1):
        first = await owner.snapshot(tmp_path)
        sidecar.drafts[0] = {**sidecar.drafts[0], 'content': 'concurrent edit'}
        compute = projection.build_hunks
        def racing(*args):
            result = compute(*args)
            sidecar.revision += 1
            return result
        with patch.object(projection, 'build_hunks', side_effect=racing):
            with pytest.raises(RuntimeError, match='membership changed'):
                await owner.snapshot(tmp_path)
        assert owner._revision == first['revision']
        assert len(owner._rows) == 2
        with patch.object(sidecar, 'read_review_snapshot', side_effect=ValueError('unreadable')):
            with pytest.raises(ValueError):
                await owner.snapshot(tmp_path)
        assert len(owner._rows) == 2


@async_test
async def test_project_switch_during_build_rejects_snapshot(tmp_path):
    sidecar = Sidecar(tmp_path)
    owner = projection.ReviewProjectionOwner()
    with patch.object(projection.ProjectSidecar, 'load_or_create', return_value=sidecar), \
         patch.object(projection, 'current_project_generation', side_effect=[1, 1, 2]):
        with pytest.raises(RuntimeError, match='project changed'):
            await owner.snapshot(tmp_path)
    assert owner._rows == {}


@async_test
async def test_cold_restored_active_project_initializes_real_fact_generation(tmp_path, monkeypatch):
    monkeypatch.setattr(event_bus, '_project_generation', 0)
    monkeypatch.setattr(event_bus, '_current_project_root', None)
    sidecar = Sidecar(tmp_path)
    owner = projection.ReviewProjectionOwner()
    assert event_bus.current_project_generation(tmp_path) is None
    with patch.object(projection.ProjectSidecar, 'load_or_create', return_value=sidecar):
        first = await owner.snapshot(tmp_path)
        second = await owner.snapshot(tmp_path)
    assert first['projectGeneration'] == 1
    assert len(first['entries']) == 2
    assert first['revision'] == second['revision']
    assert event_bus.current_project_generation(tmp_path) == 1


@async_test
async def test_uninitialized_generation_cannot_reactivate_stale_project(tmp_path):
    owner = projection.ReviewProjectionOwner()
    with patch.object(projection, 'current_project_generation', return_value=None), \
         patch.object(projection, 'next_project_generation') as initialize, \
         patch.object(projection, '_build') as build:
        with pytest.raises(RuntimeError, match='no longer current'):
            await owner.snapshot(tmp_path / 'old-project')
    initialize.assert_not_called()
    build.assert_not_called()


@async_test
async def test_project_switch_while_waiting_for_snapshot_lock_is_rejected(tmp_path):
    owner = projection.ReviewProjectionOwner()
    active = tmp_path
    with patch.object(projection, 'get_project_root', side_effect=lambda: active), \
         patch.object(projection, 'current_project_generation', return_value=1), \
         patch.object(projection, '_build') as build:
        async with owner._lock:
            pending = asyncio.create_task(owner.snapshot(tmp_path))
            await asyncio.sleep(0)
            active = tmp_path / 'new-project'
        with pytest.raises(RuntimeError, match='project changed'):
            await pending
    build.assert_not_called()


def test_strict_sidecar_read_does_not_turn_corruption_into_eviction(tmp_path):
    path = tmp_path / 'sidecar.json'
    with patch.object(projection.ProjectSidecar, 'get_sidecar_path', return_value=path):
        sidecar = projection.ProjectSidecar(str(tmp_path))
    data = sidecar._default_data()
    data['session_cache'] = {'draft': {'file_path': str(tmp_path / 'a'), 'content': 'full model', 'unsaved': True}}
    path.write_text(json.dumps(data))
    revision, drafts = sidecar.read_review_snapshot()
    assert revision == 0 and drafts[0]['content'] == 'full model'
    path.write_text('{broken')
    with pytest.raises(ValueError):
        sidecar.read_review_snapshot()


@async_test
async def test_discard_acknowledgement_is_not_an_entries_notification(tmp_path):
    from app.apps.code_te2.explorer.context import ExplorerSearchReviewHandlerContext
    emit = AsyncMock()
    context = ExplorerSearchReviewHandlerContext(tmp_path, 'client', emit, AsyncMock(), AsyncMock(), AsyncMock(), Mock(), Mock())
    with patch.object(handlers.review_service, 'discard_reviews', AsyncMock(return_value={'discarded_count': 1})):
        await handlers.handle_review_discard(context, {'files': ['one.txt']}, 'request1')
    assert emit.await_args.args == ('explorer.review.discard.completed', {'discarded_count': 1}, 'request1')
    context.broadcast_review_state.assert_awaited_once()
