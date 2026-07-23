# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

import socketio

from app.apps.file_editor_cm6.explorer.transport.rpc_socketio import ExplorerRpcSocketIONamespace
from app.apps.file_editor_cm6.monaco_editor.editor_rpc_socketio import EditorRpcSocketIONamespace
from app.apps.file_editor_cm6.terminal_backend import TerminalSocketIONamespace, attach_terminal_socketio_server
from app.apps.file_editor_cm6.ui_ipc.ui_ipc_ws import UIIPCNamespace

FILE_EDITOR_CM6_SOCKETIO_MAX_HTTP_BUFFER_SIZE = 8 * 1024 * 1024

# One worker-owned Socket.IO server for the Python-owned Code TE2 namespaces.
# Its local AsyncManager delivers only to live participants; reconnect state is
# rebuilt by namespace connect handlers instead of a disconnected-session queue.
FILE_EDITOR_CM6_SIO = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    max_http_buffer_size=FILE_EDITOR_CM6_SOCKETIO_MAX_HTTP_BUFFER_SIZE,
)

FILE_EDITOR_CM6_SIO.register_namespace(EditorRpcSocketIONamespace("/rpc/editor"))  # pyright: ignore[reportUnknownMemberType]
FILE_EDITOR_CM6_SIO.register_namespace(ExplorerRpcSocketIONamespace("/rpc/explorer"))  # pyright: ignore[reportUnknownMemberType]
FILE_EDITOR_CM6_SIO.register_namespace(UIIPCNamespace("/ui_ipc"))  # pyright: ignore[reportUnknownMemberType]
FILE_EDITOR_CM6_SIO.register_namespace(UIIPCNamespace("/sidebar_ipc"))  # pyright: ignore[reportUnknownMemberType]
FILE_EDITOR_CM6_SIO.register_namespace(TerminalSocketIONamespace("/terminal"))  # pyright: ignore[reportUnknownMemberType]
attach_terminal_socketio_server(FILE_EDITOR_CM6_SIO)

FILE_EDITOR_CM6_ASGI_APP = socketio.ASGIApp(FILE_EDITOR_CM6_SIO, socketio_path="")
