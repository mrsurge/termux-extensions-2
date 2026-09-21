# pyright: strict
from __future__ import annotations

import asyncio
import os
import threading
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from tests.fixtures import async_worker_bootstrap as boot

assert threading.current_thread() is not threading.main_thread()
boot.importing.set()
assert boot.progressed.wait(5), "Worker loop blocked during backend import"
boot.record("import-complete")
if os.environ.get("TE2_TEST_IMPORT_FAILURE"):
    raise RuntimeError("fixture import failed")

started = False


async def te2_app_start() -> None:
    global started
    assert asyncio.get_running_loop() is boot.owner
    assert threading.current_thread() is threading.main_thread()
    boot.record("start")
    started = True


async def te2_app_stop() -> None:
    assert asyncio.get_running_loop() is boot.owner
    boot.record("stop")


async def status(_request: Request) -> JSONResponse:
    assert asyncio.get_running_loop() is boot.owner
    assert started
    return JSONResponse({"ok": True})


TE2_ASGI_APP = Starlette(routes=[Route("/status", status)])
