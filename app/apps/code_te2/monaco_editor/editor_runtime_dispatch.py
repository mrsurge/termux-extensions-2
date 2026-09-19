# pyright: strict
from __future__ import annotations

from .editor_rpc_dispatch import dispatch_editor_rpc_request
from .editor_ws import (
    editor_runtime_active_project,
    editor_runtime_emit_open_state_changed,
    editor_runtime_emit_room_event,
    editor_runtime_get_cached_document,
    editor_runtime_handle_breadcrumb_navigate,
    editor_runtime_handle_issues_dump_response,
    editor_runtime_handle_model_ready,
    editor_runtime_handle_scroll_state,
    editor_runtime_is_under_project,
    editor_runtime_meta,
    editor_runtime_normalize_abs_path,
    editor_runtime_notify_draft_state_changed,
    editor_runtime_read_disk_text,
    editor_runtime_read_file_payload,
    editor_runtime_record_file_activity,
    editor_runtime_record_sidecar_open_file,
    editor_runtime_record_save_sha,
    editor_runtime_resolve_save_snapshot_response,
)

# Bind application-runtime dependencies once for requests and notifications.
# The transport supplies only decoded intent and authenticated client identity.
async def dispatch_editor_runtime_request(
    method: str, params: dict[str, object], *, source_client: str,
) -> object:
    return await dispatch_editor_rpc_request(
        method,
        params,
        source_client=source_client,
        active_project=editor_runtime_active_project,
        normalize_abs_path=editor_runtime_normalize_abs_path,
        is_under_project=editor_runtime_is_under_project,
        runtime_meta=editor_runtime_meta,
        read_file_payload=editor_runtime_read_file_payload,
        read_disk_text=editor_runtime_read_disk_text,
        get_cached_document=editor_runtime_get_cached_document,
        record_sidecar_open_file=editor_runtime_record_sidecar_open_file,
        emit_open_state_changed=editor_runtime_emit_open_state_changed,
        emit_to_room=lambda event_name, payload: editor_runtime_emit_room_event(
            event_name,
            payload,
            client_instance_id=source_client,
        ),
        notify_draft_state_changed=editor_runtime_notify_draft_state_changed,
        record_save_sha=editor_runtime_record_save_sha,
        record_file_activity=editor_runtime_record_file_activity,
        handle_scroll_state=editor_runtime_handle_scroll_state,
        handle_model_ready=editor_runtime_handle_model_ready,
        resolve_save_snapshot_response=editor_runtime_resolve_save_snapshot_response,
        handle_issues_dump_response=editor_runtime_handle_issues_dump_response,
        handle_breadcrumb_navigate=editor_runtime_handle_breadcrumb_navigate,
    )
