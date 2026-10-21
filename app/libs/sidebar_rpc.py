"""Compatibility call surface for backend Sidebar facts, now pipe-brokered."""
from __future__ import annotations

from typing import cast

from .app_rpc import call_app_rpc


async def call_sidebar_rpc(app_id: str, method: str, params: dict[str, object], *, timeout: float = 5) -> dict[str, object]:
    if not app_id.strip() or method not in {"sidebar.cwd.get", "sidebar.window.state.update"}:
        raise ValueError("Unsupported backend Sidebar method")
    # app_id is diagnostic only. The broker derives identity from the owned pipe.
    # Its fifteen-second deadline must expire before the outer caller's budget.
    result = await call_app_rpc("code_te2", "sidebar", method.removeprefix("sidebar."),
                                params, timeout=max(20, timeout))
    if not isinstance(result, dict) or not all(isinstance(key, str) for key in result):
        raise ValueError("Sidebar service result must be an object")
    return cast(dict[str, object], result)
