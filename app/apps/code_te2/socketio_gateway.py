# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

from app.apps.code_te2.native_socketio import NativeSocketServer

from app.apps.code_te2.socketio_runtime import set_code_te2_socketio_server

from app.apps.code_te2.explorer.transport.rpc_socketio import ExplorerRpcSocketIONamespace
from app.apps.code_te2.monaco_editor.editor_rpc_socketio import EditorRpcSocketIONamespace
from app.apps.code_te2.terminal_backend import TerminalSocketIONamespace, attach_terminal_socketio_server
from app.apps.code_te2.ui_ipc.ui_ipc_ws import UIIPCNamespace

CODE_TE2_SOCKETIO_MAX_HTTP_BUFFER_SIZE = 8 * 1024 * 1024

# One domain adapter for the Rust Socketioxide gateway. Rust owns live sockets
# and rooms; namespace connect handlers reconstruct reconnect state.
CODE_TE2_SIO = NativeSocketServer()
set_code_te2_socketio_server(CODE_TE2_SIO)

CODE_TE2_SIO.register_namespace(EditorRpcSocketIONamespace("/rpc/editor"))  # pyright: ignore[reportUnknownMemberType]
CODE_TE2_SIO.register_namespace(ExplorerRpcSocketIONamespace("/rpc/explorer"))  # pyright: ignore[reportUnknownMemberType]
CODE_TE2_SIO.register_namespace(UIIPCNamespace("/ui_ipc"))  # pyright: ignore[reportUnknownMemberType]
CODE_TE2_SIO.register_namespace(UIIPCNamespace("/sidebar_ipc"))  # pyright: ignore[reportUnknownMemberType]
CODE_TE2_SIO.register_namespace(TerminalSocketIONamespace("/terminal"))  # pyright: ignore[reportUnknownMemberType]
attach_terminal_socketio_server(CODE_TE2_SIO)  # type: ignore[arg-type]
