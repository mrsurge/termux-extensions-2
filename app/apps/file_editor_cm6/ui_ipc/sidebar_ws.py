"""Sidebar IPC handlers for the dedicated /sidebar_ipc Socket.IO namespace.

This channel is intentionally separate from /ui_ipc to keep sidebar orchestration
traffic isolated from editor/console chatter.
"""

import time

from ..explorer.services.file_ops import get_project_root
from ..stores import get_history_store, get_preferences_store
from .sidebar_rpc_contract import (
    SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_REFRESH,
    SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_SET,
    SIDEBAR_IPC_RPC_METHOD_CWD_GET,
    SIDEBAR_IPC_RPC_METHOD_CWD_SYNC,
    SIDEBAR_IPC_RPC_METHOD_DRAWER_CLOSE,
    SIDEBAR_IPC_RPC_METHOD_DRAWER_OPEN,
    SIDEBAR_IPC_RPC_METHOD_DRAWER_TOGGLE,
    SIDEBAR_IPC_RPC_METHOD_FILE_EDIT,
    SIDEBAR_IPC_RPC_METHOD_FILE_OPEN,
    SIDEBAR_IPC_RPC_METHOD_MENTION,
    SIDEBAR_IPC_RPC_METHOD_REGISTER,
    SIDEBAR_IPC_RPC_NOTIFICATION_ACTIVE_SHORTCUT_REFRESH,
    SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE,
    SIDEBAR_IPC_RPC_NOTIFICATION_CWD_SET,
    SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_CLOSE,
    SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_OPEN,
    SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_STATE,
    SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_TOGGLE,
    SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
    SIDEBAR_IPC_RPC_NOTIFICATION_MENTION,
    SIDEBAR_IPC_RPC_NOTIFICATION_PRESENCE,
    SidebarIpcRpcProtocolError,
    build_jsonrpc_error,
    build_jsonrpc_notification,
    build_jsonrpc_result,
    parse_sidebar_ipc_rpc_notification,
    parse_sidebar_ipc_rpc_request,
)

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


async def _emit_rpc_notification(ns, method: str, params: dict, *, to_sid: str | None = None, room: str | None = None, skip_sid: str | None = None):
    envelope = build_jsonrpc_notification(method, params)
    if to_sid:
        await ns.emit(SIDEBAR_IPC_RPC_NOTIFICATION_EVENT, envelope, to=to_sid)
        return
    await ns.emit(SIDEBAR_IPC_RPC_NOTIFICATION_EVENT, envelope, room=room or "sidebar_ipc", skip_sid=skip_sid)


async def _emit_client_state(ns, client_id: str, *, to_sid: str | None = None, skip_sid: str | None = None):
    state_payload = _client_state_payload(client_id)
    payload = {
        "type": "client_state",
        "payload": state_payload,
    }
    if to_sid:
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE, state_payload, to_sid=to_sid)
        await ns.emit("sidebar:event", payload, to=to_sid)
        return
    await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE, state_payload, room=_client_room(client_id), skip_sid=skip_sid)
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
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_PRESENCE, payload, to_sid=to_sid)
        await ns.emit("sidebar:presence", payload, to=to_sid)
    else:
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_PRESENCE, payload, room="sidebar_ipc")
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
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_CWD_SET, payload, to_sid=to_sid)
        await ns.emit("sidebar:cwd_set", payload, to=to_sid)
    else:
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_CWD_SET, payload, room="sidebar_ipc")
        await ns.emit("sidebar:cwd_set", payload, room="sidebar_ipc")
    print(
        f"[sidebar_ipc] cwd_set reason={payload.get('reason')} cwd={payload.get('cwd') or ''} to={to_sid or 'room'}",
        flush=True,
    )


async def emit_sidebar_cwd_set_global(*, reason: str = "sync") -> None:
    from .ui_ipc_socketio import UI_IPC_SIO

    payload = _cwd_payload(reason)
    await UI_IPC_SIO.emit(
        SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
        build_jsonrpc_notification(SIDEBAR_IPC_RPC_NOTIFICATION_CWD_SET, payload),
        namespace="/sidebar_ipc",
        room="sidebar_ipc",
    )
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


def _event_payload(event_type: str, payload: dict | None = None) -> dict:
    return {
        "type": event_type,
        "payload": payload if isinstance(payload, dict) else {},
    }


async def _emit_sidebar_event_dual(ns, event_type: str, payload: dict | None = None, *, room: str = "sidebar_ipc", skip_sid: str | None = None):
    data = _event_payload(event_type, payload)
    notification_method = {
        "refresh_active": SIDEBAR_IPC_RPC_NOTIFICATION_ACTIVE_SHORTCUT_REFRESH,
        "drawer:state": SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_STATE,
        "drawer:open": SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_OPEN,
        "drawer:close": SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_CLOSE,
        "drawer:toggle": SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_TOGGLE,
    }.get(event_type)
    if notification_method:
        await _emit_rpc_notification(ns, notification_method, data["payload"], room=room, skip_sid=skip_sid)
    await ns.emit("sidebar:event", data, room=room, skip_sid=skip_sid)


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
    await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_MENTION, data, room="sidebar_ipc", skip_sid=sid)
    await ns.emit("sidebar:mention", data, room="sidebar_ipc", skip_sid=sid)


