"""Synthetic owned loop: no TE2 imports, sockets, files or live activation."""
from __future__ import annotations

import asyncio
import contextvars
import threading
from concurrent.futures import Future

request_context: contextvars.ContextVar[str] = contextvars.ContextVar("probe", default="unset")
loop: asyncio.AbstractEventLoop
thread: threading.Thread
started = 0
finished = 0
cancelled = 0


def start(use_uvloop: bool) -> asyncio.AbstractEventLoop:
    global loop, thread, started, finished, cancelled
    started = finished = cancelled = 0
    ready = threading.Event()

    def own_loop() -> None:
        global loop
        if use_uvloop:
            import uvloop
            loop = uvloop.new_event_loop()
        else:
            loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        ready.set()
        loop.run_forever()
        loop.close()

    thread = threading.Thread(target=own_loop, name="probe-domain")
    thread.start()
    if not ready.wait(5):
        raise RuntimeError("loop startup timeout")
    return loop


async def operation(delay: float, fail: bool) -> tuple[str, bool]:
    global started, finished, cancelled
    started += 1
    try:
        await asyncio.sleep(delay)
        if fail:
            raise ValueError("synthetic failure")
        return request_context.get(), asyncio.get_running_loop() is loop
    except asyncio.CancelledError:
        cancelled += 1
        raise
    finally:
        finished += 1


def submit(delay: float, fail: bool) -> Future[tuple[str, bool]]:
    # Explicit request context, identically on both candidate paths. Python
    # context is not inherited automatically by arbitrary Rust pool threads.
    token = request_context.set("probe-context")
    try:
        return asyncio.run_coroutine_threadsafe(operation(delay, fail), loop)
    finally:
        request_context.reset(token)


async def adapt(future: Future[tuple[str, bool]]) -> tuple[str, bool]:
    if request_context.get() != "probe-context":
        raise RuntimeError("TaskLocals context was not restored")
    # Shield is intentional: dropping a Rust waiter must not cancel accepted work.
    return await asyncio.shield(asyncio.wrap_future(future, loop=loop))


def stats() -> tuple[int, int, int]:
    return started, finished, cancelled


def stop() -> None:
    if loop.is_closed():
        return
    async def drain() -> None:
        tasks = [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    asyncio.run_coroutine_threadsafe(drain(), loop).result(5)
    loop.call_soon_threadsafe(loop.stop)
    thread.join(5)
    if thread.is_alive():
        raise RuntimeError("loop shutdown timeout")
