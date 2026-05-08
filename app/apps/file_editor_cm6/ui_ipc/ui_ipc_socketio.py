# pyright: strict
from __future__ import annotations

from app.apps.file_editor_cm6.socketio_gateway import (
    FILE_EDITOR_CM6_ASGI_APP,
    FILE_EDITOR_CM6_SIO,
    FILE_EDITOR_CM6_SOCKETIO_MAX_HTTP_BUFFER_SIZE,
)

# Import-compatible aliases for existing UI IPC/sidebar emitters/import sites.
UI_IPC_MAX_HTTP_BUFFER_SIZE = FILE_EDITOR_CM6_SOCKETIO_MAX_HTTP_BUFFER_SIZE
UI_IPC_SIO = FILE_EDITOR_CM6_SIO
UI_IPC_ASGI_APP = FILE_EDITOR_CM6_ASGI_APP

__all__ = ["UI_IPC_MAX_HTTP_BUFFER_SIZE", "UI_IPC_SIO", "UI_IPC_ASGI_APP"]
