import socketio

from .terminal_socketio_state import TerminalSocketIONamespace, attach_terminal_socketio_server

TERMINAL_SIO = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
TERMINAL_SIO.register_namespace(TerminalSocketIONamespace("/terminal"))
attach_terminal_socketio_server(TERMINAL_SIO)

TERMINAL_ASGI_APP = socketio.ASGIApp(TERMINAL_SIO, socketio_path="")
