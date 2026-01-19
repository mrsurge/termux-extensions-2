import socketio

from app.apps.file_editor_cm6.lsp_ws import LSPSocketIONamespace


def register(app):
    """Register dedicated LSP Socket.IO transport on the main server.

    This keeps LSP traffic off NiceGUI's Engine.IO endpoint to avoid transport
    interference and reconnect loops (mirrors the explorer_transport pattern).
    """

    lsp_sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
    lsp_sio.register_namespace(LSPSocketIONamespace("/lsp"))
    # Mirror explorer_transport: mount at a fixed socket.io endpoint and allow
    # the ASGI app to handle the engine.io path internally (socketio_path='').
    lsp_app = socketio.ASGIApp(lsp_sio, socketio_path="")
    app.mount("/lsp_ws/socket.io", lsp_app)
