"""Transport-independent application lifetime, owned by the worker runner."""
# pyright: strict
from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from types import ModuleType
from typing import cast

AsyncHook = Callable[[], Awaitable[None]]


@asynccontextmanager
async def application_lifecycle(module: ModuleType) -> AsyncIterator[None]:
    """Optional paired hooks; unwind partial startup before reporting failure."""
    start: object = getattr(module, "te2_app_start", None)
    stop: object = getattr(module, "te2_app_stop", None)
    if start is None and stop is None:
        yield
        return
    if not callable(start) or not callable(stop):
        raise TypeError("App lifecycle requires paired async te2_app_start/te2_app_stop hooks")
    try:
        await cast(AsyncHook, start)()
        yield
    finally:
        await cast(AsyncHook, stop)()
