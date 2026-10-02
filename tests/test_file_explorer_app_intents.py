from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.apps.file_explorer import file_explorer
from app.apps.code_te2.ui_ipc import sidebar_ws
from app.apps.code_te2.host import sidebar_app_backend, file_ops_backend
from app.apps.code_te2.explorer.services import file_ops
from app.libs import pipe_runtime


def test_file_explorer_backend_forwards_only_fixed_target_over_pipe(monkeypatch):
    call = AsyncMock(return_value={'ok': True})
    monkeypatch.setattr(pipe_runtime, 'call_async', call)
    context = {'clientId': 'client', 'hostId': 'slot', 'presentationId': 'presentation'}
    result = asyncio.run(file_explorer.dispatch_embedded_intent({
        'intent': 'document.open', 'context': context, 'payload': {'path': '/file'},
        'targetApp': 'forged', 'source': 'forged'}))
    assert result == {'ok': True, 'data': {'ok': True}}
    assert call.call_args.args == ('app.intent.dispatch', {
        'targetApp': 'code_te2', 'intent': 'document.open', 'context': context,
        'payload': {'path': '/file'}})
    assert call.call_args.kwargs['target_name'] == 'framework.rust'
    assert len(call.call_args.kwargs['op_id']) == 32


@pytest.mark.parametrize('payload', [{}, {'intent': 'eval'},
    {'intent': 'document.open', 'context': {}, 'payload': {}}])
def test_malformed_intents_never_reach_pipe(monkeypatch, payload):
    call = AsyncMock()
    monkeypatch.setattr(pipe_runtime, 'call_async', call)
    with pytest.raises(HTTPException): asyncio.run(file_explorer.dispatch_embedded_intent(payload))
    call.assert_not_awaited()


@pytest.fixture
def routing(monkeypatch, tmp_path):
    root = tmp_path / 'project'; root.mkdir()
    client = 'client_111111111111'
    monkeypatch.setattr(file_ops, 'get_project_root', lambda: root)
    monkeypatch.setattr(sidebar_ws, 'resolve_sidebar_request_client', lambda *args, **kwargs: (
        client, {**args[0], 'target': {'clientId': client, 'hostId': 'slot', 'presentationId': 'current'}}))
    open_editor = AsyncMock(return_value={'ok': True})
    open_app = AsyncMock(return_value={'ok': True, 'route': 'cm6'})
    monkeypatch.setattr(file_ops_backend, 'handle_host_open_request', open_editor)
    monkeypatch.setattr(sidebar_app_backend, 'open_sidebar_app', open_app)
    return root, open_editor, open_app


@pytest.mark.parametrize('kind', ['inside', 'outside', 'symlink', 'prefix-sibling'])
def test_resolved_document_routing_retains_project_and_exact_client(routing, kind):
    root, editor, app = routing
    outside = root.parent / 'outside.py'; outside.write_text('text')
    if kind == 'inside':
        target = root / 'inside.py'; target.write_text('text')
    elif kind == 'symlink':
        target = root / 'link.py'; target.symlink_to(outside)
    elif kind == 'prefix-sibling':
        sibling = root.parent / 'project-other'; sibling.mkdir()
        target = sibling / 'other.py'; target.write_text('text')
    else:
        target = outside
    asyncio.run(sidebar_ws.handle_sidebar_document_open({'path': str(target), 'request_id': 'op'},
        requester_app_id='file_explorer', require_presentation=True))
    if kind == 'inside':
        app.assert_not_awaited()
        assert editor.call_args.kwargs['source_name'] == 'client_111111111111'
    else:
        editor.assert_not_awaited()
        assert app.call_args.kwargs['app_id'] == 'file_editor'
        assert app.call_args.kwargs['params'] == {'file': str(target.resolve())}
        assert app.call_args.kwargs['client_id'] == 'client_111111111111'


def test_cm6_state_publication_carries_file_slot_and_never_activates(monkeypatch, tmp_path):
    from app.apps.file_editor import main
    monkeypatch.setattr(main, 'APP_ID', 'file_editor')
    from app.libs import sidebar_rpc
    monkeypatch.setattr(main, '_expand_and_validate_path', lambda path: (path, None))
    target = tmp_path / 'file.py'; target.write_text('text')
    call = AsyncMock(return_value={'ok': True})
    monkeypatch.setattr(sidebar_rpc, 'call_sidebar_rpc', call)
    asyncio.run(main.publish_sidebar_file_state({'host_id': 'slot', 'token_id': 'token', 'file': str(target)}))
    assert call.call_args.args[:2] == ('file_editor', 'sidebar.window.state.update')
    params = call.call_args.args[2]
    assert params['query_state'] == {'file': str(target)}
    assert params['host_id'] == 'slot'
    assert params['activate'] is False
