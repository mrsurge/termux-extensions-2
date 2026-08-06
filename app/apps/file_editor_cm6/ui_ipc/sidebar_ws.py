"""Sidebar IPC handlers for the dedicated /sidebar_ipc Socket.IO namespace.

This channel is intentionally separate from /ui_ipc to keep sidebar orchestration
traffic isolated from editor/console chatter.
"""

import time
from typing import Awaitable, Protocol, cast

from ..explorer.services.file_ops import get_project_root
from ..sidebar_window_events import publish_sidebar_window_state_changed
from ..stores import get_history_store, get_preferences_store
from .rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
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
    SIDEBAR_IPC_RPC_METHOD_WINDOW_PRESENTATION_UPDATE,
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
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_FOCUSED,
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
_app_ids_by_sid: dict[str, str] = {}
# Ephemeral routing proof only. Durable slot membership remains ledger-owned,
# while each host client remains presentation authority for its own windows.
_client_presentations: dict[tuple[str, str], str] = {}
_client_active_shortcuts: dict[str, str] = {}
_client_active_windows: dict[str, str] = {}

JsonObject = dict[str, object]


class SidebarNamespace(Protocol):
    def emit(
        self,
        event: str,
        data: object | None = None,
        *,
        to: str | None = None,
        room: str | None = None,
        skip_sid: str | None = None,
        namespace: str | None = None,
    ) -> Awaitable[None]: ...

    def enter_room(self, sid: str, room: str) -> Awaitable[None]: ...

    def save_session(self, sid: str, session: JsonObject) -> Awaitable[None]: ...

    def get_session(self, sid: str) -> Awaitable[object]: ...


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _is_agent_sidebar_tracking_enabled() -> bool:
    try:
        prefs = _json_object(get_preferences_store().get_preferences())
        editor = _json_object(prefs.get("editor", {}))
        return bool(editor.get("trackAgentSidebarEdits", False))
    except Exception:
        return False


def _norm(value: object) -> str:
    return str(value or "").strip()


def _has_agent_edit_capability(data: JsonObject) -> bool:
    if data.get("agentEdits") is True or data.get("agent_edits") is True:
        return True
    capabilities = data.get("capabilities")
    if isinstance(capabilities, list):
        normalized = {_norm(item) for item in cast(list[object], capabilities)}
        if {"agentEdits", "agent_edits", "sidebar.agentEdits"} & normalized:
            return True
    app_name = _norm(data.get("app") or data.get("app_id") or data.get("appId")).lower()
    return app_name in {"als", "als-rs", "als_rs"}


def _client_room(client_id: str) -> str:
    return f"sidebar:client:{_norm(client_id) or 'unknown'}"


def _app_room(app_id: str) -> str:
    return f"sidebar:app:{_norm(app_id) or 'unknown'}"


def _app_id_aliases(app_id: object) -> set[str]:
    value = _norm(app_id)
    if not value:
        return set()
    aliases = {value}
    if "-" in value:
        aliases.add(value.replace("-", "_"))
    if "_" in value:
        aliases.add(value.replace("_", "-"))
    if value in {"als", "als-rs", "als_rs"}:
        aliases.update({"als", "als-rs", "als_rs"})
    return aliases


def _client_state_payload(client_id: str) -> JsonObject:
    safe_client_id = _norm(client_id)
    return {
        "client_id": safe_client_id,
        "clientId": safe_client_id,
        "activeShortcutId": _norm(_client_active_shortcuts.get(safe_client_id)),
        "ts": int(time.time() * 1000),
    }


def _sidebar_window_activated_payload(client_id: str, host_id: str) -> JsonObject:
    safe_client_id = _norm(client_id)
    safe_host_id = _norm(host_id)
    return {
        "client_id": safe_client_id,
        "clientId": safe_client_id,
        "host_id": safe_host_id,
        "hostId": safe_host_id,
        "ts": int(time.time() * 1000),
    }


