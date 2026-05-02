# pyright: strict
from __future__ import annotations

from .rpc_contract import (
    UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET,
    UI_IPC_RPC_METHOD_HOST_EDITOR_PREFERENCE_UPDATE,
    UI_IPC_RPC_METHOD_HOST_FILE_OPEN,
    UI_IPC_RPC_METHOD_HOST_FILE_RUN,
    UI_IPC_RPC_METHOD_HOST_FILE_SAVE,
    UiIpcRpcMethod,
    build_jsonrpc_error,
)
from ..boot_snapshot_backend import handle_boot_snapshot_request
from ..host.editor_preferences_backend import handle_host_editor_preference_request
from ..host.file_ops_backend import handle_host_open_request, handle_host_save_request
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

    if method == UI_IPC_RPC_METHOD_HOST_EDITOR_PREFERENCE_UPDATE:
        return await handle_host_editor_preference_request(
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

    raise RuntimeError(
        build_jsonrpc_error(
            request_id=None,
            code=-32601,
            message="Unknown UI IPC RPC method",
            data={"method": method},
        )["error"]["message"]
    )
