# pyright: strict
from __future__ import annotations

from app.apps.file_editor_cm6.socketio_gateway import FILE_EDITOR_CM6_ASGI_APP, FILE_EDITOR_CM6_SIO

# Import-compatible aliases for existing terminal emitters/import sites.
TERMINAL_SIO = FILE_EDITOR_CM6_SIO
TERMINAL_ASGI_APP = FILE_EDITOR_CM6_ASGI_APP

__all__ = ["TERMINAL_SIO", "TERMINAL_ASGI_APP"]