async def _emit_rpc_notification(ns: SidebarNamespace, method: str, params: JsonObject, *, to_sid: str | None = None, room: str | None = None, skip_sid: str | None = None) -> None:
    envelope = build_jsonrpc_notification(method, params)
    if to_sid:
        await ns.emit(SIDEBAR_IPC_RPC_NOTIFICATION_EVENT, envelope, to=to_sid)
        return
    await ns.emit(SIDEBAR_IPC_RPC_NOTIFICATION_EVENT, envelope, room=room or "sidebar_ipc", skip_sid=skip_sid)


async def _emit_ui_ipc_sidebar_notification(method: str, params: JsonObject) -> None:
    from .ui_ipc_ws import emit_ui_ipc_rpc_notification

    await emit_ui_ipc_rpc_notification(method, params)


async def _emit_client_state(ns: SidebarNamespace, client_id: str, *, to_sid: str | None = None, skip_sid: str | None = None) -> None:
    state_payload = _client_state_payload(client_id)
    if to_sid:
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE, state_payload, to_sid=to_sid)
        return
    await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE, state_payload, room=_client_room(client_id), skip_sid=skip_sid)


async def _emit_sidebar_windows_changed(ns: SidebarNamespace, *, client_id: str | None = None, to_sid: str | None = None, skip_sid: str | None = None) -> None:
    from .sidebar_window_state import get_sidebar_window_state

    payload = get_sidebar_window_state()
    await _emit_ui_ipc_sidebar_notification(UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED, payload)
    if to_sid:
        await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED, payload, to_sid=to_sid)
        return
    room = _client_room(client_id) if client_id else "sidebar_ipc"
    await _emit_rpc_notification(ns, SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED, payload, room=room, skip_sid=skip_sid)


def _sidebar_window_focus_payload(client_id: str, host_id: str, source: object = "") -> JsonObject:
    from .sidebar_window_state import get_sidebar_window_state

    safe_client_id = _norm(client_id)
    safe_host_id = _norm(host_id)
    if not safe_host_id:
        return {}
    state = _json_object(get_sidebar_window_state())
    slots = _json_object(state.get("slots", {}))
    slot = _json_object(slots.get(safe_host_id, {}))
    if not slot:
        return {}
    app_id = _norm(slot.get("app_id") or slot.get("appId"))
    if not app_id:
        return {}
    stateful = bool(
        slot.get("stateful")
        or slot.get("token_id")
        or slot.get("tokenId")
        or slot.get("console_worker_id")
        or slot.get("consoleWorkerId")
    )
    if not stateful:
        return {}
    state_kind = _norm(slot.get("state_kind") or slot.get("stateKind"))
    query_state = _json_object(slot.get("query_state") or slot.get("queryState"))
    token_id = _norm(slot.get("token_id") or slot.get("tokenId"))
    console_worker_id = _norm(slot.get("console_worker_id") or slot.get("consoleWorkerId"))
    restore_url = _norm(slot.get("restore_url") or slot.get("restoreUrl") or slot.get("url"))
    payload: JsonObject = {
        "app_id": app_id,
        "appId": app_id,
        "client_id": safe_client_id,
        "clientId": safe_client_id,
        "host_id": safe_host_id,
        "hostId": safe_host_id,
        "state_kind": state_kind,
        "stateKind": state_kind,
        "query_state": query_state,
        "queryState": query_state,
        "url": _norm(slot.get("url")),
        "restore_url": restore_url,
        "restoreUrl": restore_url,
        "token_id": token_id,
        "tokenId": token_id,
        "console_worker_id": console_worker_id,
        "consoleWorkerId": console_worker_id,
        "focused": True,
        "source": _norm(source),
        "ts": int(time.time() * 1000),
    }
    return payload


