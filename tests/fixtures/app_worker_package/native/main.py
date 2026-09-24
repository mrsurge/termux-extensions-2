# pyright: strict
from __future__ import annotations

import asyncio
from http.client import HTTPResponse
import json
import os
from pathlib import Path
import sys
from typing import cast
from urllib import request as urllib_request

from starlette.types import Scope, Receive, Send

_started = False


def record(event: str) -> None:
    path = os.environ.get("TE2_TEST_NATIVE_EVENTS")
    if path:
        with Path(path).open("a", encoding="utf-8") as stream:
            _ = stream.write(event + "\n")


async def te2_app_start() -> None:
    global _started
    _started = True
    record("worker.start")


async def te2_app_stop() -> None:
    record("worker.stop")


async def te2_app_backend_serving() -> None:
    probe_url = os.environ.get("TE2_TEST_NATIVE_SERVING_PROBE_URL")
    if probe_url:
        def probe_listener() -> None:
            with cast(
                HTTPResponse,
                urllib_request.urlopen(probe_url, timeout=2),
            ) as response:
                if response.status != 200:
                    raise RuntimeError(f"listener probe returned {response.status}")

        await asyncio.to_thread(probe_listener)
    record("worker.serving")


async def TE2_ASGI_APP(scope: Scope, receive: Receive, send: Send) -> None:
    assert _started, "application must start before ASGI lifespan/requests"
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                record("asgi.start")
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                record("asgi.stop")
                await send({"type": "lifespan.shutdown.complete"})
                return
    elif scope["type"] == "websocket":
        _ = await receive()
        await send({"type": "websocket.accept"})
        await send({"type": "websocket.send", "text": "native websocket"})
        await send({"type": "websocket.close", "code": 1000})
    else:
        body = json.dumps({
            "path": cast(object, scope["path"]),
            "blocked_imports_absent": not any(
                name.split(".")[0] in {"fastapi", "pydantic", "pydantic_core"} for name in sys.modules
            ),
        }).encode()
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": body})
