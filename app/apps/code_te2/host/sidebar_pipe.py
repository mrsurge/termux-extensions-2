"""Owned ALS pipe lane; route inspection is not a mutation retry/fallback."""
from __future__ import annotations

from contextvars import ContextVar
import msgspec
import logging

from app.libs.app_rpc import app_rpc_route_available, call_app_rpc

originating_app: ContextVar[str | None] = ContextVar("sidebar_originating_app", default=None)
_logger = logging.getLogger(__name__)


async def als_route_available(method: str) -> bool:
    return await app_rpc_route_available("als-rs", "sidebar", method)


async def call_als(method: str, payload: dict[str, object]) -> dict[str, object]:
    result = await call_app_rpc("als-rs", "sidebar", method, payload, timeout=65)
    receipt = msgspec.convert(result, type=dict[str, object], strict=True)
    if receipt.get("ok") is not True:
        raise ValueError("ALS did not accept the Sidebar operation")
    return receipt


async def publish_als_fact(method: str, payload: dict[str, object]) -> bool:
    """Best-effort projection, never make a committed project action replayable.

    True means suppress ALS socket delivery, including an uncertain pipe result.
    ALS refreshes authoritative CWD on its next explicit startup/status read.
    """
    try:
        if not await als_route_available(method):
            return False
        await call_als(method, payload)
    except Exception as exc:
        _logger.warning("ALS Sidebar fact %s was not confirmed: %s", method, exc)
    return True