async def _emit_sidebar_window_focused_global(
    client_id: str,
    host_id: str,
    *,
    source: object = "",
    skip_sid: str | None = None,
) -> JsonObject:
    payload = _sidebar_window_focus_payload(client_id, host_id, source)
    app_id = _norm(payload.get("app_id"))
    if not app_id:
        return {}
    from .ui_ipc_socketio import UI_IPC_SIO

    sio = cast(SidebarNamespace, UI_IPC_SIO)
    await sio.emit(
        SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
        build_jsonrpc_notification(SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_FOCUSED, payload),
        namespace="/sidebar_ipc",
        room=_app_room(app_id),
        skip_sid=skip_sid,
    )
    return payload


async def _resolve_client_id(ns: SidebarNamespace, sid: str, payload: JsonObject | None = None) -> str:
    candidate = _norm(payload.get("client_id")) if payload is not None else ""
    if candidate:
        return candidate
    cached = _norm(_client_ids_by_sid.get(sid))
    if cached:
        return cached
    try:
        session = await ns.get_session(sid)
    except Exception:
        session = cast(object, {})
    session_obj = _json_object(session)
    candidate = _norm(session_obj.get("clientId"))
    if candidate:
        return candidate
    return sid


async def _emit_presence(ns: SidebarNamespace, *, to_sid: str | None = None) -> None:
    payload: JsonObject = {
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


def _cwd_payload(reason: str = "sync") -> JsonObject:
    return {
        "cwd": _current_cwd(),
        "reason": str(reason or "sync"),
        "ts": int(time.time() * 1000),
    }


async def emit_sidebar_cwd_set(ns: SidebarNamespace, *, to_sid: str | None = None, reason: str = "sync") -> None:
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
    sio = cast(SidebarNamespace, UI_IPC_SIO)
    await sio.emit(
        SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
        build_jsonrpc_notification(SIDEBAR_IPC_RPC_NOTIFICATION_CWD_SET, payload),
        namespace="/sidebar_ipc",
        room="sidebar_ipc",
    )
    print(
        f"[sidebar_ipc] cwd_set(global) reason={payload.get('reason')} cwd={payload.get('cwd') or ''}",
        flush=True,
    )


async def emit_sidebar_mention_targeted(
    payload: JsonObject,
    *,
    skip_sid: str | None = None,
) -> JsonObject:
    from .sidebar_mention_routing import resolve_targeted_sidebar_mention
    from .sidebar_window_state import get_sidebar_window_state
    from .ui_ipc_socketio import UI_IPC_SIO

    live_host_client_ids = {
        client_id
        for sid, client_id in _client_ids_by_sid.items()
        if sid in _registered_hosts and client_id
    }
    registered_peer_app_ids = {
        app_id
        for sid, app_id in _app_ids_by_sid.items()
        if sid in _registered_iframes and sid != skip_sid and app_id
    }
    app_id, routed = resolve_targeted_sidebar_mention(
        payload,
        sidebar_state=_json_object(get_sidebar_window_state()),
        live_host_client_ids=live_host_client_ids,
        registered_peer_app_ids=registered_peer_app_ids,
        registered_presentations=dict(_client_presentations),
    )
    sio = cast(SidebarNamespace, UI_IPC_SIO)
    await sio.emit(
        SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
        build_jsonrpc_notification(SIDEBAR_IPC_RPC_NOTIFICATION_MENTION, routed),
        namespace="/sidebar_ipc",
        room=_app_room(app_id),
        skip_sid=skip_sid,
    )
    return {
        "ok": True,
        "app_id": app_id,
        "conversation_id": routed["conversation_id"],
        "target": routed["target"],
    }


async def update_sidebar_window_readiness_global(payload: JsonObject) -> JsonObject:
    from .sidebar_window_state import update_sidebar_window_readiness

    result = _json_object(update_sidebar_window_readiness(payload))
    await publish_sidebar_window_state_changed(
        _json_object(result.get("state", {})),
        source=_norm(payload.get("source")) or "ui_sidebar_window_readiness_update",
        sidebar_scope="global",
        readiness=result,
    )
    return result


async def handle_ui_sidebar_window_create_request(params: JsonObject) -> JsonObject:
    from .sidebar_window_state import create_sidebar_window

    body = _json_object(params)
    client_id = _norm(body.get("client_id") or body.get("clientId")) or "main_page"
    result = _json_object(create_sidebar_window(body))
    window = _json_object(result.get("window", {}))
    host_id = _norm(window.get("host_id"))
    activated: JsonObject | None = None
    if host_id and body.get("activate", True) is not False:
        _client_active_windows[client_id] = host_id
        _client_active_shortcuts[client_id] = ""
        activated = _sidebar_window_activated_payload(client_id, host_id)
        await _emit_sidebar_window_focused_global(
            client_id,
            host_id,
            source=body.get("source") or "ui_sidebar_window_create",
        )
    await publish_sidebar_window_state_changed(
        _json_object(result.get("state", {})),
        source=_norm(body.get("source")) or "ui_sidebar_window_create",
        sidebar_scope="global",
        activated_scope="client" if activated else None,
        client_id=client_id if activated else None,
        activated=activated,
    )
    return result


async def handle_ui_sidebar_window_activate_request(params: JsonObject) -> JsonObject:
    from .sidebar_window_state import activate_sidebar_window

    body = _json_object(params)
    client_id = _norm(body.get("client_id") or body.get("clientId")) or "main_page"
    result = _json_object(activate_sidebar_window(body))
    host_id = _norm(body.get("host_id") or body.get("hostId"))
    activated: JsonObject | None = None
    if host_id:
        _client_active_windows[client_id] = host_id
        _client_active_shortcuts[client_id] = ""
        activated = _sidebar_window_activated_payload(client_id, host_id)
        await _emit_sidebar_window_focused_global(
            client_id,
            host_id,
            source=body.get("source") or "ui_sidebar_window_activate",
        )
    await publish_sidebar_window_state_changed(
        _json_object(result.get("state", {})),
        source=_norm(body.get("source")) or "ui_sidebar_window_activate",
        sidebar_scope="global",
        activated_scope="client" if activated else None,
        client_id=client_id if activated else None,
        activated=activated,
    )
    return result


async def handle_ui_sidebar_window_close_request(params: JsonObject) -> JsonObject:
    from .sidebar_window_state import close_sidebar_window

    body = _json_object(params)
    client_id = _norm(body.get("client_id") or body.get("clientId")) or "main_page"
    host_id = _norm(body.get("host_id") or body.get("hostId"))
    result = _json_object(close_sidebar_window(body))
    for key in [key for key in _client_presentations if key[1] == host_id]:
        _client_presentations.pop(key, None)
    if _norm(_client_active_windows.get(client_id)) == host_id:
        _client_active_windows[client_id] = ""
    await publish_sidebar_window_state_changed(
        _json_object(result.get("state", {})),
        source=_norm(body.get("source")) or "ui_sidebar_window_close",
        sidebar_scope="global",
    )
    return result


async def handle_sidebar_window_presentation_update_request(
    ns: SidebarNamespace,
    sid: str,
    params: JsonObject,
) -> JsonObject:
    from .sidebar_window_state import activate_sidebar_window

    body = _json_object(params)
    if sid not in _registered_hosts:
        raise ValueError("presentation update requires a registered host client")
    client_id = await _resolve_client_id(ns, sid)
    host_id = _norm(body.get("host_id") or body.get("hostId"))
    presentation_id = _norm(
        body.get("presentation_id") or body.get("presentationId")
    )
    if not client_id or not host_id:
        raise ValueError("presentation update requires client and host identity")
    if len(client_id) > 512 or len(host_id) > 512 or len(presentation_id) > 512:
        raise ValueError("presentation identity is too long")
    key = (client_id, host_id)
    if not presentation_id:
        _client_presentations.pop(key, None)
        return {
            "ok": True,
            "client_id": client_id,
            "host_id": host_id,
            "registered": False,
        }
    _ = activate_sidebar_window({"host_id": host_id})
    _client_presentations[key] = presentation_id
    return {
        "ok": True,
        "client_id": client_id,
        "host_id": host_id,
        "presentation_id": presentation_id,
        "registered": True,
    }


async def handle_ui_sidebar_active_shortcut_set_request(params: JsonObject) -> JsonObject:
    body = _json_object(params)
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
        sio = cast(SidebarNamespace, UI_IPC_SIO)
        await sio.emit(
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
        sio = cast(SidebarNamespace, UI_IPC_SIO)
        await sio.emit(
            SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
            envelope,
            to=sid,
            namespace="/sidebar_ipc",
        )
        peers += 1
    if peers == 0:
        return {"ok": False, "available": False, "error": "no agent edit peer available"}
    return {"ok": True, "queued": True, "peers": peers}


async def on_sidebar_register(ns: SidebarNamespace, sid: str, data: object) -> None:
    data = _json_object(data)
    role = str(data.get("role") or "host").strip().lower()
    if role not in {"host", "iframe"}:
        role = "host"
    client_id = _norm(data.get("client_id") or data.get("clientId")) or sid
    app_id = _norm(data.get("app") or data.get("app_id") or data.get("appId"))

    await ns.enter_room(sid, "sidebar_ipc")
    await ns.enter_room(sid, _client_room(client_id))
    session: JsonObject = {"sidebarRole": role, "clientId": client_id}
    if app_id:
        session["appId"] = app_id
    await ns.save_session(sid, session)
    _client_ids_by_sid[sid] = client_id
    _app_ids_by_sid.pop(sid, None)
    if app_id:
        _app_ids_by_sid[sid] = app_id
    for alias in _app_id_aliases(app_id):
        await ns.enter_room(sid, _app_room(alias))

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
        f"[sidebar_ipc] register sid={sid} role={role} app={app_id or '-'} ts={int(time.time() * 1000)}",
        flush=True,
    )
    await _emit_presence(ns)
    await emit_sidebar_cwd_set(ns, to_sid=sid, reason="register")
    await _emit_client_state(ns, client_id, to_sid=sid)
    await _emit_sidebar_windows_changed(ns, client_id=client_id, to_sid=sid)


async def on_sidebar_disconnect(ns: SidebarNamespace, sid: str) -> None:
    removed = False
    was_host = sid in _registered_hosts
    if was_host:
        _registered_hosts.discard(sid)
        removed = True
    if sid in _registered_iframes:
        _registered_iframes.discard(sid)
        removed = True
    _agent_edit_peer_sids.discard(sid)
    client_id = _client_ids_by_sid.get(sid)
    if was_host and client_id:
        for key in [key for key in _client_presentations if key[0] == client_id]:
            _client_presentations.pop(key, None)
    _client_ids_by_sid.pop(sid, None)
    _app_ids_by_sid.pop(sid, None)
    if removed:
        await _emit_presence(ns)


async def _emit_sidebar_control_notification(ns: SidebarNamespace, notification_method: str, payload: JsonObject | None = None, *, room: str = "sidebar_ipc", skip_sid: str | None = None) -> None:
    params = _json_object(payload)
    await _emit_rpc_notification(ns, notification_method, params, room=room, skip_sid=skip_sid)


async def _emit_project_opened(ns: SidebarNamespace, payload: JsonObject, *, skip_sid: str | None = None) -> None:
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
    _ns: SidebarNamespace,
    data: JsonObject,
    *,
    source_name: str = "sidebar_ipc",
    log_prefix: str = "[sidebar_ipc] agent_open",
    request_prefix: str = "sidebar",
) -> None:
    from ..host.file_ops_backend import handle_host_open_request

    open_data = dict(data)
    if "focus" not in open_data:
        open_data["focus"] = False
    print(
        f"{log_prefix} routing via host file_ops backend",
        flush=True,
    )
    await handle_host_open_request(
        open_data,
        source_name=source_name,
        request_prefix=request_prefix,
    )


