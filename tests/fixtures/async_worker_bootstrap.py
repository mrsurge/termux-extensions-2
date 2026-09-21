"""Isolated worker fixture: prove the server loop progresses during import."""
# pyright: strict
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import os
from pathlib import Path
import threading

importing = threading.Event()
progressed = threading.Event()
owner: asyncio.AbstractEventLoop | None = None


def record(event: str) -> None:
    with Path(os.environ["TE2_TEST_BOOT_EVENTS"]).open("a") as stream:
        _ = stream.write(event + "\n")


@asynccontextmanager
async def te2_worker_bootstrap() -> AsyncIterator[None]:
    global owner
    owner = asyncio.get_running_loop()
    assert threading.current_thread() is threading.main_thread()
    record("bootstrap")

    async def advance() -> None:
        assert await asyncio.to_thread(importing.wait, 5)
        record("progress-during-import")
        progressed.set()

    task = asyncio.create_task(advance())
    try:
        yield
    finally:
        _ = task.cancel()
        _ = await asyncio.gather(task, return_exceptions=True)
        record("bootstrap-stop")
