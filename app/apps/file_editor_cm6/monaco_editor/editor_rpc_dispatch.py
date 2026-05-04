# pyright: strict
from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import cast

from .editor_host_actions_backend import handle_editor_host_action
from .editor_rpc_contract import (
    EDITOR_RPC_METHOD_BLUR,
    EDITOR_RPC_METHOD_FOCUS,
    EDITOR_RPC_METHOD_HOST_SAVE,
    EDITOR_RPC_METHOD_MENTION_REQUEST,
    EDITOR_RPC_METHOD_MIRROR_PUBLISH,
    EDITOR_RPC_METHOD_OPEN,
    EDITOR_RPC_METHOD_SAVE,
    JSONRPC_METHOD_NOT_FOUND,
    EditorRpcDispatchError,
)
from .editor_mention_backend import handle_editor_mention_request
from .editor_open_backend import EditorOpenPayload, emit_editor_open_from_backend
from .editor_save_backend import handle_editor_mirror, handle_editor_save_request
from .editor_backend_services.contracts import RuntimeMeta

ActiveProjectFn = Callable[[], str | None]
NormalizeAbsPathFn = Callable[[str], str | None]
IsUnderProjectFn = Callable[[str, str], bool]
RuntimeMetaFn = Callable[[], RuntimeMeta]
ReadFilePayloadFn = Callable[[str, str], EditorOpenPayload]
UpdateSessionStateFn = Callable[[dict[str, object]], None]
SetLastFileFn = Callable[[str, str], None]
EmitToRoomFn = Callable[[str, dict[str, object]], Awaitable[None]]
BroadcastActiveFileUpdateFn = Callable[[str, str], Awaitable[None]]
EmitHostActiveFileChangedFn = Callable[..., Awaitable[None]]
NotifyDraftStateChangedFn = Callable[[str], None]
RecordSaveShaFn = Callable[[str, str], None]


async def dispatch_editor_rpc_request(
    method: str,
    params: dict[str, object],
    *,
    active_project: ActiveProjectFn,
    normalize_abs_path: NormalizeAbsPathFn,
    is_under_project: IsUnderProjectFn,
    runtime_meta: RuntimeMetaFn,
    read_file_payload: ReadFilePayloadFn,
    update_session_state: UpdateSessionStateFn,
    set_last_file: SetLastFileFn,
    emit_to_room: EmitToRoomFn,
    broadcast_active_file_update: BroadcastActiveFileUpdateFn,
    emit_host_active_file_changed: EmitHostActiveFileChangedFn,
    notify_draft_state_changed: NotifyDraftStateChangedFn,
    record_save_sha: RecordSaveShaFn,
) -> object:
    if method in (EDITOR_RPC_METHOD_HOST_SAVE, EDITOR_RPC_METHOD_FOCUS, EDITOR_RPC_METHOD_BLUR):
        return await handle_editor_host_action(method, params)

    if method == EDITOR_RPC_METHOD_OPEN:
        request_id = str(params.get("request_id") or f"rpc_open_{int(time.time() * 1000)}")
        payload = await emit_editor_open_from_backend(
            params,
            source_client="rpc_editor",
            request_id=request_id,
            active_project=active_project,
            normalize_abs_path=normalize_abs_path,
            is_under_project=is_under_project,
            read_file_payload=read_file_payload,
            update_session_state=update_session_state,
            set_last_file=set_last_file,
            emit_editor_open=lambda open_payload: emit_to_room("editor:open", cast(dict[str, object], open_payload)),
            broadcast_active_file_update=broadcast_active_file_update,
            emit_host_active_file_changed=lambda project, abs_path, source=None, request_id=None: emit_host_active_file_changed(
                project,
                abs_path,
                source=source,
                request_id=request_id,
            ),
        )
        return payload

    if method == EDITOR_RPC_METHOD_MIRROR_PUBLISH:
        await handle_editor_mirror(
            "rpc_editor",
            params,
            active_project=active_project,
            normalize_abs_path=normalize_abs_path,
            is_under_project=is_under_project,
            runtime_meta=runtime_meta,
            emit_to_room=emit_to_room,
            notify_draft_state_changed=notify_draft_state_changed,
        )
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_SAVE:
        request_id = str(params.get("request_id") or params.get("requestId") or f"rpc_save_{int(time.time() * 1000)}")

        async def _request_direct_snapshot(_: str) -> dict[str, object]:
            snapshot: dict[str, object] = {}
            if "path" in params:
                snapshot["path"] = params["path"]
            if "content" in params:
                snapshot["content"] = params["content"]
            if "base_sha256" in params:
                snapshot["base_sha256"] = params["base_sha256"]
            if "error" in params:
                snapshot["error"] = params["error"]
            return snapshot

        return await handle_editor_save_request(
            "rpc_editor",
            {
                "path": params.get("path"),
                "target_path": params.get("target_path"),
                "request_id": request_id,
                "requestId": request_id,
                "base_sha256": params.get("base_sha256"),
                "force": params.get("force"),
                "client_id": params.get("client_id", "rpc_editor"),
                "op_id": params.get("op_id", f"editor_save_{int(time.time())}"),
            },
            active_project=active_project,
            normalize_abs_path=normalize_abs_path,
            is_under_project=is_under_project,
            request_snapshot=_request_direct_snapshot,
            emit_to_room=emit_to_room,
            notify_draft_state_changed=notify_draft_state_changed,
            record_save_sha=record_save_sha,
        )

    if method == EDITOR_RPC_METHOD_MENTION_REQUEST:
        return await handle_editor_mention_request(params)

    raise EditorRpcDispatchError(
        JSONRPC_METHOD_NOT_FOUND,
        "method_not_found",
        data={"method": method},
    )