async def on_sidebar_mention(ns: SidebarNamespace, sid: str, data: object) -> JsonObject:
    """Route a typed sidebar.mention to one validated agent app target."""
    del ns
    data = _json_object(data)
    if not data:
        raise ValueError("missing mention payload")
    path = data.get("path")
    print(
        f"[sidebar_ipc] mention from={sid} path={path}",
        flush=True,
    )
    return await emit_sidebar_mention_targeted(data, skip_sid=sid)


async def _dispatch_sidebar_rpc_request(ns: SidebarNamespace, sid: str, method: str, params: JsonObject) -> object:
    if method == SIDEBAR_IPC_RPC_METHOD_REGISTER:
        await on_sidebar_register(ns, sid, params)
        return {"ok": True}
    if method == SIDEBAR_IPC_RPC_METHOD_CWD_GET:
        payload = _cwd_payload("request")
        print(f"[sidebar_ipc_rpc] cwd_get from={sid} cwd={payload.get('cwd') or ''}", flush=True)
        return payload
    if method == SIDEBAR_IPC_RPC_METHOD_CWD_SYNC:
        reason = _norm(params.get("reason"))
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
        return await on_sidebar_mention(ns, sid, params)
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
        result_obj = _json_object(result)
        if result_obj.get("ok") is True:
            await _emit_project_opened(ns, result_obj)
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_PROJECT_CREATE:
        from ..host.project_backend import handle_sidebar_project_create_request

        result = await handle_sidebar_project_create_request(
            params,
            source_name="sidebar_ipc_rpc",
        )
        result_obj = _json_object(result)
        if result_obj.get("ok") is True and "resolved_path" in result_obj:
            await _emit_project_opened(ns, result_obj)
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_LAUNCHER_CATALOG_GET:
        from .sidebar_window_state import list_launcher_apps

        return {"ok": True, "apps": list_launcher_apps()}
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOWS_LIST:
        from .sidebar_window_state import get_sidebar_window_state

        return get_sidebar_window_state()
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOW_CREATE:
        from .sidebar_window_state import create_sidebar_window

        client_id = await _resolve_client_id(ns, sid, params)
        result = create_sidebar_window(params)
        result_obj = _json_object(result)
        window = _json_object(result_obj.get("window", {}))
        host_id = _norm(window.get("host_id"))
        create_activated: JsonObject | None = None
        if host_id and params.get("activate", True) is not False:
            _client_active_windows[client_id] = host_id
            _client_active_shortcuts[client_id] = ""
            create_activated = _sidebar_window_activated_payload(client_id, host_id)
            await _emit_sidebar_window_focused_global(
                client_id,
                host_id,
                source=params.get("source") or "sidebar_window_create",
                skip_sid=sid,
            )
            await _emit_client_state(ns, client_id, skip_sid=sid)
        await publish_sidebar_window_state_changed(
            _json_object(result_obj.get("state", {})),
            source=_norm(params.get("source")) or "sidebar_window_create",
            sidebar_scope="client",
            activated_scope="client" if create_activated else None,
            client_id=client_id,
            activated=create_activated,
            skip_sidebar_sid=sid,
        )
        return result
    if method in {SIDEBAR_IPC_RPC_METHOD_WINDOW_OPEN_URL, SIDEBAR_IPC_RPC_METHOD_WINDOW_STATE_UPDATE}:
        from .sidebar_window_state import open_sidebar_window_url

        client_id = await _resolve_client_id(ns, sid, params)
        result = open_sidebar_window_url(params)
        result_obj = _json_object(result)
        window = _json_object(result_obj.get("window", {}))
        host_id = _norm(window.get("host_id"))
        state_update_activated: JsonObject | None = None
        if host_id and params.get("activate", False):
            _client_active_windows[client_id] = host_id
            _client_active_shortcuts[client_id] = ""
            state_update_activated = _sidebar_window_activated_payload(client_id, host_id)
            await _emit_sidebar_window_focused_global(
                client_id,
                host_id,
                source=params.get("source") or "sidebar_window_state_update",
                skip_sid=sid,
            )
            await _emit_client_state(ns, client_id, skip_sid=sid)
        await publish_sidebar_window_state_changed(
            _json_object(result_obj.get("state", {})),
            source=_norm(params.get("source")) or "sidebar_window_state_update",
            sidebar_scope="global",
            activated_scope="client" if state_update_activated else None,
            client_id=client_id if state_update_activated else None,
            activated=state_update_activated,
            skip_sidebar_sid=sid if state_update_activated else None,
        )
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOW_ACTIVATE:
        from .sidebar_window_state import activate_sidebar_window

        client_id = await _resolve_client_id(ns, sid, params)
        result = activate_sidebar_window(params)
        host_id = _norm(params.get("host_id") or params.get("hostId"))
        _client_active_windows[client_id] = host_id
        _client_active_shortcuts[client_id] = ""
        activate_activated = _sidebar_window_activated_payload(client_id, host_id)
        await _emit_sidebar_window_focused_global(
            client_id,
            host_id,
            source=params.get("source") or "sidebar_window_activate",
            skip_sid=sid,
        )
        await _emit_client_state(ns, client_id, skip_sid=sid)
        await publish_sidebar_window_state_changed(
            _json_object(_json_object(result).get("state", {})),
            source=_norm(params.get("source")) or "sidebar_window_activate",
            sidebar_scope="client",
            activated_scope="client",
            client_id=client_id,
            activated=activate_activated,
            skip_sidebar_sid=sid,
        )
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOW_PRESENTATION_UPDATE:
        return await handle_sidebar_window_presentation_update_request(
            ns, sid, params
        )
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOW_CLOSE:
        from .sidebar_window_state import close_sidebar_window

        client_id = await _resolve_client_id(ns, sid, params)
        result = close_sidebar_window(params)
        host_id = _norm(params.get("host_id") or params.get("hostId"))
        for key in [key for key in _client_presentations if key[1] == host_id]:
            _client_presentations.pop(key, None)
        if _norm(_client_active_windows.get(client_id)) == host_id:
            _client_active_windows[client_id] = ""
            await _emit_client_state(ns, client_id, skip_sid=sid)
        await publish_sidebar_window_state_changed(
            _json_object(_json_object(result).get("state", {})),
            source=_norm(params.get("source")) or "sidebar_window_close",
            sidebar_scope="global",
            skip_sidebar_sid=sid,
        )
        return result
    if method == SIDEBAR_IPC_RPC_METHOD_WINDOW_READINESS_UPDATE:
        from .sidebar_window_state import update_sidebar_window_readiness

        result = update_sidebar_window_readiness(params)
        result_obj = _json_object(result)
        await publish_sidebar_window_state_changed(
            _json_object(result_obj.get("state", {})),
            source=_norm(params.get("source")) or "sidebar_window_readiness_update",
            sidebar_scope="global",
            readiness=result_obj,
            skip_sidebar_sid=sid,
        )
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


async def _dispatch_sidebar_rpc_notification(ns: SidebarNamespace, sid: str, method: str, params: JsonObject) -> None:
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
        _ = await on_sidebar_mention(ns, sid, params)
        return
    if method == SIDEBAR_IPC_RPC_NOTIFICATION_CWD_SET:
        await emit_sidebar_cwd_set(ns, reason=_norm(params.get("reason")) or "authoritative")
        return
    # Presence/client-state/file-open notifications are backend-owned; ignore client copies.


async def on_sidebar_rpc(ns: SidebarNamespace, sid: str, data: object) -> object | None:
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
