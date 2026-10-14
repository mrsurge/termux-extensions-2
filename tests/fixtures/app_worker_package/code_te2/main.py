from __future__ import annotations

import os
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


_started = False


async def te2_app_start() -> None:
    global _started
    _started = True


async def te2_app_stop() -> None:
    path = os.environ.get("TE2_TEST_LIFECYCLE_STOP_FILE")
    if path:
        _ = Path(path).write_text("stopped", encoding="utf-8")


async def identity(_request: Request) -> JSONResponse:
    assert _started, "transport served before application startup"
    return JSONResponse({
        "app_id": str(os.environ.get("TE_APP_ID") or ""),
        "module": __name__,
    })


TE2_ASGI_APP = Starlette(routes=[Route("/identity", identity)])
