"""UI IPC Socket.IO namespace — thin relay for frontend-to-frontend communication.

Both the main page (main.js) and the editor iframe (m_editor_app.js) connect
to the ``/ui_ipc`` namespace.  Events are rebroadcast to all other clients in
the room so the two pages can communicate without Python business logic.

Python only logs traffic for observability.

Console events (``console:*``) are delegated to ``console_ws`` handlers.
Sidebar events (``sidebar:*``) are delegated to ``sidebar_ws`` handlers.
"""

import socketio
import time

from . import console_ws
from . import sidebar_ws


class UIIPCNamespace(socketio.AsyncNamespace):

    # python-socketio dispatches via 'on_' + event_name, but colons in
    # event names (e.g. 'console:log') produce 'on_console:log' which
    # can't be a Python method name.  Translate colons to underscores.
    async def trigger_event(self, event, *args):
        normalized = event.replace(':', '_') if event else event
        handler_name = 'on_' + (normalized or '')
        handler = getattr(self, handler_name, None)
        if handler:
            return await handler(*args)
        return await super().trigger_event(event, *args)

    async def on_connect(self, sid, environ):
        room = "sidebar_ipc" if self.namespace == "/sidebar_ipc" else "ui_ipc"
        await self.enter_room(sid, room)
        print(f"[{room}] connect sid={sid}", flush=True)

    async def on_disconnect(self, sid, reason=None):
        room = "sidebar_ipc" if self.namespace == "/sidebar_ipc" else "ui_ipc"
        print(f"[{room}] disconnect sid={sid} reason={reason}", flush=True)
        if self.namespace == "/ui_ipc":
            await console_ws.on_console_disconnect(self, sid)
        await sidebar_ws.on_sidebar_disconnect(self, sid)

    async def on_ui_event(self, sid, data):
        """Generic UI event relay.

        Clients send ``{type: "focus"|"save"|"menuClose"|..., ...}``.
        The server logs and rebroadcasts to all other clients in the room.
        """
        event_type = data.get("type", "unknown") if isinstance(data, dict) else "unknown"
        print(f"[ui_ipc] {event_type} from={sid} ts={int(time.time()*1000)}", flush=True)
        # Broadcast to everyone else in the room (skip sender)
        await self.emit("ui_event", data, room="ui_ipc", skip_sid=sid)

    # ─── Console event delegation ──────────────────────────────

    async def on_console_register(self, sid, data):
        await console_ws.on_console_register(self, sid, data)

    async def on_console_log(self, sid, data):
        await console_ws.on_console_log(self, sid, data)

    async def on_console_eval(self, sid, data):
        await console_ws.on_console_eval(self, sid, data)

    async def on_console_evalResult(self, sid, data):
        await console_ws.on_console_eval_result(self, sid, data)

    async def on_console_replay(self, sid, data):
        await console_ws.on_console_replay(self, sid, data)

    async def on_console_clear(self, sid, data):
        await console_ws.on_console_clear(self, sid, data)

    # ─── Sidebar event delegation ──────────────────────────────

    async def on_sidebar_register(self, sid, data):
        await sidebar_ws.on_sidebar_register(self, sid, data)

    async def on_sidebar_event(self, sid, data):
        await sidebar_ws.on_sidebar_event(self, sid, data)

    async def on_sidebar_agent_edit(self, sid, data):
        await sidebar_ws.on_sidebar_agent_edit(self, sid, data)
