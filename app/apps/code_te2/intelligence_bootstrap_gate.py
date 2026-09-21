"""Loop-owned application attachment gate, independent of app/transport imports."""
# pyright: strict
from __future__ import annotations

import asyncio

_ready: asyncio.Event | None = None


def hold_application() -> None:
    global _ready
    if _ready is not None:
        raise RuntimeError("Intelligence bootstrap is already active")
    _ready = asyncio.Event()


def release_application() -> None:
    if _ready is not None:
        _ready.set()


def reset_application() -> None:
    global _ready
    _ready = None


def application_is_ready() -> bool:
    return _ready is None or _ready.is_set()


async def wait_for_application() -> None:
    ready = _ready
    if ready is not None:
        _ = await ready.wait()
