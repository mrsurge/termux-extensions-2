# pyright: strict
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
import logging as _logging
from typing import cast

from .editor_rpc_contract import (
    EDITOR_RPC_METHOD_MIRROR_PUBLISH,
    EDITOR_RPC_METHOD_OPEN,
    EDITOR_RPC_METHOD_SAVE,
    EDITOR_RPC_METHOD_WORKBENCH_COMPLETIONS,
    EDITOR_RPC_METHOD_WORKBENCH_DID_CHANGE,
    EDITOR_RPC_METHOD_WORKBENCH_FOLDING_RANGES,
    EDITOR_RPC_METHOD_WORKBENCH_GRAMMARS_LIST,
    EDITOR_RPC_METHOD_WORKBENCH_GRAMMARS_LOAD,
    EDITOR_RPC_METHOD_WORKBENCH_HOVER,
    EDITOR_RPC_METHOD_WORKBENCH_INLAY_HINTS,
    EDITOR_RPC_METHOD_WORKBENCH_INLAY_HINTS_RELEASE,
    EDITOR_RPC_METHOD_WORKBENCH_INLAY_HINTS_RESOLVE,
    EDITOR_RPC_METHOD_WORKBENCH_INLINE_COMPLETIONS,
    EDITOR_RPC_METHOD_WORKBENCH_INLINE_COMPLETIONS_DID_SHOW,
    EDITOR_RPC_METHOD_WORKBENCH_INLINE_COMPLETIONS_FREE,
    EDITOR_RPC_METHOD_WORKBENCH_OPEN_FILE,
    EDITOR_RPC_METHOD_WORKBENCH_PROVIDERS,
    EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS,
    EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS_LEGEND,
    EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS_RANGE,
    EDITOR_RPC_METHOD_WORKBENCH_SYMBOLS,
    JSONRPC_APPLICATION_ERROR,
    JSONRPC_METHOD_NOT_FOUND,
    EditorRpcDispatchError,
)
from .editor_open_backend import EditorOpenPayload, emit_editor_open_from_backend
from .editor_save_backend import handle_editor_mirror, handle_editor_save_request
from .editor_backend_services.contracts import RuntimeMeta
from .editor_workbench_backend import (
    handle_workbench_completions,
    handle_workbench_did_change,
    handle_workbench_folding_ranges,
    handle_workbench_grammars_list,
    handle_workbench_grammars_load,
    handle_workbench_hover,
    handle_workbench_inlay_hints,
    handle_workbench_inlay_hints_release,
    handle_workbench_inlay_hints_resolve,
    handle_workbench_inline_completions,
    handle_workbench_inline_completions_did_show,
    handle_workbench_inline_completions_free,
    handle_workbench_open_file,
    handle_workbench_providers,
    handle_workbench_semantic_tokens,
    handle_workbench_semantic_tokens_legend,
    handle_workbench_semantic_tokens_range,
    handle_workbench_symbols,
)

ActiveProjectFn = Callable[[], str | None]
NormalizeAbsPathFn = Callable[[str], str | None]
IsUnderProjectFn = Callable[[str, str], bool]
WorkbenchLockFn = Callable[[str], asyncio.Lock]
CoerceGenerationFn = Callable[[object], int | None]
MarkOpenBaselineFn = Callable[[str, int | None], None]
HasOpenBaselineFn = Callable[[str, int | None], bool]
RuntimeMetaFn = Callable[[], RuntimeMeta]
ReadFilePayloadFn = Callable[[str, str], EditorOpenPayload]
UpdateSessionStateFn = Callable[[dict[str, object]], None]
SetLastFileFn = Callable[[str, str], None]
EmitToRoomFn = Callable[[str, dict[str, object]], Awaitable[None]]
BroadcastActiveFileUpdateFn = Callable[[str, str], Awaitable[None]]
EmitHostActiveFileChangedFn = Callable[..., Awaitable[None]]
NotifyDraftStateChangedFn = Callable[[str], None]
RecordSaveShaFn = Callable[[str, str], None]


class _CapturedEmit:
    def __init__(self) -> None:
        self.event_name: str | None = None
        self.payload: dict[str, object] | None = None

    async def __call__(self, event_name: str, payload: dict[str, object]) -> None:
        self.event_name = event_name
        self.payload = payload


