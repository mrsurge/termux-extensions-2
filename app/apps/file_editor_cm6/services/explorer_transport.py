import socketio
from fastapi import Body

from app.apps.file_editor_cm6.explorer_ws import (
    ExplorerSocketIONamespace,
    manager as _explorer_manager,
    notify_draft_state_changed,
)
# comment

def register(app):
    """Register dedicated Explorer Socket.IO transport on main server."""
    # This runs in the main server process to keep Explorer separate from NiceGUI.
    explorer_sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
    explorer_sio.register_namespace(ExplorerSocketIONamespace('/explorer'))
    # IMPORTANT:
    # Mount directly at '/explorer_ws/socket.io' and let the ASGI app handle the
    # engine.io path internally (socketio_path='').
    #
    # This avoids FastAPI/Starlette mount path rewriting quirks that can cause the
    # Engine.IO path match to miss and return 404, which breaks remote clients.
    explorer_app = socketio.ASGIApp(explorer_sio, socketio_path='')
    app.mount('/explorer_ws/socket.io', explorer_app)

    @app.post('/api/apps/file_editor_cm6/explorer/notify_drafts')
    async def _notify_drafts(payload: dict = Body(...)):
        """Allow worker processes to trigger explorer draft refreshes on main."""
        project = payload.get("project") if isinstance(payload, dict) else None
        if not project:
            return {"ok": False, "error": "missing project"}
        try:
            notify_draft_state_changed(project)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True}

    @app.post('/api/apps/file_editor_cm6/explorer/broadcast')
    async def _broadcast_event(payload: dict = Body(...)):
        """Forward worker explorer broadcasts to the main Socket.IO transport."""
        if not isinstance(payload, dict):
            return {"ok": False, "error": "invalid payload"}
        project = payload.get("project")
        message = payload.get("message")
        if not project or not isinstance(message, dict):
            return {"ok": False, "error": "missing project/message"}
        try:
            await _explorer_manager.broadcast(str(project), message)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True}
