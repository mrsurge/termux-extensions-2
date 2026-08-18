# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

import socketio

from app.apps.code_te2.socketio_runtime import set_code_te2_socketio_server

from app.apps.code_te2.explorer.transport.rpc_socketio import ExplorerRpcSocketIONamespace
from app.apps.code_te2.monaco_editor.editor_rpc_socketio import EditorRpcSocketIONamespace
from app.apps.code_te2.terminal_backend import TerminalSocketIONamespace, attach_terminal_socketio_server
from app.apps.code_te2.ui_ipc.ui_ipc_ws import UIIPCNamespace

CODE_TE2_SOCKETIO_MAX_HTTP_BUFFER_SIZE = 8 * 1024 * 1024

# One worker-owned Socket.IO server for the Python-owned Code TE2 namespaces.
# Its local AsyncManager delivers only to live participants; reconnect state is
# rebuilt by namespace connect handlers instead of a disconnected-session queue.
CODE_TE2_SIO = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    max_http_buffer_size=CODE_TE2_SOCKETIO_MAX_HTTP_BUFFER_SIZE,
)
set_code_te2_socketio_server(CODE_TE2_SIO)

CODE_TE2_SIO.register_namespace(EditorRpcSocketIONamespace("/rpc/editor"))  # pyright: ignore[reportUnknownMemberType]
CODE_TE2_SIO.register_namespace(ExplorerRpcSocketIONamespace("/rpc/explorer"))  # pyright: ignore[reportUnknownMemberType]
CODE_TE2_SIO.register_namespace(UIIPCNamespace("/ui_ipc"))  # pyright: ignore[reportUnknownMemberType]
CODE_TE2_SIO.register_namespace(UIIPCNamespace("/sidebar_ipc"))  # pyright: ignore[reportUnknownMemberType]
CODE_TE2_SIO.register_namespace(TerminalSocketIONamespace("/terminal"))  # pyright: ignore[reportUnknownMemberType]
attach_terminal_socketio_server(CODE_TE2_SIO)

CODE_TE2_ASGI_APP = socketio.ASGIApp(CODE_TE2_SIO, socketio_path="")
