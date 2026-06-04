"""Sidebar IPC handlers for the dedicated /sidebar_ipc Socket.IO namespace.

This channel is intentionally separate from /ui_ipc to keep sidebar orchestration
traffic isolated from editor/console chatter.
"""

import time

from ..explorer.services.file_ops import get_project_root
from ..stores import get_history_store, get_preferences_store
from .rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED,
)
from .sidebar_rpc_contract import (
    SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_CLEAR,
    SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_DECIDE,
    SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_DOCUMENT_STATE_GET,
    SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_LIST,
    SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_PUBLISH,
    SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_REFRESH,
    SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_SET,
    SIDEBAR_IPC_RPC_METHOD_CWD_GET,
    SIDEBAR_IPC_RPC_METHOD_CWD_SYNC,
    SIDEBAR_IPC_RPC_METHOD_DRAFT_CLEAR,
    SIDEBAR_IPC_RPC_METHOD_DRAFT_STATE_GET,
    SIDEBAR_IPC_RPC_METHOD_DRAFTS_LIST,
    SIDEBAR_IPC_RPC_METHOD_DRAWER_CLOSE,
    SIDEBAR_IPC_RPC_METHOD_DRAWER_OPEN,
    SIDEBAR_IPC_RPC_METHOD_DRAWER_TOGGLE,
    SIDEBAR_IPC_RPC_METHOD_FILE_EDIT,
    SIDEBAR_IPC_RPC_METHOD_FILE_OPEN,
    SIDEBAR_IPC_RPC_METHOD_MENTION,
    SIDEBAR_IPC_RPC_METHOD_LAUNCHER_CATALOG_GET,
    SIDEBAR_IPC_RPC_METHOD_PROJECT_CREATE,
    SIDEBAR_IPC_RPC_METHOD_PROJECT_LOOKUP,
    SIDEBAR_IPC_RPC_METHOD_PROJECT_OPEN,
    SIDEBAR_IPC_RPC_METHOD_REGISTER,
    SIDEBAR_IPC_RPC_METHOD_WINDOWS_LIST,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_ACTIVATE,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_CLOSE,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_CREATE,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_OPEN_URL,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_READINESS_UPDATE,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_STATE_UPDATE,
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
    SIDEBAR_IPC_RPC_NOTIFICATION_PROJECT_OPENED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED,
    SidebarIpcRpcProtocolError,
    build_jsonrpc_error,
    build_jsonrpc_notification,
    build_jsonrpc_result,
    parse_sidebar_ipc_rpc_notification,
    parse_sidebar_ipc_rpc_request,
)

_registered_hosts: set[str] = set()
_registered_iframes: set[str] = set()
_agent_edit_peer_sids: set[str] = set()
_client_ids_by_sid: dict[str, str] = {}
_client_active_shortcuts: dict[str, str] = {}
_client_active_windows: dict[str, str] = {}

JsonObject = dict[str, object]


def _is_agent_sidebar_tracking_enabled() -> bool:
    try:
        prefs = get_preferences_store().get_preferences()
        editor = prefs.get("editor") if isinstance(prefs, dict) else {}
        if not isinstance(editor, dict):
            return False
        return bool(editor.get("trackAgentSidebarEdits", False))
    except Exception:
        return False


def _norm(value) -> str:
    return str(value or "").strip()


def _has_agent_edit_capability(data: dict) -> bool:
    if data.get("agentEdits") is True or data.get("agent_edits") is True:
        return True
    capabilities = data.get("capabilities")
    if isinstance(capabilities, list):
        normalized = {_norm(item) for item in capabilities}
        if {"agentEdits", "agent_edits", "sidebar.agentEdits"} & normalized:
            return True
    app_name = _norm(data.get("app") or data.get("app_id") or data.get("appId")).lower()
    return app_name in {"als", "als-rs", "als_rs"}


def _client_room(client_id: str) -> str:
    return f"sidebar:client:{_norm(client_id) or 'unknown'}"


def _client_state_payload(client_id: str) -> dict:
    safe_client_id = _norm(client_id)
    active_window = _norm(_client_active_windows.get(safe_client_id))
    return {
        "client_id": safe_client_id,
        "activeShortcutId": _norm(_client_active_shortcuts.get(safe_client_id)),
        "activeWindowHostId": active_window,
        "ts": int(time.time() * 1000),
    }


