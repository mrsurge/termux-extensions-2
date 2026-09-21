# pyright: strict
from __future__ import annotations

from collections.abc import Awaitable, Callable

from ..frontend_rpc_codec import encode_frontend_rpc_message
from .editor_rpc_contract import EDITOR_RPC_EVENT, EditorRpcNotification, JsonRpcId
from .editor_rpc_messages import (
    build_editor_rpc_error,
    build_editor_rpc_notification,
    build_editor_rpc_result,
)

EmitFn = Callable[[str, bytes], Awaitable[None]]


# Compatibility entrypoints for existing publishers: build the complete DTO
# before encoding/delivery. Application normalization lives in rpc_messages.
async def emit_editor_rpc_result(emit_fn: EmitFn, request_id: JsonRpcId, result: object) -> None:
    payload = build_editor_rpc_result(request_id, result)
    await emit_fn(EDITOR_RPC_EVENT, encode_frontend_rpc_message(payload, lane="editor"))


async def emit_editor_rpc_error(
    emit_fn: EmitFn,
    request_id: JsonRpcId | None,
    code: int,
    message: str,
    *,
    data: dict[str, object] | None = None,
) -> None:
    payload = build_editor_rpc_error(request_id, code, message, data=data)
    await emit_fn(EDITOR_RPC_EVENT, encode_frontend_rpc_message(payload, lane="editor"))


async def emit_editor_rpc_notification(
    emit_fn: EmitFn,
    method: EditorRpcNotification,
    params: dict[str, object],
) -> None:
    payload = build_editor_rpc_notification(method, params)
    await emit_fn(EDITOR_RPC_EVENT, encode_frontend_rpc_message(payload, lane="editor", method=method))
