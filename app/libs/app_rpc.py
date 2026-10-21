"""Request/reply over the existing owned framework pipe; never replay calls."""
from __future__ import annotations

import uuid

from . import pipe_runtime


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
