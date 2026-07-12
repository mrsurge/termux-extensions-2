# pyright: strict
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TypeAlias, cast

from ..frontend_rpc_codec import encode_frontend_rpc_message
from .editor_rpc_contract import (
    EDITOR_RPC_EVENT,
    JSONRPC_VERSION,
    EditorRpcNotification,
    JsonRpcErrorEnvelope,
    JsonRpcId,
    JsonRpcSuccessEnvelope,
)

EmitFn = Callable[[str, bytes], Awaitable[None]]
JsonSafe: TypeAlias = None | bool | int | float | str | list["JsonSafe"] | dict[str, "JsonSafe"]


def _json_safe(value: object, *, seen: set[int] | None = None, depth: int = 0) -> JsonSafe:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if depth > 64:
        return None
    if seen is None:
        seen = set()
    if isinstance(value, dict):
        value_id = id(cast(object, value))
        if value_id in seen:
            return None
        seen.add(value_id)
        try:
            safe_dict: dict[str, JsonSafe] = {}
            for key, item in cast(dict[object, object], value).items():
                if isinstance(key, str):
                    safe_dict[key] = _json_safe(item, seen=seen, depth=depth + 1)
            return safe_dict
        finally:
            seen.discard(value_id)
    if isinstance(value, (list, tuple)):
        value_sequence = cast(list[object] | tuple[object, ...], value)
        value_id = id(value_sequence)
        if value_id in seen:
            return None
        seen.add(value_id)
        try:
            return [_json_safe(item, seen=seen, depth=depth + 1) for item in value_sequence]
        finally:
            seen.discard(value_id)
    return str(value)


def _json_safe_object(value: object) -> dict[str, object]:
    safe = _json_safe(value)
    return cast(dict[str, object], safe) if isinstance(safe, dict) else {}


async def emit_editor_rpc_result(emit_fn: EmitFn, request_id: JsonRpcId, result: object) -> None:
    payload: JsonRpcSuccessEnvelope = {
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "result": _json_safe(result),
    }
    await emit_fn(
        EDITOR_RPC_EVENT,
        encode_frontend_rpc_message(cast(dict[str, object], payload), lane="editor"),
    )


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
        payload["error"]["data"] = _json_safe_object(data)
    await emit_fn(
        EDITOR_RPC_EVENT,
        encode_frontend_rpc_message(cast(dict[str, object], payload), lane="editor"),
    )


async def emit_editor_rpc_notification(
    emit_fn: EmitFn,
    method: EditorRpcNotification,
    params: dict[str, object],
) -> None:
    envelope: dict[str, object] = {
        "jsonrpc": JSONRPC_VERSION,
        "method": method,
        "params": _json_safe_object(params),
    }
    await emit_fn(
        EDITOR_RPC_EVENT,
        encode_frontend_rpc_message(envelope, lane="editor", method=method),
    )
