# pyright: strict
from __future__ import annotations

from app.apps.code_te2.socketio_gateway import (
    CODE_TE2_ASGI_APP,
    CODE_TE2_SIO,
    CODE_TE2_SOCKETIO_MAX_HTTP_BUFFER_SIZE,
)

# Import-compatible aliases for existing UI IPC/sidebar emitters/import sites.
UI_IPC_MAX_HTTP_BUFFER_SIZE = CODE_TE2_SOCKETIO_MAX_HTTP_BUFFER_SIZE
UI_IPC_SIO = CODE_TE2_SIO
UI_IPC_ASGI_APP = CODE_TE2_ASGI_APP

__all__ = ["UI_IPC_MAX_HTTP_BUFFER_SIZE", "UI_IPC_SIO", "UI_IPC_ASGI_APP"]
