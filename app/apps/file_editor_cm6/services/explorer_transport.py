import socketio
from fastapi import Body

from app.apps.file_editor_cm6.explorer_ws import (
    ExplorerSocketIONamespace,
    notify_draft_state_changed,
)


def register(app):
    """Register dedicated Explorer Socket.IO transport on main server."""
    # This runs in the main server process to keep Explorer separate from NiceGUI.
    explorer_sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
    explorer_sio.register_namespace(ExplorerSocketIONamespace('/explorer'))
    explorer_app = socketio.ASGIApp(explorer_sio, socketio_path='')
    app.mount('/explorer_ws/socket.io', explorer_app)

    @app.post('/api/app/file_editor_cm6/explorer/notify_drafts')
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
