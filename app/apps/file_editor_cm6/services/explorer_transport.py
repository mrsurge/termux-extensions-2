import socketio

from app.apps.file_editor_cm6.explorer_ws import ExplorerSocketIONamespace


def register(app):
    """Register dedicated Explorer Socket.IO transport on main server."""
    # This runs in the main server process to keep Explorer separate from NiceGUI.
    explorer_sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
    explorer_sio.register_namespace(ExplorerSocketIONamespace('/explorer'))
    explorer_app = socketio.ASGIApp(explorer_sio, socketio_path='')
    app.mount('/explorer_ws/socket.io', explorer_app)
