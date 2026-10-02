from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest

from app.apps.code_te2.host import project_intent_backend as intents, project_backend
from app.apps.code_te2.explorer.services import file_ops
from app.apps.code_te2.worker_services import event_bus
from app.apps.code_te2.ui_ipc import sidebar_ws, ui_ipc_ws
from app.apps.code_te2.main_page.backend import project_service


@pytest.fixture
def setup(monkeypatch, tmp_path):
    root = tmp_path / 'current'; root.mkdir()
    target = tmp_path / 'chosen'; target.mkdir()
    state = {'root': root, 'generation': 1, 'known': False, 'live': True}
    intents._tickets.clear()
    monkeypatch.setattr(file_ops, 'get_project_root', lambda: state['root'])
    monkeypatch.setattr(event_bus, 'current_project_generation', lambda *args: state['generation'])
    def live(client):
        if not state['live']: raise ValueError('disconnected')
    monkeypatch.setattr(sidebar_ws, 'require_live_sidebar_host', live)
    monkeypatch.setattr(ui_ipc_ws, 'list_ui_ipc_browser_clients', lambda: ('client',) if state['live'] else ())
    monkeypatch.setattr(sidebar_ws, 'resolve_sidebar_request_client', lambda *a, **kw: ('client', {}))
    monkeypatch.setattr(project_backend, '_project_service_deps', lambda: SimpleNamespace(
        history=SimpleNamespace(get_active_project=lambda: str(state['root']))))
    monkeypatch.setattr(project_service, 'lookup_project', lambda *a: {'known': state['known']})
    async def switch(*args, **kwargs):
        kwargs['before_switch']()
        return {'ok': True, 'path': args[1]}
    opened = AsyncMock(side_effect=switch)
    monkeypatch.setattr(project_service, 'open_project', opened)
    return root, target, state, opened


def call(params, **kwargs):
    return asyncio.run(intents.handle_project_directory_intent(params, client_id='client', **kwargs))


@pytest.mark.parametrize('known', [False, True])
def test_prepare_has_no_effect_and_commit_reuses_shared_open(setup, known):
    _, target, state, opened = setup
    state['known'] = known
    prepared = call({'action': 'prepare', 'directory': str(target)})
    assert prepared['known'] is known
    assert prepared['requiresConfirmation'] is True
    opened.assert_not_awaited()
    assert call({'action': 'commit', 'ticket': prepared['ticket']})['ok'] is True
    assert opened.call_args.kwargs['require_known_sidecar'] is known
    assert target.is_dir()  # Adoption does not create a nested project directory.
    with pytest.raises(ValueError): call({'action': 'commit', 'ticket': prepared['ticket']})


@pytest.mark.parametrize('change', ['generation', 'root', 'live', 'directory'])
def test_stale_confirmations_cannot_switch(setup, change):
    root, target, state, opened = setup
    ticket = call({'action': 'prepare', 'directory': str(target)})['ticket']
    if change == 'generation': state['generation'] = 2
    elif change == 'root': state['root'] = target
    elif change == 'live': state['live'] = False
    else:
        target.rename(root.parent / 'old')
        target.mkdir()
    with pytest.raises(ValueError): call({'action': 'commit', 'ticket': ticket})
    opened.assert_not_awaited()


def test_cancel_and_same_project_are_noops(setup):
    root, target, _, opened = setup
    ticket = call({'action': 'prepare', 'directory': str(target)})['ticket']
    assert call({'action': 'cancel', 'ticket': ticket})['cancelled'] is True
    prepared = call({'action': 'prepare', 'directory': str(root)})
    assert prepared['requiresConfirmation'] is False
    assert call({'action': 'commit', 'ticket': prepared['ticket']})['unchanged'] is True
    opened.assert_not_awaited()


def test_ticket_is_bound_to_client_and_presentation(setup):
    _, target, _, opened = setup
    context = {'clientId': 'client', 'hostId': 'slot', 'presentationId': 'original'}
    ticket = call({'action': 'prepare', 'directory': str(target)}, source_context=context, requester_app_id='file_explorer')['ticket']
    with pytest.raises(ValueError): call({'action': 'commit', 'ticket': ticket})
    with pytest.raises(ValueError): call({'action': 'commit', 'ticket': ticket},
        source_context={**context, 'presentationId': 'new'}, requester_app_id='file_explorer')
    opened.assert_not_awaited()


def test_expiry_and_new_prepare_invalidate_old_ticket(setup, monkeypatch):
    _, target, _, opened = setup
    first = call({'action': 'prepare', 'directory': str(target)})['ticket']
    second = call({'action': 'prepare', 'directory': str(target)})['ticket']
    with pytest.raises(ValueError): call({'action': 'commit', 'ticket': first})
    monkeypatch.setattr(intents.time, 'monotonic', lambda: 10**12)
    with pytest.raises(ValueError): call({'action': 'commit', 'ticket': second})
    opened.assert_not_awaited()


def test_shared_switch_revalidates_after_async_cleanup_before_root_mutation(monkeypatch):
    from app.apps.code_te2.explorer.services import project_switch
    from app.apps.code_te2 import watchexec_shell_manager
    monkeypatch.setattr(project_switch, '_get_explorer_project_hooks', lambda: (None, None))
    stopped = AsyncMock()
    monkeypatch.setattr(watchexec_shell_manager, 'stop_watchexec_shell', stopped)
    root_changes = []
    monkeypatch.setattr(project_switch, 'set_project_root', lambda path: root_changes.append(path))
    def guard():
        if stopped.await_count:
            raise ValueError('stale after cleanup')
    with pytest.raises(ValueError, match='stale after cleanup'):
        asyncio.run(project_switch.switch_project_connection(None, '/chosen',
            initialize_watcher=False, switch_adapter_workspace=True, before_switch=guard))
    assert root_changes == []


def test_pipe_project_dispatch_reuses_service_with_framework_source_and_exact_context(setup, monkeypatch):
    from app.apps.code_te2.app_intent_pipe import dispatch_app_intent
    from app.libs.pipe_protocol import PipeEnvelope
    handler = AsyncMock(return_value={'ok': True, 'ticket': 'bound'})
    monkeypatch.setattr(intents, 'handle_project_directory_intent', handler)
    context = {'clientId': 'client', 'hostId': 'slot', 'presentationId': 'current'}
    payload = {'action': 'prepare', 'directory': '/chosen'}
    request = PipeEnvelope(kind='request', method='app.intent.deliver', params={
        'intent': 'project.openDirectory', 'context': context, 'payload': payload,
        'source': {'appId': 'file_explorer', 'shellId': 'owned-worker'},
    })
    assert asyncio.run(dispatch_app_intent(request))['ticket'] == 'bound'
    assert handler.call_args.args == (payload,)
    assert handler.call_args.kwargs == {'client_id': 'client', 'source_context': context,
                                       'requester_app_id': 'file_explorer'}
