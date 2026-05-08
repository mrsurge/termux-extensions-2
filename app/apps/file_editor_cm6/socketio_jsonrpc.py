# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

from dataclasses import dataclass
from typing import Final, cast

import msgspec

JSONRPC_VERSION: Final = "2.0"
JSONRPC_INVALID_REQUEST: Final = -32600
JSONRPC_INVALID_PARAMS: Final = -32602

JsonObject = dict[str, object]
JsonRpcId = str | int


class _IncomingJsonRpcEnvelope(msgspec.Struct, frozen=True):
    jsonrpc: str
    method: str
    params: object = None
    id: object = msgspec.UNSET


@dataclass(frozen=True)
class JsonRpcEnvelope:
    method: str
    params: object
    request_id: object
    has_id: bool


@dataclass(frozen=True)
class JsonRpcEnvelopeError(Exception):
    request_id: object | None
    code: int
    message: str


def normalize_json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized


def normalize_jsonrpc_params(value: object) -> JsonObject:
    if value is None:
        return {}
    return normalize_json_object(value)


def is_jsonrpc_id(value: object) -> bool:
    return isinstance(value, (str, int)) and not isinstance(value, bool)


def coerce_error_request_id(value: object) -> object | None:
    if value is msgspec.UNSET or value is None:
        return None
    return value if is_jsonrpc_id(value) else None


def coerce_jsonrpc_envelope(payload: object) -> JsonRpcEnvelope:
    try:
        incoming = msgspec.convert(payload, _IncomingJsonRpcEnvelope, str_keys=True)
    except msgspec.ValidationError as exc:
        raise JsonRpcEnvelopeError(
            None,
            JSONRPC_INVALID_REQUEST,
            "Invalid JSON-RPC envelope",
        ) from exc

    request_id = incoming.id
    error_request_id = coerce_error_request_id(request_id)
    if incoming.jsonrpc != JSONRPC_VERSION:
        raise JsonRpcEnvelopeError(
            error_request_id,
            JSONRPC_INVALID_REQUEST,
            "jsonrpc must be '2.0'",
        )
    method = incoming.method.strip()
    if not method:
        raise JsonRpcEnvelopeError(
            error_request_id,
            JSONRPC_INVALID_REQUEST,
            "method is required",
        )
    return JsonRpcEnvelope(
        method=method,
        params=incoming.params,
        request_id=request_id,
        has_id=request_id is not msgspec.UNSET,
    )
