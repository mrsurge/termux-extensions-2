"""Codec negotiation only; native transport owns frontend MessagePack bytes.

Domain handlers receive structural values through PyO3. JSON-RPC validation
remains in socketio_jsonrpc and lane-specific contracts, not in this module.
"""
# pyright: strict
from __future__ import annotations

from typing import Final, cast

RPC_CODEC_AUTH_FIELD: Final = "rpcCodec"
RPC_CODEC_MSGPACK_V1: Final = "msgpack-v1"
RPC_CODEC_MSGPACK_GZIP_V1: Final = "msgpack-gzip-v1"


class FrontendRpcCodecError(ValueError):
    pass


def require_msgpack_v1_auth(auth: object, *, allow_gzip: bool = False) -> None:
    if not isinstance(auth, dict):
        raise FrontendRpcCodecError("missing_rpc_codec")
    auth_obj = cast(dict[object, object], auth)
    codec = auth_obj.get(RPC_CODEC_AUTH_FIELD)
    if codec != RPC_CODEC_MSGPACK_V1 and not (allow_gzip and codec == RPC_CODEC_MSGPACK_GZIP_V1):
        raise FrontendRpcCodecError("unsupported_rpc_codec")
