# pyright: strict
from __future__ import annotations

from app.apps.code_te2.socketio_gateway import CODE_TE2_ASGI_APP, CODE_TE2_SIO

# Import-compatible aliases for existing Explorer-owned emitters/import sites.
EXPLORER_SIO = CODE_TE2_SIO
EXPLORER_ASGI_APP = CODE_TE2_ASGI_APP

__all__ = ["EXPLORER_SIO", "EXPLORER_ASGI_APP"]
