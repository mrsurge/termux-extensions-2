import socketio

from .ui_ipc_ws import UIIPCNamespace

# Worker-owned Socket.IO server for UI IPC (frontend-to-frontend relay).
# The main framework process proxies /ui_ipc_ws/socket.io to this worker endpoint.
UI_IPC_SIO = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
UI_IPC_SIO.register_namespace(UIIPCNamespace("/ui_ipc"))
UI_IPC_SIO.register_namespace(UIIPCNamespace("/sidebar_ipc"))

# Mount this ASGI app at '/ui_ipc_ws/socket.io' inside the app worker.
UI_IPC_ASGI_APP = socketio.ASGIApp(UI_IPC_SIO, socketio_path="")
