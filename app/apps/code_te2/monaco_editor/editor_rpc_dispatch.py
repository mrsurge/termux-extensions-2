# pyright: strict
from __future__ import annotations
import asyncio

import time
from ..theme_catalog import get_theme_catalog, resolve_selected_theme
from collections.abc import Awaitable, Callable
from .editor_host_actions_backend import handle_editor_host_action
from ..diagnostics_latency_metrics import (
    finish_open_trace,
    record_open_stage,
)
from .editor_rpc_contract import (
    EDITOR_RPC_METHOD_AGENT_EDITS_DECIDE,
    EDITOR_RPC_METHOD_AGENT_EDITS_DOCUMENT_STATE_GET,
    EDITOR_RPC_METHOD_BLUR,
    EDITOR_RPC_METHOD_BREADCRUMB_NAVIGATE,
    EDITOR_RPC_METHOD_CACHE_STATE_PUBLISH,
    EDITOR_RPC_METHOD_CODE_INSPECTOR_PUBLISH,
    EDITOR_RPC_METHOD_DIAGNOSTICS_COUNTS_PUBLISH,
    EDITOR_RPC_METHOD_DRAFT_DIFF_GET,
    EDITOR_RPC_METHOD_DRAFT_STATE_PUBLISH,
    EDITOR_RPC_METHOD_FOCUS,
    EDITOR_RPC_METHOD_GIT_BASELINES_GET,
    EDITOR_RPC_METHOD_HOST_SAVE,
    EDITOR_RPC_METHOD_ISSUES_DUMP_RESPONSE,
    EDITOR_RPC_METHOD_JUMP_TO_LINE,
    EDITOR_RPC_METHOD_MENTION_REQUEST,
    EDITOR_RPC_METHOD_MIRROR_PUBLISH,
    EDITOR_RPC_METHOD_MODEL_READY,
    EDITOR_RPC_METHOD_NOTIFY_PUBLISH,
    EDITOR_RPC_METHOD_OPEN,
    EDITOR_RPC_METHOD_OPEN_COMPLETE_PUBLISH,
    EDITOR_RPC_METHOD_READY_PUBLISH,
    EDITOR_RPC_METHOD_SAVE,
    EDITOR_RPC_METHOD_SAVE_SNAPSHOT_RESPONSE,
    EDITOR_RPC_METHOD_SCROLL_STATE_PUBLISH,
    EDITOR_RPC_METHOD_TEXTMATE_CATALOG_GET,
    EDITOR_RPC_METHOD_TEXTMATE_GRAMMAR_GET,
    JSONRPC_METHOD_NOT_FOUND,
    EditorRpcDispatchError,
)
from .editor_mention_backend import handle_editor_mention_request
from .editor_open_backend import EditorOpenPayload, emit_editor_open_from_backend
from .editor_save_backend import handle_editor_mirror, handle_editor_save_request
from .editor_backend_services.contracts import RuntimeMeta
from ..open_state_backend import ClientForegroundPayload, SidecarOpenStatePayload
from .editor_view_state_backend import (
    GetCachedDocumentFn,
    ReadDiskTextFn,
    RecordFileActivityFn,
    build_editor_draft_diff_payload,
    build_editor_git_baselines_payload,
    build_editor_jump_to_line_payload,
)

ActiveProjectFn = Callable[[], str | None]
NormalizeAbsPathFn = Callable[[str], str | None]
IsUnderProjectFn = Callable[[str, str], bool]
RuntimeMetaFn = Callable[[], RuntimeMeta]
ReadFilePayloadFn = Callable[[str, str], EditorOpenPayload]
EmitToRoomFn = Callable[[str, dict[str, object]], Awaitable[None]]
RecordSidecarOpenFileFn = Callable[
    ...,
    tuple[SidecarOpenStatePayload, ClientForegroundPayload],
]
EmitOpenStateChangedFn = Callable[..., Awaitable[None]]
NotifyDraftStateChangedFn = Callable[[str], None]
RecordSaveShaFn = Callable[[str, str], None]
HandleEditorPayloadFn = Callable[[str, dict[str, object]], Awaitable[None]]
ResolveEditorPayloadFn = Callable[[dict[str, object]], None]


