"""Host actions for WBA-owned extension webview surfaces."""

from __future__ import annotations

from typing import cast

from ..workbench_adapter_shell_manager import adapter_rpc


async def handle_host_extension_webview_dispose_request(
    params: dict[str, object],
    *,
    source_name: str,
) -> object:
    surface_id = str(params.get("surfaceId") or params.get("surface_id") or "").strip()
    if not surface_id:
        raise ValueError("surfaceId is required")
    response = await adapter_rpc(
        "vscode.webview.dispose",
        {"surfaceId": surface_id, "source": source_name},
        timeout=10.0,
    )
    error = response.get("error")
    if isinstance(error, dict):
        error_object = cast(dict[object, object], error)
        raise RuntimeError(
            str(error_object.get("message") or "Extension webview close failed")
        )
    return response.get("result") or {"ok": True, "surfaceId": surface_id}


async def handle_host_extension_webview_client_state_reset_request(
    params: dict[str, object],
    *,
    source_name: str,
) -> object:
    client_instance_id = str(
        params.get("clientInstanceId") or params.get("client_instance_id") or ""
    ).strip()
    if not client_instance_id:
        raise ValueError("clientInstanceId is required")
    response = await adapter_rpc(
        "vscode.webview.clientState.reset",
        {"clientInstanceId": client_instance_id, "source": source_name},
        timeout=10.0,
    )
    error = response.get("error")
    if isinstance(error, dict):
        error_object = cast(dict[object, object], error)
        raise RuntimeError(
            str(error_object.get("message") or "Extension webview client reset failed")
        )
    return response.get("result") or {
        "ok": True,
        "clientInstanceId": client_instance_id,
    }
