"""Sidebar IPC handlers for the dedicated /sidebar_ipc Socket.IO namespace.

This channel is intentionally separate from /ui_ipc to keep sidebar orchestration
traffic isolated from editor/console chatter.
"""

import time

_registered_hosts: set[str] = set()
_registered_iframes: set[str] = set()


async def _emit_presence(ns, *, to_sid: str | None = None):
    payload = {
        "hosts": len(_registered_hosts),
        "iframes": len(_registered_iframes),
    }
    if to_sid:
        await ns.emit("sidebar:presence", payload, to=to_sid)
    else:
        await ns.emit("sidebar:presence", payload, room="sidebar_ipc")


async def on_sidebar_register(ns, sid, data):
    if not isinstance(data, dict):
        data = {}
    role = str(data.get("role") or "host").strip().lower()
    if role not in {"host", "iframe"}:
        role = "host"

    await ns.enter_room(sid, "sidebar_ipc")
    await ns.save_session(sid, {"sidebarRole": role})

    if role == "iframe":
        _registered_iframes.add(sid)
        await ns.enter_room(sid, "sidebar:iframes")
    else:
        _registered_hosts.add(sid)
        await ns.enter_room(sid, "sidebar:hosts")

    print(
        f"[sidebar_ipc] register sid={sid} role={role} ts={int(time.time() * 1000)}",
        flush=True,
    )
    await _emit_presence(ns)


async def on_sidebar_disconnect(ns, sid):
    removed = False
    if sid in _registered_hosts:
        _registered_hosts.discard(sid)
        removed = True
    if sid in _registered_iframes:
        _registered_iframes.discard(sid)
        removed = True
    if removed:
        await _emit_presence(ns)


async def on_sidebar_event(ns, sid, data):
    """Generic relay for sidebar-scoped events."""
    if not isinstance(data, dict):
        return
    event_type = str(data.get("type") or "unknown")
    print(f"[sidebar_ipc] event type={event_type} from={sid}", flush=True)
    await ns.emit("sidebar:event", data, room="sidebar_ipc", skip_sid=sid)


async def on_sidebar_agent_edit(ns, sid, data):
    """Forward agent-edit signals to host pages only."""
    if not isinstance(data, dict):
        return
    print(f"[sidebar_ipc] agent_edit from={sid}", flush=True)
    await ns.emit("sidebar:agent_edit", data, room="sidebar:hosts")

