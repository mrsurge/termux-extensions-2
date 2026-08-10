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
