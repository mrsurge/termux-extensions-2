# pyright: strict
from __future__ import annotations

from .rpc_contract import (
    UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET,
    UI_IPC_RPC_METHOD_HOST_LANGUAGE_BACKEND_SET,
    UI_IPC_RPC_METHOD_HOST_CODE_INSPECTOR_COMMAND,
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
    UI_IPC_RPC_METHOD_HOST_PAGE_PREVIEW_TEMPLATE_INSTALL,
    UI_IPC_RPC_METHOD_HOST_RECENT_FILE_CLOSE,
    UI_IPC_RPC_METHOD_HOST_CLIENT_FOREGROUND_CLEAR,
    UI_IPC_RPC_METHOD_HOST_RUN_PROFILES_GET,
    UI_IPC_RPC_METHOD_HOST_RUN_PROFILES_SAVE,
    UI_IPC_RPC_METHOD_HOST_RUN_PROFILE_STATE_GET,
    UI_IPC_RPC_METHOD_HOST_RUN_PROFILE_STOP,
    UI_IPC_RPC_METHOD_HOST_EXTENSION_WEBVIEW_DISPOSE,
    UI_IPC_RPC_METHOD_HOST_EXTENSION_WEBVIEW_CLIENT_STATE_RESET,
    UI_IPC_RPC_METHOD_HOST_GIT_BRANCH_CHECKOUT,
    UI_IPC_RPC_METHOD_HOST_GIT_BRANCH_CREATE,
    UI_IPC_RPC_METHOD_HOST_GIT_BRANCHES_LIST,
    UI_IPC_RPC_METHOD_HOST_GIT_REMOTE_ADD,
    UI_IPC_RPC_METHOD_SIDEBAR_ACTIVE_SHORTCUT_SET,
    UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_ACTIVATE,
    UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_CLOSE,
    UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_CREATE,
    UI_IPC_RPC_METHOD_HOST_STATE_FILE_SCROLL_UPDATE,
    UiIpcRpcMethod,
    build_jsonrpc_error,
)
from ..boot_snapshot_backend import handle_boot_snapshot_request
from ..host.code_server_backend import handle_host_language_backend_set_request
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
from ..host.extension_webview_backend import (
    handle_host_extension_webview_client_state_reset_request,
    handle_host_extension_webview_dispose_request,
)
from ..host.git_backend import (
    handle_host_git_branch_checkout_request,
    handle_host_git_branch_create_request,
    handle_host_git_branches_list_request,
    handle_host_git_remote_add_request,
)
from ..host.state_backend import handle_host_file_scroll_update_request
from ..host.terminal_actions_backend import handle_host_run_active_file_request
from ..host.page_preview_backend import handle_host_page_preview_template_install_request
from ..host.recent_files_backend import (
    handle_host_client_foreground_clear_request,
    handle_host_recent_file_close_request,
)
from ..host.run_profiles_config_backend import (
    handle_host_run_profiles_get_request,
    handle_host_run_profiles_save_request,
)
from ..host.runner_profiles_backend import (
    handle_run_profile_state_get_request,
    handle_run_profile_stop_request,
)


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

    if method == UI_IPC_RPC_METHOD_HOST_PAGE_PREVIEW_TEMPLATE_INSTALL:
        return await handle_host_page_preview_template_install_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_RUN_PROFILES_GET:
        return await handle_host_run_profiles_get_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_RUN_PROFILES_SAVE:
        return await handle_host_run_profiles_save_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_RUN_PROFILE_STATE_GET:
        return await handle_run_profile_state_get_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_RUN_PROFILE_STOP:
        return await handle_run_profile_stop_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_EXTENSION_WEBVIEW_DISPOSE:
        return await handle_host_extension_webview_dispose_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_EXTENSION_WEBVIEW_CLIENT_STATE_RESET:
        return await handle_host_extension_webview_client_state_reset_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET:
        return await handle_boot_snapshot_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_LANGUAGE_BACKEND_SET:
        return await handle_host_language_backend_set_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_CODE_INSPECTOR_COMMAND:
        from ..code_inspector_backend import handle_code_inspector_command

        return await handle_code_inspector_command(
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

    if method == UI_IPC_RPC_METHOD_HOST_GIT_BRANCHES_LIST:
        return await handle_host_git_branches_list_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_GIT_BRANCH_CHECKOUT:
        return await handle_host_git_branch_checkout_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_GIT_BRANCH_CREATE:
        return await handle_host_git_branch_create_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_GIT_REMOTE_ADD:
        return await handle_host_git_remote_add_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_STATE_FILE_SCROLL_UPDATE:
        return await handle_host_file_scroll_update_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_RECENT_FILE_CLOSE:
        return await handle_host_recent_file_close_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_HOST_CLIENT_FOREGROUND_CLEAR:
        return await handle_host_client_foreground_clear_request(
            params,
            source_name=source_name,
        )

    if method == UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_CREATE:
        from .sidebar_ws import handle_ui_sidebar_window_create_request

        return await handle_ui_sidebar_window_create_request(params)

    if method == UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_ACTIVATE:
        from .sidebar_ws import handle_ui_sidebar_window_activate_request

        return await handle_ui_sidebar_window_activate_request(params)

    if method == UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_CLOSE:
        from .sidebar_ws import handle_ui_sidebar_window_close_request

        return await handle_ui_sidebar_window_close_request(params)

    if method == UI_IPC_RPC_METHOD_SIDEBAR_ACTIVE_SHORTCUT_SET:
        from .sidebar_ws import handle_ui_sidebar_active_shortcut_set_request

        return await handle_ui_sidebar_active_shortcut_set_request(params)

    raise RuntimeError(
        build_jsonrpc_error(
            request_id=None,
            code=-32601,
            message="Unknown UI IPC RPC method",
            data={"method": method},
        )["error"]["message"]
    )
