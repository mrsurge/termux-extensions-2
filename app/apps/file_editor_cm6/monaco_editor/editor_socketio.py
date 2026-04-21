import socketio

from app.apps.file_editor_cm6.monaco_editor.editor_rpc_socketio import EditorRpcSocketIONamespace
from app.apps.file_editor_cm6.monaco_editor.editor_ws import EditorSocketIONamespace

# Worker-owned Socket.IO server for the Monaco editor runtime.
# The main framework process only proxies the websocket connection.
EDITOR_SIO = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
EDITOR_SIO.register_namespace(EditorSocketIONamespace("/editor"))
EDITOR_SIO.register_namespace(EditorRpcSocketIONamespace("/rpc/editor"))

# Mount this ASGI app at '/editor_ws/socket.io' inside the app worker.
EDITOR_ASGI_APP = socketio.ASGIApp(EDITOR_SIO, socketio_path="")
