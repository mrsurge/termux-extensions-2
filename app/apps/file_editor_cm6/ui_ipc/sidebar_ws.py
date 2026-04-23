"""Sidebar IPC handlers for the dedicated /sidebar_ipc Socket.IO namespace.

This channel is intentionally separate from /ui_ipc to keep sidebar orchestration
traffic isolated from editor/console chatter.
"""

import time

from ..stores import get_preferences_store

_registered_hosts: set[str] = set()
_registered_iframes: set[str] = set()
_client_ids_by_sid: dict[str, str] = {}
_client_active_shortcuts: dict[str, str] = {}


def _is_agent_sidebar_tracking_enabled() -> bool:
    try:
        prefs = get_preferences_store().get_preferences()
        editor = prefs.get("editor") if isinstance(prefs, dict) else {}
        if not isinstance(editor, dict):
            return False
        return bool(editor.get("trackAgentSidebarEdits", False))
    except Exception:
        return False


def _payload_preview(payload: dict | None) -> dict:
    if not isinstance(payload, dict):
        return {}
    return {
        "path": payload.get("path"),
        "abs": payload.get("abs"),
        "rel": payload.get("rel"),
        "line": payload.get("line"),
        "column": payload.get("column"),
        "source": payload.get("source"),
        "conversation_id": payload.get("conversation_id"),
    }


def _norm(value) -> str:
    return str(value or "").strip()


def _client_room(client_id: str) -> str:
    return f"sidebar:client:{_norm(client_id) or 'unknown'}"


def _client_state_payload(client_id: str) -> dict:
    safe_client_id = _norm(client_id)
    return {
        "client_id": safe_client_id,
        "activeShortcutId": _norm(_client_active_shortcuts.get(safe_client_id)),
        "ts": int(time.time() * 1000),
    }


async def _emit_client_state(ns, client_id: str, *, to_sid: str | None = None, skip_sid: str | None = None):
    payload = {
        "type": "client_state",
        "payload": _client_state_payload(client_id),
    }
    if to_sid:
        await ns.emit("sidebar:event", payload, to=to_sid)
        return
    await ns.emit("sidebar:event", payload, room=_client_room(client_id), skip_sid=skip_sid)


async def _resolve_client_id(ns, sid: str, payload: dict | None = None) -> str:
    candidate = _norm(payload.get("client_id")) if isinstance(payload, dict) else ""
    if candidate:
        return candidate
    cached = _norm(_client_ids_by_sid.get(sid))
    if cached:
        return cached
    try:
        session = await ns.get_session(sid)
    except Exception:
        session = {}
    if isinstance(session, dict):
        candidate = _norm(session.get("clientId"))
        if candidate:
            return candidate
    return sid


async def _emit_presence(ns, *, to_sid: str | None = None):
    payload = {
        "hosts": len(_registered_hosts),
        "iframes": len(_registered_iframes),
    }
    if to_sid:
        await ns.emit("sidebar:presence", payload, to=to_sid)
    else:
        await ns.emit("sidebar:presence", payload, room="sidebar_ipc")


def _current_cwd() -> str:
    history = get_history_store()
    cwd = history.get_active_project() or str(get_project_root())
    return str(cwd or "").strip()


def _cwd_payload(reason: str = "sync") -> dict:
    return {
        "cwd": _current_cwd(),
        "reason": str(reason or "sync"),
        "ts": int(time.time() * 1000),
    }


async def emit_sidebar_cwd_set(ns, *, to_sid: str | None = None, reason: str = "sync") -> None:
    payload = _cwd_payload(reason)
    if to_sid:
        await ns.emit("sidebar:cwd_set", payload, to=to_sid)
    else:
        await ns.emit("sidebar:cwd_set", payload, room="sidebar_ipc")
    print(
        f"[sidebar_ipc] cwd_set reason={payload.get('reason')} cwd={payload.get('cwd') or ''} to={to_sid or 'room'}",
        flush=True,
    )


async def emit_sidebar_cwd_set_global(*, reason: str = "sync") -> None:
    from .ui_ipc_socketio import UI_IPC_SIO

    payload = _cwd_payload(reason)
    await UI_IPC_SIO.emit("sidebar:cwd_set", payload, namespace="/sidebar_ipc", room="sidebar_ipc")
    print(
        f"[sidebar_ipc] cwd_set(global) reason={payload.get('reason')} cwd={payload.get('cwd') or ''}",
        flush=True,
    )


async def on_sidebar_register(ns, sid, data):
    if not isinstance(data, dict):
        data = {}
    role = str(data.get("role") or "host").strip().lower()
    if role not in {"host", "iframe"}:
        role = "host"
    client_id = _norm(data.get("client_id")) or sid

    await ns.enter_room(sid, "sidebar_ipc")
    await ns.enter_room(sid, _client_room(client_id))
    await ns.save_session(sid, {"sidebarRole": role, "clientId": client_id})
    _client_ids_by_sid[sid] = client_id

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
    await emit_sidebar_cwd_set(ns, to_sid=sid, reason="register")
    await _emit_client_state(ns, client_id, to_sid=sid)


