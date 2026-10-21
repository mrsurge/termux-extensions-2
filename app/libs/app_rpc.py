"""Request/reply over the existing owned framework pipe; never replay calls."""
from __future__ import annotations

import uuid
import msgspec

from . import pipe_runtime


class _RouteReceipt(msgspec.Struct, forbid_unknown_fields=True):
    appId: str
    available: bool


async def call_app_rpc(
    target_app: str, service: str, method: str, payload: object, *,
    version: int = 1, context: object = None, timeout: float = 20,
) -> object:
    if not all(value.strip() for value in (target_app, service, method)) or version < 1:
        raise ValueError("App RPC target, service, method and positive version are required")
    return await pipe_runtime.call_async(
        "app.rpc.call",
        {"targetApp": target_app, "service": service, "version": version,
         "method": method, "context": context, "payload": payload},
        target_name="framework.rust", target_nid=1,
        op_id=uuid.uuid4().hex, timeout_seconds=timeout,
    )


async def app_rpc_route_available(target_app: str, service: str, method: str, *, version: int = 1) -> bool:
    """Inspect an owned route before choosing a standalone transport, not retry.

    A route receipt is not proof of semantic handler support. Once selected,
    call failure must not fall through to another transport.
    """
    result = await pipe_runtime.call_async(
        "app.rpc.route.get",
        {"targetApp": target_app, "service": service, "version": version,
         "method": method, "context": None, "payload": None},
        target_name="framework.rust", target_nid=1, op_id=uuid.uuid4().hex,
        timeout_seconds=20,
    )
    return msgspec.convert(result, type=_RouteReceipt, strict=True).available