async def _emit_rpc_notification(ns, method: str, params: dict, *, to_sid: str | None = None, room: str | None = None, skip_sid: str | None = None):
    envelope = build_jsonrpc_notification(method, params)
    if to_sid:
        await ns.emit(SIDEBAR_IPC_RPC_NOTIFICATION_EVENT, envelope, to=to_sid)
        return
    await ns.emit(SIDEBAR_IPC_RPC_NOTIFICATION_EVENT, envelope, room=room or "sidebar_ipc", skip_sid=skip_sid)


async def _emit_ui_ipc_sidebar_notification(method: str, params: dict) -> None:
    from .ui_ipc_ws import emit_ui_ipc_rpc_notification

    await emit_ui_ipc_rpc_notification(method, params)


async def _emit_sidebar_ipc_global_notification(method: str, params: dict) -> None:
    from .ui_ipc_socketio import UI_IPC_SIO

    await UI_IPC_SIO.emit(
        SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
        build_jsonrpc_notification(method, params),
        namespace="/sidebar_ipc",
        room="sidebar_ipc",
    )


async def _emit_ui_sidebar_window_state(active_host_id: str | None = None) -> dict:
    from .sidebar_window_state import get_sidebar_window_state

    payload = get_sidebar_window_state(_norm(active_host_id) or None)
    await _emit_ui_ipc_sidebar_notification(UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED, payload)
    await _emit_sidebar_ipc_global_notification(SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED, payload)
    return payload


async def _emit_client_state(ns, client_id: str, *, to_sid: str | None = None, skip_sid: str | None = None):
    state_payload = _client_state_payload(client_id)
    if to_sid:
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE, state_payload, to_sid=to_sid)
        return
    await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE, state_payload, room=_client_room(client_id), skip_sid=skip_sid)


async def _emit_sidebar_windows_changed(ns, *, client_id: str | None = None, to_sid: str | None = None, skip_sid: str | None = None):
    from .sidebar_window_state import get_sidebar_window_state

    active_host_id = _norm(_client_active_windows.get(_norm(client_id))) if client_id else ""
    payload = get_sidebar_window_state(active_host_id or None)
    await _emit_ui_ipc_sidebar_notification(UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED, payload)
    if to_sid:
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED, payload, to_sid=to_sid)
        return
    room = _client_room(client_id) if client_id else "sidebar_ipc"
    await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED, payload, room=room, skip_sid=skip_sid)


async def _emit_sidebar_window_activated(ns, client_id: str, host_id: str, *, skip_sid: str | None = None):
    payload = {
        "client_id": _norm(client_id),
        "host_id": _norm(host_id),
        "hostId": _norm(host_id),
        "ts": int(time.time() * 1000),
    }
    await _emit_ui_ipc_sidebar_notification(UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED, payload)
    await _emit_rpc_notification(
        ns,
        SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED,
        payload,
        room=_client_room(client_id),
        skip_sid=skip_sid,
    )


async def _emit_sidebar_window_readiness_changed(ns, payload: dict, *, skip_sid: str | None = None):
    params = payload if isinstance(payload, dict) else {}
    await _emit_ui_ipc_sidebar_notification(UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED, params)
    await _emit_rpc_notification(
        ns,
        SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED,
        params,
        room="sidebar_ipc",
        skip_sid=skip_sid,
    )


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
    else:
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_PRESENCE, payload, room="sidebar_ipc")


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
    else:
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_CWD_SET, payload, room="sidebar_ipc")
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
    print(
        f"[sidebar_ipc] cwd_set(global) reason={payload.get('reason')} cwd={payload.get('cwd') or ''}",
        flush=True,
    )


async def emit_sidebar_mention_global(payload: JsonObject) -> None:
    from .ui_ipc_socketio import UI_IPC_SIO

    await UI_IPC_SIO.emit(
        SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
        build_jsonrpc_notification(SIDEBAR_IPC_RPC_NOTIFICATION_MENTION, payload),
        namespace="/sidebar_ipc",
        room="sidebar_ipc",
    )


