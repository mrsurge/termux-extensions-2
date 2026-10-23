"""Native-validated RPC bytes plus native-owned socket context.

Wire guards stay in Rust; namespace handlers retain JSON-RPC/domain validation.
"""
from __future__ import annotations

from typing import Protocol

import msgspec

_decoder = msgspec.msgpack.Decoder(object)


class RpcDelivery(Protocol):
    async def deliver_rpc(self, namespace: str, sid: str, data: object) -> object: ...


async def deliver_rpc(
    server: RpcDelivery, namespace: str, sid: str, event: str, payload: bytes,
) -> object:
    if namespace not in {"/rpc/editor", "/rpc/explorer", "/ui_ipc"} or event != "rpc" or not sid:
        raise ValueError("invalid native RPC context")
    data = _decoder.decode(payload)
    # Payload fields cannot override transport identity, even on scalar/invalid
    # domain envelopes. Their rejection belongs to the unchanged namespace owner.
    return await server.deliver_rpc(namespace, sid, data)
