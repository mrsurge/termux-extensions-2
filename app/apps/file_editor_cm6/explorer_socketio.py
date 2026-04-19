import socketio

from app.apps.file_editor_cm6.explorer_rpc_socketio import ExplorerRpcSocketIONamespace
from app.apps.file_editor_cm6.explorer_ws import ExplorerSocketIONamespace

# Worker-owned Socket.IO server for the Explorer runtime.
# The main framework process only proxies the websocket connection.
EXPLORER_SIO = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
EXPLORER_SIO.register_namespace(ExplorerSocketIONamespace("/explorer"))
EXPLORER_SIO.register_namespace(ExplorerRpcSocketIONamespace("/rpc/explorer"))

# Mount this ASGI app at '/explorer_ws/socket.io' inside the app worker.
EXPLORER_ASGI_APP = socketio.ASGIApp(EXPLORER_SIO, socketio_path="")