async def update_sidebar_window_readiness_global(payload: JsonObject) -> JsonObject:
    from .sidebar_window_state import update_sidebar_window_readiness
    from .ui_ipc_ws import emit_ui_ipc_rpc_notification

    result = update_sidebar_window_readiness(payload)
    await emit_ui_ipc_rpc_notification(UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED, result)
    await _emit_ui_sidebar_window_state()
    await _emit_sidebar_ipc_global_notification(SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED, result)
    return result


async def handle_ui_sidebar_window_create_request(params: JsonObject) -> JsonObject:
    from .sidebar_window_state import create_sidebar_window

    body = params if isinstance(params, dict) else {}
    client_id = _norm(body.get("client_id") or body.get("clientId")) or "main_page"
    result = create_sidebar_window(body)
    window = result.get("window") if isinstance(result, dict) else {}
    host_id = _norm(window.get("host_id") if isinstance(window, dict) else "")
    if host_id:
        _client_active_windows[client_id] = host_id
        _client_active_shortcuts[client_id] = ""
        activated = {
            "client_id": client_id,
            "host_id": host_id,
            "hostId": host_id,
            "ts": int(time.time() * 1000),
        }
        await _emit_ui_ipc_sidebar_notification(UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED, activated)
        await _emit_sidebar_ipc_global_notification(SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED, activated)
    await _emit_ui_sidebar_window_state(host_id or None)
    return result


async def handle_ui_sidebar_window_activate_request(params: JsonObject) -> JsonObject:
    from .sidebar_window_state import activate_sidebar_window

    body = params if isinstance(params, dict) else {}
    client_id = _norm(body.get("client_id") or body.get("clientId")) or "main_page"
    result = activate_sidebar_window(body)
    host_id = _norm(body.get("host_id") or body.get("hostId"))
    if host_id:
        _client_active_windows[client_id] = host_id
        _client_active_shortcuts[client_id] = ""
        activated = {
            "client_id": client_id,
            "host_id": host_id,
            "hostId": host_id,
            "ts": int(time.time() * 1000),
        }
        await _emit_ui_ipc_sidebar_notification(UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED, activated)
        await _emit_sidebar_ipc_global_notification(SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED, activated)
    await _emit_ui_sidebar_window_state(host_id or None)
    return result


async def handle_ui_sidebar_window_close_request(params: JsonObject) -> JsonObject:
    from .sidebar_window_state import close_sidebar_window

    body = params if isinstance(params, dict) else {}
    client_id = _norm(body.get("client_id") or body.get("clientId")) or "main_page"
    host_id = _norm(body.get("host_id") or body.get("hostId"))
    result = close_sidebar_window(body)
    if _norm(_client_active_windows.get(client_id)) == host_id:
        state = result.get("state") if isinstance(result, dict) else {}
        next_active = _norm(state.get("activeHostId") if isinstance(state, dict) else "")
        _client_active_windows[client_id] = next_active
    await _emit_ui_sidebar_window_state(_client_active_windows.get(client_id))
    return result


async def handle_ui_sidebar_active_shortcut_set_request(params: JsonObject) -> JsonObject:
    body = params if isinstance(params, dict) else {}
    client_id = _norm(body.get("client_id") or body.get("clientId")) or "main_page"
    shortcut_id = _norm(body.get("shortcutId") or body.get("activeShortcutId"))
    _client_active_shortcuts[client_id] = shortcut_id
    if shortcut_id:
        _client_active_windows[client_id] = ""
    return {"ok": True, "client_id": client_id, "activeShortcutId": shortcut_id}


async def request_agent_edit_document_state_from_peers(
    payload: JsonObject,
    *,
    exclude_sid: str | None = None,
) -> JsonObject:
    from .ui_ipc_socketio import UI_IPC_SIO

    peers = 0
    envelope = build_jsonrpc_notification(SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_DOCUMENT_STATE_GET, payload)
    for sid in list(_agent_edit_peer_sids):
        if exclude_sid and sid == exclude_sid:
            continue
        await UI_IPC_SIO.emit(
            SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
            envelope,
            to=sid,
            namespace="/sidebar_ipc",
        )
        peers += 1
    if peers == 0:
        return {"ok": False, "available": False, "error": "no agent edit peer available"}
    return {"ok": True, "queued": True, "peers": peers}


