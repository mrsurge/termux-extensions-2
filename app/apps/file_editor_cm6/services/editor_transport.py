import socketio

from app.apps.file_editor_cm6.editor_ws import EditorSocketIONamespace


def register(app):
    """Register dedicated Editor Socket.IO transport on the main server.

    This keeps editor traffic off NiceGUI's Engine.IO endpoint and gives us a
    stable bi-directional channel for SSOT sync + live edit mirroring.
    """

    editor_sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
    editor_sio.register_namespace(EditorSocketIONamespace("/editor"))
    editor_app = socketio.ASGIApp(editor_sio, socketio_path="")
    app.mount("/editor_ws/socket.io", editor_app)

