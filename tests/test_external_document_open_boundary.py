from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest

from app.apps.code_te2.host import sidebar_app_backend
from app.apps.code_te2.monaco_editor.editor_backend_services.open_service import emit_editor_open_from_backend


@pytest.mark.parametrize('kind', ['external', 'symlink', 'prefix-sibling'])
def test_shared_boundary_routes_without_project_mutations(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: str) -> None:
    root = tmp_path / 'project'; root.mkdir()
    external = tmp_path / 'outside.txt'; external.write_text('hello')
    path = external
    if kind == 'symlink':
        path = root / 'escape.txt'; path.symlink_to(external)
    elif kind == 'prefix-sibling':
        parent = tmp_path / 'project-other'; parent.mkdir()
        path = parent / 'file.txt'; path.write_text('hello')
    launch = AsyncMock(return_value={'ok': True})
    monkeypatch.setattr(sidebar_app_backend, 'open_sidebar_app', launch)
    read, record, emit, changed = Mock(), Mock(), AsyncMock(), AsyncMock()
    result = asyncio.run(emit_editor_open_from_backend(
        {'path': str(path)}, source_client='client_111111111111', request_id='op',
        active_project=lambda: str(root), normalize_abs_path=lambda path: path,
        is_under_project=lambda project, path: path.startswith(project + '/'),
        read_file_payload=read, record_sidecar_open_file=record,
        emit_editor_open=emit, emit_open_state_changed=changed,
    ))
    assert result['state'] == 'external_sidebar'
    assert launch.call_args.kwargs['params'] == {'file': str(path.resolve())}
    assert launch.call_args.kwargs['client_id'] == 'client_111111111111'
    read.assert_not_called(); record.assert_not_called()
    emit.assert_not_awaited(); changed.assert_not_awaited()


def test_external_missing_file_never_launches(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.apps.code_te2.host.external_document_backend import open_external_document
    launch = AsyncMock()
    monkeypatch.setattr(sidebar_app_backend, 'open_sidebar_app', launch)
    with pytest.raises(FileNotFoundError):
        asyncio.run(open_external_document(path=str(tmp_path / 'missing'), project=str(tmp_path),
            client_id='client', request_id='op'))
    launch.assert_not_awaited()


def test_extension_external_completion_does_not_wait_for_monaco(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.apps.code_te2 import extension_navigation_backend as navigation
    from app.apps.code_te2.host import file_ops_backend
    opened = AsyncMock(return_value={'ok': True, 'surface': 'sidebar'})
    notified = AsyncMock()
    monkeypatch.setattr(file_ops_backend, 'handle_host_open_request', opened)
    monkeypatch.setattr(navigation, '_notify_wba', notified)
    asyncio.run(asyncio.wait_for(navigation._run_extension_open({
        'requestId': 'external-request', 'path': '/external.txt',
        'clientInstanceId': 'client_111111111111',
    }), timeout=1))
    assert notified.call_args.args[0]['ok'] is True
    assert notified.call_args.args[0]['clientInstanceId'] == 'client_111111111111'
    assert 'external-request' not in navigation._pending_open_completions