async def forward_agent_edit_decision_to_peers(
    payload: JsonObject,
    *,
    exclude_sid: str | None = None,
) -> JsonObject:
    from .ui_ipc_socketio import UI_IPC_SIO

    peers = 0
    envelope = build_jsonrpc_notification(SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_DECIDE, payload)
    for sid in list(_agent_edit_peer_sids):
        if exclude_sid and sid == exclude_sid:
            continue
        await UI_IPC_SIO.emit(
            SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
            envelope,
            to=sid,
            namespace="/sidebar_ipc",
        )
        peers += 1
    if peers == 0:
        return {"ok": False, "available": False, "error": "no agent edit peer available"}
    return {"ok": True, "queued": True, "peers": peers}


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

    if _has_agent_edit_capability(data):
        _agent_edit_peer_sids.add(sid)
        await ns.enter_room(sid, "sidebar:agent_edits")

    print(
        f"[sidebar_ipc] register sid={sid} role={role} ts={int(time.time() * 1000)}",
        flush=True,
    )
    await _emit_presence(ns)
    await emit_sidebar_cwd_set(ns, to_sid=sid, reason="register")
    await _emit_client_state(ns, client_id, to_sid=sid)
    await _emit_sidebar_windows_changed(ns, client_id=client_id, to_sid=sid)


async def on_sidebar_disconnect(ns, sid):
    removed = False
    if sid in _registered_hosts:
        _registered_hosts.discard(sid)
        removed = True
    if sid in _registered_iframes:
        _registered_iframes.discard(sid)
        removed = True
    _agent_edit_peer_sids.discard(sid)
    _client_ids_by_sid.pop(sid, None)
    if removed:
        await _emit_presence(ns)


async def _emit_sidebar_control_notification(ns, notification_method: str, payload: dict | None = None, *, room: str = "sidebar_ipc", skip_sid: str | None = None):
    params = payload if isinstance(payload, dict) else {}
    await _emit_rpc_notification(ns, notification_method, params, room=room, skip_sid=skip_sid)


async def _emit_project_opened(ns, payload: dict[str, object], *, skip_sid: str | None = None) -> None:
    params = dict(payload)
    params.setdefault("ts", int(time.time() * 1000))
    await _emit_rpc_notification(
        ns,
        SIDEBAR_IPC_RPC_NOTIFICATION_PROJECT_OPENED,
        params,
        room="sidebar_ipc",
        skip_sid=skip_sid,
    )


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


