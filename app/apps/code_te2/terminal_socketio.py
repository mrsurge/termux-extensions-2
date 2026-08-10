# pyright: strict
from __future__ import annotations

from app.apps.code_te2.socketio_gateway import CODE_TE2_ASGI_APP, CODE_TE2_SIO

# Import-compatible aliases for existing terminal emitters/import sites.
TERMINAL_SIO = CODE_TE2_SIO
TERMINAL_ASGI_APP = CODE_TE2_ASGI_APP

__all__ = ["TERMINAL_SIO", "TERMINAL_ASGI_APP"]
