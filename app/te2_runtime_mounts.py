from __future__ import annotations

from starlette.applications import Starlette
from app.te2_console_runtime import TE2_CONSOLE_ASGI_APP, TE2_CONSOLE_SOCKET_PATH


def mount_te2_runtime_services(app: Starlette) -> None:
    """Mount the existing Python console relay; MCP is exclusively Rust-owned."""

    app.mount(TE2_CONSOLE_SOCKET_PATH, TE2_CONSOLE_ASGI_APP)
