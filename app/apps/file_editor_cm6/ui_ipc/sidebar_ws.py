"""Sidebar IPC handlers for the dedicated /sidebar_ipc Socket.IO namespace.

This channel is intentionally separate from /ui_ipc to keep sidebar orchestration
traffic isolated from editor/console chatter.
"""

import time
from pathlib import Path

from ..explorer_helper import get_project_root
from ..explorer_ws import manager as _explorer_manager
from ..stores import get_history_store

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
    if event_type == "agent_edit":
        payload = data.get("payload")
        if isinstance(payload, dict):
            try:
                await _broadcast_agent_open(payload)
            except Exception as exc:
                print(f"[sidebar_ipc] sidebar:event agent_edit route failed: {exc}", flush=True)
        return
    await ns.emit("sidebar:event", data, room="sidebar_ipc", skip_sid=sid)


async def _broadcast_agent_open(data: dict) -> None:
    history = get_history_store()
    project = history.get_active_project() or str(get_project_root())
    if not project:
        raise ValueError("no active project")

    project_root = Path(project).expanduser().resolve(strict=False)
    raw_path = (
        str(
            data.get("path")
            or data.get("abs")
            or data.get("file")
            or data.get("rel")
            or ""
        )
        .strip()
    )
    if not raw_path:
        raise ValueError("missing path")

    if raw_path.startswith("/"):
        target = Path(raw_path).expanduser().resolve(strict=False)
    else:
        target = (project_root / raw_path.lstrip("/")).expanduser().resolve(strict=False)

    try:
        rel = str(target.relative_to(project_root))
    except Exception as exc:
        raise PermissionError("path is outside active project root") from exc

    if not target.exists():
        raise FileNotFoundError("target does not exist")
    if target.is_dir():
        raise IsADirectoryError("target is a directory")

    try:
        line = int(data.get("line"))
    except Exception:
        line = 1
    if line < 1:
        line = 1

    message = {
        "type": "agent:open",
        "payload": {
            "rel": rel,
            "path": str(target),
            "line": line,
            "column": data.get("column"),
            "source": data.get("source") or "sidebar_ipc",
            "conversation_id": data.get("conversation_id"),
        },
    }
    await _explorer_manager.broadcast(str(project_root), message)


async def on_sidebar_agent_edit(ns, sid, data):
    """Route agent-edit signals through backend explorer broadcast path."""
    if not isinstance(data, dict):
        return
    print(f"[sidebar_ipc] agent_edit from={sid}", flush=True)
    try:
        await _broadcast_agent_open(data)
    except Exception as exc:
        print(f"[sidebar_ipc] agent_edit route failed: {exc}", flush=True)