async def on_sidebar_disconnect(ns, sid):
    removed = False
    if sid in _registered_hosts:
        _registered_hosts.discard(sid)
        removed = True
    if sid in _registered_iframes:
        _registered_iframes.discard(sid)
        removed = True
    _client_ids_by_sid.pop(sid, None)
    if removed:
        await _emit_presence(ns)


async def on_sidebar_event(ns, sid, data):
    """Generic relay for sidebar-scoped events."""
    if not isinstance(data, dict):
        return
    event_type = str(data.get("type") or "unknown")
    print(
        f"[sidebar_ipc] event type={event_type} from={sid} "
        f"payload={_payload_preview(data.get('payload'))}",
        flush=True,
    )
    if event_type == "agent_edit":
        if not _is_agent_sidebar_tracking_enabled():
            print("[sidebar_ipc] agent_edit dropped: trackAgentSidebarEdits disabled", flush=True)
            return
        payload = data.get("payload")
        if isinstance(payload, dict):
            try:
                await _broadcast_agent_open(ns, payload)
            except Exception as exc:
                print(f"[sidebar_ipc] sidebar:event agent_edit route failed: {exc}", flush=True)
        return
    if event_type == "agent_open":
        payload = data.get("payload")
        if isinstance(payload, dict):
            try:
                await _broadcast_agent_open(ns, payload)
            except Exception as exc:
                print(f"[sidebar_ipc] sidebar:event agent_open route failed: {exc}", flush=True)
        return
    if event_type == "active_shortcut:set":
        payload = data.get("payload")
        client_id = await _resolve_client_id(ns, sid, payload if isinstance(payload, dict) else None)
        shortcut_id = _norm(payload.get("shortcutId") or payload.get("activeShortcutId")) if isinstance(payload, dict) else ""
        _client_active_shortcuts[client_id] = shortcut_id
        await _emit_client_state(ns, client_id, skip_sid=sid)
        return
    if event_type == "refresh_active":
        payload = data.get("payload")
        client_id = await _resolve_client_id(ns, sid, payload if isinstance(payload, dict) else None)
        await ns.emit("sidebar:event", data, room=_client_room(client_id), skip_sid=sid)
        return
    await ns.emit("sidebar:event", data, room="sidebar_ipc", skip_sid=sid)


async def on_sidebar_cwd_get(ns, sid, data):
    payload = _cwd_payload("request")
    print(
        f"[sidebar_ipc] cwd_get from={sid} cwd={payload.get('cwd') or ''}",
        flush=True,
    )
    return {"ok": True, "data": payload}


async def on_sidebar_cwd_set(ns, sid, data):
    # Backend is the source of truth; ignore client-supplied cwd and re-emit canonical value.
    print(f"[sidebar_ipc] cwd_set request ignored from={sid}", flush=True)
    await emit_sidebar_cwd_set(ns, reason="authoritative")
    return {"ok": True}


async def route_backend_open_request(
    _ns,
    data: dict,
    *,
    source_name: str = "sidebar_ipc",
    log_prefix: str = "[sidebar_ipc] agent_open",
    request_prefix: str = "sidebar",
) -> None:
    from ..host.file_ops_backend import handle_host_open_request

    print(
        f"{log_prefix} routing via host file_ops backend",
        flush=True,
    )
    await handle_host_open_request(
        data,
        source_name=source_name,
        request_prefix=request_prefix,
    )


async def _broadcast_agent_open(_ns, data: dict) -> None:
    await route_backend_open_request(_ns, data)


async def on_sidebar_agent_edit(ns, sid, data):
    """Route agent-edit signals through backend explorer broadcast path."""
    if not isinstance(data, dict):
        return
    if not _is_agent_sidebar_tracking_enabled():
        print("[sidebar_ipc] agent_edit dropped: trackAgentSidebarEdits disabled", flush=True)
        return
    print(
        f"[sidebar_ipc] agent_edit from={sid} payload={_payload_preview(data)}",
        flush=True,
    )
    try:
        await _broadcast_agent_open(ns, data)
    except Exception as exc:
        print(f"[sidebar_ipc] agent_edit route failed: {exc}", flush=True)


async def on_sidebar_agent_open(ns, sid, data):
    """Route explicit user-driven opens through backend explorer broadcast path."""
    if not isinstance(data, dict):
        return
    print(
        f"[sidebar_ipc] agent_open from={sid} payload={_payload_preview(data)}",
        flush=True,
    )
    try:
        await _broadcast_agent_open(ns, data)
    except Exception as exc:
        print(f"[sidebar_ipc] agent_open route failed: {exc}", flush=True)


async def on_sidebar_mention(ns, sid, data):
    """Relay a file mention from a client to all sidebar_ipc listeners.

    The explorer emits sidebar:mention server-side (via UI_IPC_SIO.emit),
    which reaches all clients in the room directly.  This handler covers
    the case where a *client* (e.g. a sidebar iframe) emits sidebar:mention
    so it gets rebroadcast to the room.
    """
    if not isinstance(data, dict):
        return
    path = data.get("path")
    print(
        f"[sidebar_ipc] mention from={sid} path={path}",
        flush=True,
    )
    await ns.emit("sidebar:mention", data, room="sidebar_ipc", skip_sid=sid)
