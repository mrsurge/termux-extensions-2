# pyright: strict
from __future__ import annotations

from .rpc_contract import (
    UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET,
    UI_IPC_RPC_METHOD_HOST_DRAFT_DISCARD,
    UI_IPC_RPC_METHOD_HOST_EDITOR_FIND,
    UI_IPC_RPC_METHOD_HOST_EDITOR_COMMAND,
    UI_IPC_RPC_METHOD_HOST_EDITOR_GIT_BASELINES_GET,
    UI_IPC_RPC_METHOD_HOST_EDITOR_ISSUES_COMMAND,
    UI_IPC_RPC_METHOD_HOST_EDITOR_ISSUES_DUMP,
    UI_IPC_RPC_METHOD_HOST_EDITOR_JUMP_TO_LINE,
    UI_IPC_RPC_METHOD_HOST_EDITOR_PREFERENCE_UPDATE,
    UI_IPC_RPC_METHOD_HOST_DIAGNOSTICS_MENTION,
    UI_IPC_RPC_METHOD_HOST_FILE_OPEN,
    UI_IPC_RPC_METHOD_HOST_FILE_RUN,
    UI_IPC_RPC_METHOD_HOST_FILE_SAVE,
    UI_IPC_RPC_METHOD_HOST_STATE_FILE_ACTIVITY_RECORD,
    UI_IPC_RPC_METHOD_HOST_STATE_FILE_SCROLL_UPDATE,
    UiIpcRpcMethod,
    build_jsonrpc_error,
)
from ..boot_snapshot_backend import handle_boot_snapshot_request
from ..host.draft_backend import handle_host_draft_discard_request
from ..host.editor_actions_backend import (
    handle_host_diagnostics_mention_request,
    handle_host_editor_find_request,
    handle_host_editor_command_request,
    handle_host_editor_git_baselines_request,
    handle_host_editor_issues_command_request,
    handle_host_editor_issues_dump_request,
    handle_host_editor_jump_to_line_request,
)
from ..host.editor_preferences_backend import handle_host_editor_preference_request
from ..host.file_ops_backend import handle_host_open_request, handle_host_save_request
from ..host.state_backend import (
    handle_host_file_activity_record_request,
    handle_host_file_scroll_update_request,
)
from ..host.terminal_actions_backend import handle_host_run_active_file_request


async def dispatch_ui_ipc_rpc_request(
    method: UiIpcRpcMethod,
    params: dict[str, object],
    *,
    source_name: str,
) -> object:
    if method == UI_IPC_RPC_METHOD_HOST_FILE_OPEN:
        return await handle_host_open_request(
            params,
            source_name=source_name,
            request_prefix="ui_open",
        )

    if method == UI_IPC_RPC_METHOD_HOST_FILE_SAVE:
        return await handle_host_save_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_DRAFT_DISCARD:
        return await handle_host_draft_discard_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_EDITOR_PREFERENCE_UPDATE:
        return await handle_host_editor_preference_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_EDITOR_COMMAND:
        return await handle_host_editor_command_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_FILE_RUN:
        return await handle_host_run_active_file_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET:
        return await handle_boot_snapshot_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_EDITOR_JUMP_TO_LINE:
        return await handle_host_editor_jump_to_line_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_EDITOR_GIT_BASELINES_GET:
        return await handle_host_editor_git_baselines_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_EDITOR_FIND:
        return await handle_host_editor_find_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_EDITOR_ISSUES_COMMAND:
        return await handle_host_editor_issues_command_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_EDITOR_ISSUES_DUMP:
        return await handle_host_editor_issues_dump_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_DIAGNOSTICS_MENTION:
        return await handle_host_diagnostics_mention_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_STATE_FILE_ACTIVITY_RECORD:
        return await handle_host_file_activity_record_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_STATE_FILE_SCROLL_UPDATE:
        return await handle_host_file_scroll_update_request(
            params,
            source_name=source_name,
        )

    raise RuntimeError(
        build_jsonrpc_error(
            request_id=None,
            code=-32601,
            message="Unknown UI IPC RPC method",
            data={"method": method},
        )["error"]["message"]
    )
