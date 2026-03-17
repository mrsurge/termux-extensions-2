import socketio

from .terminal_backend import TerminalSocketIONamespace, attach_terminal_socketio_server

# Worker-owned Socket.IO server for the terminal drawer/runtime.
TERMINAL_SIO = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
TERMINAL_SIO.register_namespace(TerminalSocketIONamespace("/terminal"))
attach_terminal_socketio_server(TERMINAL_SIO)

# Mount this ASGI app at '/terminal_ws/socket.io' inside the app worker.
TERMINAL_ASGI_APP = socketio.ASGIApp(TERMINAL_SIO, socketio_path="")
