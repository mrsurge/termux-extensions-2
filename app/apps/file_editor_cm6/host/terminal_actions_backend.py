# pyright: strict
from __future__ import annotations

import importlib
from typing import Awaitable, Callable, cast

from fastapi import HTTPException

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..ui_ipc.rpc_contract import UI_IPC_RPC_NOTIFICATION_TERMINAL_OPEN

RunActiveFileHook = Callable[[dict[str, object] | None], Awaitable[dict[str, object]]]

_LEGACY_UNSUPPORTED_RUNNER_MESSAGE = (
    "Only Python, shell, JS/TS, and C/C++ source files can be executed"
)


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""


def _json_object(value: object) -> JsonMap:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


async def _save_before_play(payload: JsonMap, *, source_name: str) -> JsonMap | None:
    from .file_ops_backend import handle_host_save_request

    save_payload: JsonMap = dict(payload)
    save_payload["reason"] = "play"
    try:
        save_result = await handle_host_save_request(save_payload, source_name=source_name)
    except Exception as exc:
        return {"ok": False, "error": f"Save failed; not running file: {exc}"}
    if save_result.get("ok") is False:
        error = _text(save_result.get("error")) or "Save failed; not running file"
        return {"ok": False, "error": error, "data": {"save": save_result}}
    return None


async def _emit_terminal_open(payload: JsonMap) -> None:
    from ..ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

    await emit_ui_ipc_rpc_notification(UI_IPC_RPC_NOTIFICATION_TERMINAL_OPEN, payload)


async def handle_host_run_active_file_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    payload: JsonMap = dict(data)
    if "source_client" not in payload:
        payload["source_client"] = source_name
    from .page_preview_backend import maybe_handle_page_preview_run_request

    save_failure = await _save_before_play(payload, source_name=source_name)
    if save_failure is not None:
        return save_failure

    page_preview_result = await maybe_handle_page_preview_run_request(
        payload,
        source_name=source_name,
    )
    if page_preview_result is not None:
        return page_preview_result

    terminal_backend = importlib.import_module("app.apps.file_editor_cm6.terminal_backend")
    hook = cast(RunActiveFileHook, getattr(terminal_backend, "handle_run_active_file_request"))
    try:
        result = dict(await hook(payload))
    except HTTPException as exc:
        if exc.status_code == 400 and str(exc.detail) == _LEGACY_UNSUPPORTED_RUNNER_MESSAGE:
            return {
                "ok": False,
                "error": "No run profile or default runner for this file",
                "data": {"action": "none"},
            }
        raise

    if result.get("ok") is True:
        data_obj = _json_object(cast(object, result.get("data")))
        data_obj.setdefault("action", "terminal")
        data_obj.setdefault("message", "Running active file in terminal")
        result["data"] = data_obj
        await _emit_terminal_open(data_obj)
    return result
