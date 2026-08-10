# pyright: strict
from __future__ import annotations

from app.apps.code_te2.socketio_gateway import CODE_TE2_ASGI_APP, CODE_TE2_SIO

# Import-compatible aliases for existing editor-owned emitters/import sites.
EDITOR_SIO = CODE_TE2_SIO
EDITOR_ASGI_APP = CODE_TE2_ASGI_APP

__all__ = ["EDITOR_SIO", "EDITOR_ASGI_APP"]
