# pyright: strict
"""Explicit ASGI export and native worker integration; no FastAPI imports."""
from __future__ import annotations

import json
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager, AsyncExitStack
from types import ModuleType
from typing import cast

from starlette.types import ASGIApp, Message, Receive, Scope, Send

EXPLICIT_ASGI_EXPORT = "TE2_ASGI_APP"


def explicit_asgi_application(module: ModuleType, app_id: str) -> ASGIApp | None:
    if EXPLICIT_ASGI_EXPORT not in module.__dict__:
        return None
    app = cast(object, module.__dict__[EXPLICIT_ASGI_EXPORT])
    if not callable(app):
        raise RuntimeError(f"Backend {app_id} exports TE2_ASGI_APP, but it is not callable")
    if "TE2_APP_ROUTER" in module.__dict__ or getattr(module, "SUBAPPS", None):
        raise RuntimeError("TE2_ASGI_APP owns its mounts; do not combine it with TE2_APP_ROUTER or SUBAPPS")
    return cast(ASGIApp, app)


class WorkerASGI:
    def __init__(
        self, app: ASGIApp, *,
        lifespan: Callable[[object], AbstractAsyncContextManager[None]],
        loop_probe: Callable[[], dict[str, object]],
    ) -> None:
        self.app: ASGIApp = app
        self.lifespan: Callable[[object], AbstractAsyncContextManager[None]] = lifespan
        self.loop_probe: Callable[[], dict[str, object]] = loop_probe

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self._lifespan(scope, receive, send)
        elif scope["type"] == "http" and scope["path"] == "/__te2/runtime/loop":
            # Reserve the same worker probe as the compatibility app. No app
            # routing dependency is required for this small infrastructure route.
            allowed = cast(object, scope["method"]) == "GET"
            payload = {"ok": True, "data": self.loop_probe()} if allowed else {"detail": "Method Not Allowed"}
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode("ascii"))]
            if not allowed:
                headers.append((b"allow", b"GET"))
            await send({"type": "http.response.start", "status": 200 if allowed else 405, "headers": headers})
            await send({"type": "http.response.body", "body": body})
        else:
            await self.app(scope, receive, send)

    async def _lifespan(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Native apps own ASGI startup/shutdown (including their composed mounts).
        # Bind worker diagnostics/readiness only after startup succeeds, and drain
        # them before app shutdown. Keep everything in the application's task.
        async with AsyncExitStack() as stack:
            started = False

            async def wrapped_send(message: Message) -> None:
                nonlocal started
                if message["type"] == "lifespan.startup.complete":
                    if started:
                        raise RuntimeError("ASGI application completed startup twice")
                    try:
                        _ = await stack.enter_async_context(self.lifespan(self))
                    except Exception as exc:
                        await send({"type": "lifespan.startup.failed", "message": str(exc)})
                        raise
                    started = True
                await send(message)

            async def wrapped_receive() -> Message:
                message = await receive()
                if message["type"] == "lifespan.shutdown":
                    try:
                        await stack.aclose()
                    except Exception as exc:
                        await send({"type": "lifespan.shutdown.failed", "message": str(exc)})
                        raise
                return message

            await self.app(scope, wrapped_receive, wrapped_send)
