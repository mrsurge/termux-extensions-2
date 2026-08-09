# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

import json
import logging
import os
import time
from typing import Final, cast

import msgspec

RPC_CODEC_AUTH_FIELD: Final = "rpcCodec"
RPC_CODEC_MSGPACK_V1: Final = "msgpack-v1"

_ENCODER = msgspec.msgpack.Encoder()
_DECODER = msgspec.msgpack.Decoder()
logger = logging.getLogger(__name__)
_METRICS_ENABLED = os.getenv("CODE_TE2_RPC_CODEC_METRICS", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


class FrontendRpcCodecError(ValueError):
    pass


def require_msgpack_v1_auth(auth: object) -> None:
    if not isinstance(auth, dict):
        raise FrontendRpcCodecError("missing_rpc_codec")
    auth_obj = cast(dict[object, object], auth)
    if auth_obj.get(RPC_CODEC_AUTH_FIELD) != RPC_CODEC_MSGPACK_V1:
        raise FrontendRpcCodecError("unsupported_rpc_codec")


# The codec boundary owns bytes and observability. Domain dispatchers receive
# decoded objects and never depend on MessagePack or Socket.IO framing.
def decode_frontend_rpc_message(
    payload: object,
    *,
    lane: str,
) -> object:
    if not isinstance(payload, (bytes, bytearray, memoryview)):
        raise FrontendRpcCodecError("binary_rpc_payload_required")
    if isinstance(payload, bytes):
        encoded_payload = payload
    elif isinstance(payload, bytearray):
        encoded_payload = bytes(payload)
    else:
        encoded_payload = payload.tobytes()
    started_ns = time.perf_counter_ns() if _METRICS_ENABLED else 0
    try:
        decoded = cast(object, _DECODER.decode(encoded_payload))
    except msgspec.DecodeError as exc:
        raise FrontendRpcCodecError("invalid_msgpack_payload") from exc
    if _METRICS_ENABLED:
        _emit_metrics(
            direction="decode",
            lane=lane,
            method=_message_method(decoded),
            byte_count=len(encoded_payload),
            duration_ns=time.perf_counter_ns() - started_ns,
        )
    return decoded


def encode_frontend_rpc_message(
    payload: object,
    *,
    lane: str,
    method: str | None = None,
) -> bytes:
    started_ns = time.perf_counter_ns() if _METRICS_ENABLED else 0
    try:
        encoded = _ENCODER.encode(payload)
    except (TypeError, msgspec.EncodeError) as exc:
        raise FrontendRpcCodecError("rpc_payload_not_encodable") from exc
    if _METRICS_ENABLED:
        _emit_metrics(
            direction="encode",
            lane=lane,
            method=method or _message_method(payload),
            byte_count=len(encoded),
            duration_ns=time.perf_counter_ns() - started_ns,
        )
    return encoded


def _message_method(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return None
    method = cast(dict[object, object], payload).get("method")
    return method if isinstance(method, str) and method else None


def _emit_metrics(
    *,
    direction: str,
    lane: str,
    method: str | None,
    byte_count: int,
    duration_ns: int,
) -> None:
    if not _METRICS_ENABLED:
        return
    record: dict[str, object] = {
        "system": "code_te2.frontend_rpc_codec",
        "kind": "codec",
        "ts_ms": int(time.time() * 1000),
        "codec": RPC_CODEC_MSGPACK_V1,
        "direction": direction,
        "lane": lane,
        "bytes": byte_count,
        "duration_ms": round(duration_ns / 1_000_000, 3),
    }
    if method:
        record["method"] = method
    try:
        print(json.dumps(record, sort_keys=True), flush=True)
    except Exception as exc:
        logger.debug("[frontend_rpc_codec] failed to emit metrics error=%s", exc)