def _payload_with_source(params: dict[str, object], source_client: str) -> dict[str, object]:
    payload = dict(params)
    payload["source_client"] = payload.get("source_client") or source_client
    return payload


async def dispatch_editor_rpc_request(
    method: str,
    params: dict[str, object],
    *,
    source_client: str,
    active_project: ActiveProjectFn,
    normalize_abs_path: NormalizeAbsPathFn,
    is_under_project: IsUnderProjectFn,
    runtime_meta: RuntimeMetaFn,
    read_file_payload: ReadFilePayloadFn,
    read_disk_text: ReadDiskTextFn,
    get_cached_document: GetCachedDocumentFn,
    record_sidecar_open_file: RecordSidecarOpenFileFn,
    emit_open_state_changed: EmitOpenStateChangedFn,
    emit_to_room: EmitToRoomFn,
    notify_draft_state_changed: NotifyDraftStateChangedFn,
    record_save_sha: RecordSaveShaFn,
    record_file_activity: RecordFileActivityFn,
    handle_scroll_state: HandleEditorPayloadFn,
    handle_model_ready: HandleEditorPayloadFn,
    resolve_save_snapshot_response: ResolveEditorPayloadFn,
    handle_issues_dump_response: HandleEditorPayloadFn,
    handle_breadcrumb_navigate: HandleEditorPayloadFn,
) -> object:
    if method == "editor.themes.list":
        return await get_theme_catalog()

    if method == "editor.theme.selected":
        import os
        from ..stores import get_preferences_store
        preferences = get_preferences_store().get_preferences(active_project())
        selected = await asyncio.to_thread(resolve_selected_theme, preferences)
        if os.environ.get("TE2_RUNTIME_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}:
            return {**selected, "_runtimeDebug": True}
        return selected

    if method == EDITOR_RPC_METHOD_TEXTMATE_CATALOG_GET:
        from ..textmate_projection import get_textmate_catalog

        return await asyncio.to_thread(get_textmate_catalog)

    if method == EDITOR_RPC_METHOD_TEXTMATE_GRAMMAR_GET:
        from ..textmate_projection import TextmateProjectionError, get_textmate_grammar_body

        grammar_id = params.get("id")
        revision = params.get("revision")
        if not isinstance(grammar_id, str) or not grammar_id:
            raise EditorRpcDispatchError(-32602, "textmate_grammar_id_required")
        if not isinstance(revision, str) or not revision:
            raise EditorRpcDispatchError(-32602, "textmate_revision_required")
        try:
            return await asyncio.to_thread(get_textmate_grammar_body, grammar_id, revision)
        except TextmateProjectionError as exc:
            raise EditorRpcDispatchError(-32000, str(exc)) from exc

    if method == "editor.preferences.get":
        from ..stores import get_preferences_store
        return {"preferences": get_preferences_store().get_preferences(active_project())}

    if method == "editor.preference.update":
        from .editor_preferences_backend import handle_editor_preference_update_request
        return await handle_editor_preference_update_request(params, source_client=source_client)

    if method in (EDITOR_RPC_METHOD_HOST_SAVE, EDITOR_RPC_METHOD_FOCUS, EDITOR_RPC_METHOD_BLUR):
        return await handle_editor_host_action(
            method,
            params,
            source_client=source_client,
        )

    if method == EDITOR_RPC_METHOD_OPEN:
        request_id = str(params.get("request_id") or f"rpc_open_{int(time.time() * 1000)}")
        payload = await emit_editor_open_from_backend(
            params,
            source_client=source_client,
            request_id=request_id,
            active_project=active_project,
            normalize_abs_path=normalize_abs_path,
            is_under_project=is_under_project,
            read_file_payload=read_file_payload,
            emit_editor_open=lambda open_payload: emit_to_room("editor:open", dict(open_payload)),
            record_sidecar_open_file=record_sidecar_open_file,
            emit_open_state_changed=emit_open_state_changed,
        )
        return payload

    if method == EDITOR_RPC_METHOD_MIRROR_PUBLISH:
        await handle_editor_mirror(
            source_client,
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
            source_client,
            {
                "path": params.get("path"),
                "target_path": params.get("target_path"),
                "request_id": request_id,
                "requestId": request_id,
                "base_sha256": params.get("base_sha256"),
                "force": params.get("force"),
                "client_id": params.get("client_id", source_client),
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

    if method == EDITOR_RPC_METHOD_AGENT_EDITS_DOCUMENT_STATE_GET:
        from ..host.agent_edit_review_backend import hydrate_agent_edit_document_state

        return await hydrate_agent_edit_document_state(params)

    if method == EDITOR_RPC_METHOD_AGENT_EDITS_DECIDE:
        from ..host.agent_edit_review_backend import handle_editor_agent_edits_decide_request

        return await handle_editor_agent_edits_decide_request(params)

    if method == EDITOR_RPC_METHOD_READY_PUBLISH:
        await emit_to_room("editor:ready", _payload_with_source(params, source_client))
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_CACHE_STATE_PUBLISH:
        await emit_to_room("editor:cache_state", _payload_with_source(params, source_client))
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_DRAFT_STATE_PUBLISH:
        await emit_to_room("editor:draft_state", _payload_with_source(params, source_client))
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_NOTIFY_PUBLISH:
        await emit_to_room("editor:notify", _payload_with_source(params, source_client))
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_OPEN_COMPLETE_PUBLISH:
        request_id = str(params.get("request_id") or params.get("requestId") or "")
        record_open_stage(request_id, "backend_open_complete_received")
        from ..extension_navigation_backend import resolve_extension_open_complete

        _ = resolve_extension_open_complete(params, source_client)
        await emit_to_room("editor:open_complete", _payload_with_source(params, source_client))
        finish_open_trace(request_id, "backend_open_complete_published")
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_CODE_INSPECTOR_PUBLISH:
        from ..code_inspector_backend import publish_code_inspector_projection

        return await publish_code_inspector_projection(
            params,
            source_client=source_client,
        )

    if method == EDITOR_RPC_METHOD_DIAGNOSTICS_COUNTS_PUBLISH:
        await emit_to_room("editor:diagnostics_counts", _payload_with_source(params, source_client))
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_SCROLL_STATE_PUBLISH:
        await handle_scroll_state(source_client, params)
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_MODEL_READY:
        await handle_model_ready(source_client, params)
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_SAVE_SNAPSHOT_RESPONSE:
        resolve_save_snapshot_response(_payload_with_source(params, source_client))
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_ISSUES_DUMP_RESPONSE:
        await handle_issues_dump_response(source_client, params)
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_BREADCRUMB_NAVIGATE:
        await handle_breadcrumb_navigate(source_client, params)
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_JUMP_TO_LINE:
        return build_editor_jump_to_line_payload(
            params,
            source_client=source_client,
            active_project=active_project,
            normalize_abs_path=normalize_abs_path,
            is_under_project=is_under_project,
            record_file_activity=record_file_activity,
        )

    if method == EDITOR_RPC_METHOD_GIT_BASELINES_GET:
        return await asyncio.to_thread(build_editor_git_baselines_payload,
            params,
            source_client=source_client,
            active_project=active_project,
            normalize_abs_path=normalize_abs_path,
            is_under_project=is_under_project,
            read_disk_text=read_disk_text,
        )

    if method == EDITOR_RPC_METHOD_DRAFT_DIFF_GET:
        return build_editor_draft_diff_payload(
            params,
            source_client=source_client,
            active_project=active_project,
            normalize_abs_path=normalize_abs_path,
            is_under_project=is_under_project,
            read_disk_text=read_disk_text,
            get_cached_document=get_cached_document,
        )

    raise EditorRpcDispatchError(
        JSONRPC_METHOD_NOT_FOUND,
        "method_not_found",
        data={"method": method},
    )
