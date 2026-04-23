# pyright: strict
from __future__ import annotations

import time
from pathlib import Path
from typing import TypedDict, cast

from ..explorer_helper import get_project_root
from ..stores import get_history_store
from ..monaco_editor.editor_ws import (
    editor_runtime_active_project,
    editor_runtime_broadcast_active_file_update,
    editor_runtime_emit_room_event,
    editor_runtime_emit_host_active_file_changed,
    editor_runtime_is_under_project,
    editor_runtime_normalize_abs_path,
    editor_runtime_notify_draft_state_changed,
    editor_runtime_read_file_payload,
    editor_runtime_record_save_sha,
    editor_runtime_request_save_snapshot,
    editor_runtime_set_last_file,
    editor_runtime_update_session_state,
)
from ..monaco_editor.editor_open_backend import emit_editor_open_from_backend
from ..monaco_editor.editor_save_backend import handle_editor_save_request
from ..monaco_editor.editor_backend_services.contracts import JsonMap


class HostOpenResult(TypedDict):
    ok: bool
    request_id: str
    path: str
    rel: str

async def handle_host_open_request(
    data: dict[str, object],
    *,
    source_name: str,
    request_prefix: str,
) -> HostOpenResult:
    history = get_history_store()
    project = history.get_active_project() or str(get_project_root())
    if not project:
        raise ValueError('no active project')
    project_path = Path(project).expanduser()
    raw_path = str(data.get('path') or data.get('abs') or data.get('file') or data.get('rel') or '').strip()
    if not raw_path:
        raise ValueError('missing path')

    if raw_path.startswith('/'):
        target = Path(raw_path).expanduser()
    else:
        target = (project_path / raw_path.lstrip('/')).expanduser()

    rel: str | None = None
    for proj_candidate, tgt_candidate in [
        (project_path, target),
        (project_path.resolve(strict=False), target.resolve(strict=False)),
    ]:
        try:
            rel = str(tgt_candidate.relative_to(proj_candidate))
            target = tgt_candidate
            break
        except ValueError:
            continue

    if rel is None:
        raise PermissionError('path is outside active project root')
    if not target.exists():
        raise FileNotFoundError('target does not exist')
    if target.is_dir():
        raise IsADirectoryError('target is a directory')

    payload: dict[str, object] = {
        'rel': rel,
        'path': str(target),
        'column': data.get('column'),
        'source': data.get('source') or source_name,
        'conversation_id': data.get('conversation_id'),
    }
    raw_line = data.get('line')
    if isinstance(raw_line, int):
        line = raw_line
    elif isinstance(raw_line, str) and raw_line.isdigit():
        line = int(raw_line)
    else:
        line = None
    if isinstance(line, int) and line >= 1:
        payload['line'] = line

    request_id = str(data.get('request_id') or f'{request_prefix}_{int(time.time() * 1000)}')
    await emit_editor_open_from_backend(
        payload,
        source_client=source_name,
        request_id=request_id,
        active_project=editor_runtime_active_project,
        normalize_abs_path=editor_runtime_normalize_abs_path,
        is_under_project=editor_runtime_is_under_project,
        read_file_payload=editor_runtime_read_file_payload,
        update_session_state=editor_runtime_update_session_state,
        set_last_file=editor_runtime_set_last_file,
        emit_editor_open=lambda open_payload: editor_runtime_emit_room_event("editor:open", cast(dict[str, object], open_payload)),
        broadcast_active_file_update=editor_runtime_broadcast_active_file_update,
        emit_host_active_file_changed=editor_runtime_emit_host_active_file_changed,
    )
    return {
        'ok': True,
        'request_id': request_id,
        'path': str(target),
        'rel': rel,
    }


async def handle_host_save_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    payload: JsonMap = dict(data)
    request_id = str(payload.get('request_id') or payload.get('requestId') or f'host_save_{int(time.time() * 1000)}')
    payload['request_id'] = request_id
    payload['requestId'] = request_id
    if 'client_id' not in payload:
        payload['client_id'] = source_name
    if 'op_id' not in payload:
        payload['op_id'] = f'{source_name}_{int(time.time())}'

    return await handle_editor_save_request(
        source_name,
        payload,
        active_project=editor_runtime_active_project,
        normalize_abs_path=editor_runtime_normalize_abs_path,
        is_under_project=editor_runtime_is_under_project,
        request_snapshot=lambda rid: editor_runtime_request_save_snapshot(rid),
        emit_to_room=editor_runtime_emit_room_event,
        notify_draft_state_changed=editor_runtime_notify_draft_state_changed,
        record_save_sha=editor_runtime_record_save_sha,
    )