async def _dispatch_sidebar_rpc_request(ns, sid: str, method: str, params: dict) -> object:
    if method == SIDEBAR_IPC_RPC_METHOD_REGISTER:
        await on_sidebar_register(ns, sid, params)
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_CWD_GET:
        payload = _cwd_payload("request")
        print(f"[sidebar_ipc_rpc] cwd_get from={sid} cwd={payload.get('cwd') or ''}", flush=True)
        return payload
    if method == SIDEBAR_IPC_RPC_METHOD_CWD_SYNC:
        reason = _norm(params.get("reason")) if isinstance(params, dict) else ""
        await emit_sidebar_cwd_set(ns, reason=reason or "authoritative")
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_FILE_OPEN:
        await route_backend_open_request(
            ns,
            params,
            source_name="sidebar_ipc_rpc",
            log_prefix="[sidebar_ipc_rpc] file_open",
            request_prefix="sidebar_rpc",
        )
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_FILE_EDIT:
        if not _is_agent_sidebar_tracking_enabled():
            print("[sidebar_ipc_rpc] file_edit dropped: trackAgentSidebarEdits disabled", flush=True)
            return {"ok": False, "dropped": True, "reason": "trackAgentSidebarEdits disabled"}
        await route_backend_open_request(
            ns,
            params,
            source_name="sidebar_ipc_rpc",
            log_prefix="[sidebar_ipc_rpc] file_edit",
            request_prefix="sidebar_rpc",
        )
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_MENTION:
        await on_sidebar_mention(ns, sid, params)
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_SET:
        client_id = await _resolve_client_id(ns, sid, params)
        shortcut_id = _norm(params.get("shortcutId") or params.get("activeShortcutId"))
        _client_active_shortcuts[client_id] = shortcut_id
        await _emit_client_state(ns, client_id, skip_sid=sid)
        return {"ok": True, "client_id": client_id, "activeShortcutId": shortcut_id}
    if method == SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_REFRESH:
        client_id = await _resolve_client_id(ns, sid, params)
        await _emit_sidebar_event_dual(ns, "refresh_active", params, room=_client_room(client_id), skip_sid=sid)
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_DRAWER_OPEN:
        await _emit_sidebar_event_dual(ns, "drawer:open", params, skip_sid=sid)
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_DRAWER_CLOSE:
        await _emit_sidebar_event_dual(ns, "drawer:close", params, skip_sid=sid)
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_DRAWER_TOGGLE:
        await _emit_sidebar_event_dual(ns, "drawer:toggle", params, skip_sid=sid)
        return {"ok": True}
    raise RuntimeError(f"Unhandled sidebar IPC RPC method: {method}")


async def _dispatch_sidebar_rpc_notification(ns, sid: str, method: str, params: dict) -> None:
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_STATE:
        await _emit_sidebar_event_dual(ns, "drawer:state", params, skip_sid=sid)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_OPEN:
        await _emit_sidebar_event_dual(ns, "drawer:open", params, skip_sid=sid)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_CLOSE:
        await _emit_sidebar_event_dual(ns, "drawer:close", params, skip_sid=sid)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_TOGGLE:
        await _emit_sidebar_event_dual(ns, "drawer:toggle", params, skip_sid=sid)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_ACTIVE_SHORTCUT_REFRESH:
        client_id = await _resolve_client_id(ns, sid, params)
        await _emit_sidebar_event_dual(ns, "refresh_active", params, room=_client_room(client_id), skip_sid=sid)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_MENTION:
        await on_sidebar_mention(ns, sid, params)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_CWD_SET:
        await emit_sidebar_cwd_set(ns, reason=_norm(params.get("reason")) or "authoritative")
        return
    # Presence/client-state/file-open notifications are backend-owned; ignore client copies.


async def on_sidebar_rpc(ns, sid, data):
    try:
        parsed_request = parse_sidebar_ipc_rpc_request(data)
        if parsed_request is None:
            notification = parse_sidebar_ipc_rpc_notification(data)
            await _dispatch_sidebar_rpc_notification(ns, sid, notification["method"], notification["params"])
            return None
        result = await _dispatch_sidebar_rpc_request(ns, sid, parsed_request["method"], parsed_request["params"])
        return build_jsonrpc_result(parsed_request["request_id"], result)
    except SidebarIpcRpcProtocolError as exc:
        return exc.to_json()
    except Exception as exc:
        return build_jsonrpc_error(
            request_id=None,
            code=-32603,
            message=str(exc),
        )