def _unwrap_captured_result(capture: _CapturedEmit, *, method: str) -> object:
    payload = capture.payload or {}
    if "error" in payload:
        error_obj = payload.get("error")
        error_message = str(error_obj) if error_obj is not None else f"{method}_failed"
        raise EditorRpcDispatchError(
            JSONRPC_APPLICATION_ERROR,
            error_message,
            data={
                "method": method,
                "legacy_event": capture.event_name or "",
            },
        )
    return payload.get("result")


async def dispatch_editor_rpc_request(
    method: str,
    params: dict[str, object],
    *,
    active_project: ActiveProjectFn,
    normalize_abs_path: NormalizeAbsPathFn,
    is_under_project: IsUnderProjectFn,
    get_lock: WorkbenchLockFn,
    coerce_generation: CoerceGenerationFn,
    mark_open_baseline: MarkOpenBaselineFn,
    has_open_baseline: HasOpenBaselineFn,
    runtime_meta: RuntimeMetaFn,
    read_file_payload: ReadFilePayloadFn,
    update_session_state: UpdateSessionStateFn,
    set_last_file: SetLastFileFn,
    emit_to_room: EmitToRoomFn,
    broadcast_active_file_update: BroadcastActiveFileUpdateFn,
    emit_host_active_file_changed: EmitHostActiveFileChangedFn,
    notify_draft_state_changed: NotifyDraftStateChangedFn,
    record_save_sha: RecordSaveShaFn,
    logger: _logging.Logger,
) -> object:
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

    if method == EDITOR_RPC_METHOD_WORKBENCH_OPEN_FILE:
        capture = _CapturedEmit()
        await handle_workbench_open_file(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            is_under_project=is_under_project,
            get_lock=get_lock,
            coerce_generation=coerce_generation,
            mark_open_baseline=mark_open_baseline,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_HOVER:
        capture = _CapturedEmit()
        await handle_workbench_hover(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_COMPLETIONS:
        capture = _CapturedEmit()
        await handle_workbench_completions(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_INLAY_HINTS:
        capture = _CapturedEmit()
        await handle_workbench_inlay_hints(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_INLAY_HINTS_RESOLVE:
        capture = _CapturedEmit()
        await handle_workbench_inlay_hints_resolve(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_INLAY_HINTS_RELEASE:
        capture = _CapturedEmit()
        await handle_workbench_inlay_hints_release(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_INLINE_COMPLETIONS:
        capture = _CapturedEmit()
        await handle_workbench_inline_completions(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_INLINE_COMPLETIONS_FREE:
        capture = _CapturedEmit()
        await handle_workbench_inline_completions_free(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_INLINE_COMPLETIONS_DID_SHOW:
        capture = _CapturedEmit()
        await handle_workbench_inline_completions_did_show(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS:
        capture = _CapturedEmit()
        await handle_workbench_semantic_tokens(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS_LEGEND:
        capture = _CapturedEmit()
        await handle_workbench_semantic_tokens_legend(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS_RANGE:
        capture = _CapturedEmit()
        await handle_workbench_semantic_tokens_range(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_SYMBOLS:
        capture = _CapturedEmit()
        await handle_workbench_symbols(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            get_lock=get_lock,
            coerce_generation=coerce_generation,
            has_open_baseline=has_open_baseline,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_FOLDING_RANGES:
        capture = _CapturedEmit()
        await handle_workbench_folding_ranges(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            get_lock=get_lock,
            coerce_generation=coerce_generation,
            has_open_baseline=has_open_baseline,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_PROVIDERS:
        capture = _CapturedEmit()
        await handle_workbench_providers(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_DID_CHANGE:
        await handle_workbench_did_change(
            params,
            active_project=active_project,
            get_lock=get_lock,
            coerce_generation=coerce_generation,
            has_open_baseline=has_open_baseline,
            logger=logger,
        )
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_WORKBENCH_GRAMMARS_LIST:
        capture = _CapturedEmit()
        await handle_workbench_grammars_list(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_GRAMMARS_LOAD:
        capture = _CapturedEmit()
        await handle_workbench_grammars_load(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    raise EditorRpcDispatchError(
        JSONRPC_METHOD_NOT_FOUND,
        "method_not_found",
        data={"method": method},
    )
