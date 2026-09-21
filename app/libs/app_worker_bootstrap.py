"""Explicit opt-in preparation; lifecycle/transport stay on the server loop."""
# pyright: strict
from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from importlib import import_module
from typing import TypeVar, cast

T = TypeVar("T")


def bootstrap_context(module_name: str) -> AbstractAsyncContextManager[None]:
    module = import_module(module_name)
    hook: object = getattr(module, "te2_worker_bootstrap", None)
    if not callable(hook):
        raise TypeError(f"{module_name} must export te2_worker_bootstrap")
    return cast(Callable[[], AbstractAsyncContextManager[None]], hook)()


async def assemble_off_loop(assemble: Callable[[], T]) -> T:
    # Only import/assembly runs in this thread. Hooks, sockets and shell readers
    # never do. Python cannot cancel an import thread: join it before teardown so
    # a late import cannot mutate worker globals after bootstrap cleanup.
    task = asyncio.create_task(asyncio.to_thread(assemble), name="app_worker_assembly")
    try:
        return await asyncio.shield(task)
    finally:
        if not task.done():
            _ = await asyncio.gather(task, return_exceptions=True)