async def on_sidebar_mention(ns, sid, data):
    """Relay a typed sidebar.mention request/notification to sidebar listeners."""
    if not isinstance(data, dict):
        return
    path = data.get("path")
    print(
        f"[sidebar_ipc] mention from={sid} path={path}",
        flush=True,
    )
    await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_MENTION, data, room="sidebar_ipc", skip_sid=sid)


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
        from ..host.agent_edit_review_backend import handle_sidebar_file_edit_review_signal

        review_result = await handle_sidebar_file_edit_review_signal(
            params,
            source_name="sidebar_ipc_rpc",
            source_sid=sid,
        )
        if _is_agent_sidebar_tracking_enabled():
            await route_backend_open_request(
                ns,
                params,
                source_name="sidebar_ipc_rpc",
                log_prefix="[sidebar_ipc_rpc] file_edit",
                request_prefix="sidebar_rpc",
            )
            return {"ok": True, "review": review_result, "navigation": "routed"}
        print("[sidebar_ipc_rpc] file_edit tracking signal; navigation skipped: trackAgentSidebarEdits disabled", flush=True)
        return {"ok": True, "review": review_result, "navigation": "skipped", "reason": "trackAgentSidebarEdits disabled"}
    if method == SIDEBAR_IPC_RPC_METHOD_MENTION:
        await on_sidebar_mention(ns, sid, params)
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_PROJECT_LOOKUP:
        from ..host.project_backend import handle_sidebar_project_lookup_request

        return await handle_sidebar_project_lookup_request(
            params,
            source_name="sidebar_ipc_rpc",
        )
    if method == SIDEBAR_IPC_RPC_METHOD_PROJECT_OPEN:
        from ..host.project_backend import handle_sidebar_project_open_request

        result = await handle_sidebar_project_open_request(
            params,
            source_name="sidebar_ipc_rpc",
        )
        if isinstance(result, dict) and result.get("ok") is True:
            await _emit_project_opened(ns, result)
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_PROJECT_CREATE:
        from ..host.project_backend import handle_sidebar_project_create_request

        result = await handle_sidebar_project_create_request(
            params,
            source_name="sidebar_ipc_rpc",
        )
        if isinstance(result, dict) and result.get("ok") is True and "resolved_path" in result:
            await _emit_project_opened(ns, result)
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_LAUNCHER_CATALOG_GET:
        from .sidebar_window_state import list_launcher_apps

        return {"ok": True, "apps": list_launcher_apps()}
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOWS_LIST:
        from .sidebar_window_state import get_sidebar_window_state

        client_id = await _resolve_client_id(ns, sid, params)
        return get_sidebar_window_state(_client_active_windows.get(client_id))
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOW_CREATE:
        from .sidebar_window_state import create_sidebar_window

        client_id = await _resolve_client_id(ns, sid, params)
        result = create_sidebar_window(params)
        window = result.get("window") if isinstance(result, dict) else {}
        host_id = _norm(window.get("host_id") if isinstance(window, dict) else "")
        if host_id:
            _client_active_windows[client_id] = host_id
            _client_active_shortcuts[client_id] = ""
            await _emit_sidebar_window_activated(ns, client_id, host_id, skip_sid=sid)
            await _emit_client_state(ns, client_id, skip_sid=sid)
        await _emit_sidebar_windows_changed(ns, client_id=client_id)
        return result
    if method in {SIDEBAR_IPC_RPC_METHOD_WINDOW_OPEN_URL, SIDEBAR_IPC_RPC_METHOD_WINDOW_STATE_UPDATE}:
        from .sidebar_window_state import open_sidebar_window_url

        client_id = await _resolve_client_id(ns, sid, params)
        result = open_sidebar_window_url(params)
        window = result.get("window") if isinstance(result, dict) else {}
        host_id = _norm(window.get("host_id") if isinstance(window, dict) else "")
        if host_id and params.get("activate", False):
            _client_active_windows[client_id] = host_id
            _client_active_shortcuts[client_id] = ""
            await _emit_sidebar_window_activated(ns, client_id, host_id, skip_sid=sid)
            await _emit_client_state(ns, client_id, skip_sid=sid)
        await _emit_sidebar_windows_changed(ns)
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOW_ACTIVATE:
        from .sidebar_window_state import activate_sidebar_window

        client_id = await _resolve_client_id(ns, sid, params)
        result = activate_sidebar_window(params)
        host_id = _norm(params.get("host_id") or params.get("hostId"))
        _client_active_windows[client_id] = host_id
        _client_active_shortcuts[client_id] = ""
        await _emit_sidebar_window_activated(ns, client_id, host_id, skip_sid=sid)
        await _emit_client_state(ns, client_id, skip_sid=sid)
        await _emit_sidebar_windows_changed(ns, client_id=client_id)
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOW_CLOSE:
        from .sidebar_window_state import close_sidebar_window

        client_id = await _resolve_client_id(ns, sid, params)
        result = close_sidebar_window(params)
        host_id = _norm(params.get("host_id") or params.get("hostId"))
        if _norm(_client_active_windows.get(client_id)) == host_id:
            state = result.get("state") if isinstance(result, dict) else {}
            next_active = _norm(state.get("activeHostId") if isinstance(state, dict) else "")
            _client_active_windows[client_id] = next_active
            await _emit_client_state(ns, client_id, skip_sid=sid)
        await _emit_sidebar_windows_changed(ns)
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOW_READINESS_UPDATE:
        from .sidebar_window_state import update_sidebar_window_readiness

        result = update_sidebar_window_readiness(params)
        if isinstance(result, dict):
            await _emit_sidebar_window_readiness_changed(ns, result, skip_sid=sid)
        await _emit_sidebar_windows_changed(ns)
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_DRAFTS_LIST:
        from ..host.draft_state_backend import handle_sidebar_drafts_list_request

        return await handle_sidebar_drafts_list_request(
            params,
            source_name="sidebar_ipc_rpc",
        )
    if method == SIDEBAR_IPC_RPC_METHOD_DRAFT_STATE_GET:
        from ..host.draft_state_backend import handle_sidebar_draft_state_get_request

        return await handle_sidebar_draft_state_get_request(
            params,
            source_name="sidebar_ipc_rpc",
        )
    if method == SIDEBAR_IPC_RPC_METHOD_DRAFT_CLEAR:
        from ..host.draft_state_backend import handle_sidebar_draft_clear_request

        return await handle_sidebar_draft_clear_request(
            params,
            source_name="sidebar_ipc_rpc",
        )
    if method == SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_DOCUMENT_STATE_GET:
        from ..host.agent_edit_review_backend import handle_sidebar_agent_edits_document_state_get_request

        return await handle_sidebar_agent_edits_document_state_get_request(
            params,
            source_name="sidebar_ipc_rpc",
            source_sid=sid,
        )
    if method == SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_PUBLISH:
        _agent_edit_peer_sids.add(sid)
        from ..host.agent_edit_review_backend import handle_sidebar_agent_edits_publish_request

        return await handle_sidebar_agent_edits_publish_request(
            params,
            source_name="sidebar_ipc_rpc",
        )
    if method == SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_CLEAR:
        _agent_edit_peer_sids.add(sid)
        from ..host.agent_edit_review_backend import handle_sidebar_agent_edits_clear_request

        return await handle_sidebar_agent_edits_clear_request(
            params,
            source_name="sidebar_ipc_rpc",
        )
    if method == SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_LIST:
        from ..host.agent_edit_review_backend import handle_sidebar_agent_edits_list_request

        return await handle_sidebar_agent_edits_list_request(
            params,
            source_name="sidebar_ipc_rpc",
        )
    if method == SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_DECIDE:
        _agent_edit_peer_sids.add(sid)
        from ..host.agent_edit_review_backend import handle_sidebar_agent_edits_decide_request

        return await handle_sidebar_agent_edits_decide_request(
            params,
            source_name="sidebar_ipc_rpc",
            source_sid=sid,
        )
    if method == SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_SET:
        client_id = await _resolve_client_id(ns, sid, params)
        shortcut_id = _norm(params.get("shortcutId") or params.get("activeShortcutId"))
        _client_active_shortcuts[client_id] = shortcut_id
        if shortcut_id:
            _client_active_windows[client_id] = ""
        await _emit_client_state(ns, client_id, skip_sid=sid)
        return {"ok": True, "client_id": client_id, "activeShortcutId": shortcut_id}
    if method == SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_REFRESH:
        client_id = await _resolve_client_id(ns, sid, params)
        # The host that requested refresh is also the iframe owner, so echo back.
        await _emit_sidebar_control_notification(
            ns,
            SIDEBAR_IPC_RPC_NOTIFICATION_ACTIVE_SHORTCUT_REFRESH,
            params,
            room=_client_room(client_id),
        )
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_DRAWER_OPEN:
        await _emit_sidebar_control_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_OPEN, params, skip_sid=sid)
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_DRAWER_CLOSE:
        await _emit_sidebar_control_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_CLOSE, params, skip_sid=sid)
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_DRAWER_TOGGLE:
        await _emit_sidebar_control_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_TOGGLE, params, skip_sid=sid)
        return {"ok": True}
    raise RuntimeError(f"Unhandled sidebar IPC RPC method: {method}")


async def _dispatch_sidebar_rpc_notification(ns, sid: str, method: str, params: dict) -> None:
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_STATE:
        await _emit_sidebar_control_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_STATE, params, skip_sid=sid)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_OPEN:
        await _emit_sidebar_control_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_OPEN, params, skip_sid=sid)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_CLOSE:
        await _emit_sidebar_control_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_CLOSE, params, skip_sid=sid)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_TOGGLE:
        await _emit_sidebar_control_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_TOGGLE, params, skip_sid=sid)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_ACTIVE_SHORTCUT_REFRESH:
        client_id = await _resolve_client_id(ns, sid, params)
        # The host that requested refresh is also the iframe owner, so echo back.
        await _emit_sidebar_control_notification(
            ns,
            SIDEBAR_IPC_RPC_NOTIFICATION_ACTIVE_SHORTCUT_REFRESH,
            params,
            room=_client_room(client_id),
        )
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
