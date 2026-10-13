from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from contextlib import AbstractAsyncContextManager, AsyncExitStack, asynccontextmanager
from typing import TypeAlias, cast

from starlette.applications import Starlette
from fastmcp.server.http import StarletteWithLifespan
from app.te2_mcp.server import (
    build_http_app,
    build_streamable_http_app,
)
from app.te2_console_runtime import TE2_CONSOLE_ASGI_APP, TE2_CONSOLE_SOCKET_PATH


LifespanContextFactory: TypeAlias = Callable[
    [StarletteWithLifespan],
    AbstractAsyncContextManager[object, bool | None],
]


TE2_MCP_ASGI_APP: StarletteWithLifespan = build_http_app()
TE2_MCP_STREAMABLE_HTTP_ASGI_APP: StarletteWithLifespan = build_streamable_http_app()


def mount_te2_runtime_services(app: Starlette) -> None:
    """Mount TE2 runtime-owned console and MCP transports."""

    app.mount(TE2_CONSOLE_SOCKET_PATH, TE2_CONSOLE_ASGI_APP)
    app.mount("/te2_mcp", TE2_MCP_ASGI_APP)
    app.mount("/te2_mcp_http", TE2_MCP_STREAMABLE_HTTP_ASGI_APP)


@asynccontextmanager
async def te2_runtime_lifespan(_app: object | None = None) -> AsyncGenerator[None]:
    """Run lifespan hooks for mounted TE2 runtime-owned ASGI apps."""

    async with AsyncExitStack() as stack:
        for child_app in (TE2_MCP_ASGI_APP, TE2_MCP_STREAMABLE_HTTP_ASGI_APP):
            child_lifespan = cast(LifespanContextFactory, child_app.lifespan)
            _ = await stack.enter_async_context(child_lifespan(child_app))
        yield
