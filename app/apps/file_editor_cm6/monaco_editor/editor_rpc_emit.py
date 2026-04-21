# pyright: strict
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import cast

from .editor_rpc_contract import (
    EDITOR_RPC_EVENT,
    JSONRPC_VERSION,
    EditorRpcNotification,
    JsonRpcErrorEnvelope,
    JsonRpcId,
    JsonRpcSuccessEnvelope,
)

EmitFn = Callable[[str, dict[str, object]], Awaitable[None]]


async def emit_editor_rpc_result(emit_fn: EmitFn, request_id: JsonRpcId, result: object) -> None:
    payload: JsonRpcSuccessEnvelope = {
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "result": result,
    }
    await emit_fn(EDITOR_RPC_EVENT, cast(dict[str, object], payload))


async def emit_editor_rpc_error(
    emit_fn: EmitFn,
    request_id: JsonRpcId | None,
    code: int,
    message: str,
    *,
    data: dict[str, object] | None = None,
) -> None:
    payload: JsonRpcErrorEnvelope = {
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "error": {
            "code": code,
            "message": message,
        },
    }
    if data:
        payload["error"]["data"] = data
    await emit_fn(EDITOR_RPC_EVENT, cast(dict[str, object], payload))


async def emit_editor_rpc_notification(
    emit_fn: EmitFn,
    method: EditorRpcNotification,
    params: dict[str, object],
) -> None:
    await emit_fn(
        EDITOR_RPC_EVENT,
        {
            "jsonrpc": JSONRPC_VERSION,
            "method": method,
            "params": params,
        },
    )
