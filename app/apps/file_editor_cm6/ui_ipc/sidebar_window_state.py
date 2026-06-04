# pyright: basic
from __future__ import annotations

import hashlib
import secrets
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.extensions.apps import loader as apps_loader

from ..stores import get_preferences_store

SIDEBAR_WINDOW_STATE_PREF_KEY = "sidebarWindowState"
SIDEBAR_WINDOW_STATE_VERSION = 1
ALLOWED_READINESS_STATUSES = {"starting", "ready", "error", "stopped"}

JsonObject = dict[str, object]


def _now_ms() -> int:
    return int(time.time() * 1000)


def _norm(value: object) -> str:
    return str(value or "").strip()


def _as_object(value: object) -> JsonObject:
    if isinstance(value, dict):
        return {str(key): item for key, item in value.items() if isinstance(key, str)}
    return {}


def _as_list(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def _as_int(value: object, default: int = 0) -> int:
    if not isinstance(value, (int, float, str)):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_bool(value: object, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return default


def _new_instance_id() -> str:
    return secrets.token_hex(8)


def _empty_state() -> JsonObject:
    return {
        "version": SIDEBAR_WINDOW_STATE_VERSION,
        "active_host_id": "",
        "order": ["launcher"],
        "slots": {},
        "updated_at": 0,
    }


def _iter_app_manifests() -> list[JsonObject]:
    loaded = [
        dict(manifest)
        for manifest in apps_loader.get_loaded_apps()
        if isinstance(manifest, dict)
    ]
    if loaded:
        return loaded
    try:
        return [app_def.to_payload() for app_def in apps_loader.get_app_registry().list_apps()]
    except Exception:
        return []


def _app_manifest(app_id: str) -> JsonObject | None:
    safe_app_id = _norm(app_id)
    if not safe_app_id:
        return None
    for manifest in _iter_app_manifests():
        if _norm(manifest.get("id")) != safe_app_id:
            continue
        return dict(manifest)
    return None


def _manifest_sidebar_state(manifest: JsonObject | None) -> JsonObject:
    sidebar_state = (manifest or {}).get("sidebar_state") if isinstance(manifest, dict) else None
    if isinstance(sidebar_state, dict):
        return dict(sidebar_state)
    return {}


def _is_stateful_manifest(manifest: JsonObject | None) -> bool:
    sidebar_state = _manifest_sidebar_state(manifest)
    return bool(sidebar_state) and sidebar_state.get("enabled") is not False


def _stateful_manifest(app_id: str) -> JsonObject | None:
    manifest = _app_manifest(app_id)
    if manifest is None:
        return None
    sidebar_state = manifest.get("sidebar_state")
    if isinstance(sidebar_state, dict) and sidebar_state.get("enabled") is not False:
        return {**manifest, "sidebar_state": dict(sidebar_state)}
    return None


def _launcher_app_catalog_entry(manifest: JsonObject) -> JsonObject:
    app_id = _norm(manifest.get("id"))
    sidebar_state = _manifest_sidebar_state(manifest)
    stateful = _is_stateful_manifest(manifest)
    base_url = _manifest_base_url(app_id, manifest)
    entry: JsonObject = {
        "id": app_id,
        "name": _norm(manifest.get("name")) or app_id,
        "description": _norm(manifest.get("description")),
        "icon_src": _norm(manifest.get("icon_src")),
        "icon_text": _norm(manifest.get("icon_text")),
        "icon_emoji": _norm(manifest.get("icon_emoji")),
        "asset_base_url": _norm(manifest.get("asset_base_url")),
        "_dir": _norm(manifest.get("_dir")),
        "base_url": base_url,
        "baseUrl": base_url,
        "stateful": stateful,
        "sidebar_state": sidebar_state if stateful else {"enabled": False},
        "launch_url": base_url,
        "embed_url": f"{base_url}?embed=1",
    }
    if stateful:
        entry.update({
            "console_worker_prefix": _console_worker_prefix(app_id, manifest),
            "token_id_param": _token_id_param(manifest),
            "console_worker_id_param": _console_worker_id_param(manifest),
        })
    return entry


def _stateful_app_catalog_entry(manifest: JsonObject) -> JsonObject:
    entry = _launcher_app_catalog_entry(manifest)
    if not _as_bool(entry.get("stateful")):
        return {}
    return entry


def list_launcher_apps() -> list[JsonObject]:
    apps: list[JsonObject] = []
    for manifest in _iter_app_manifests():
        app_id = _norm(manifest.get("id"))
        if not app_id:
            continue
        apps.append(_launcher_app_catalog_entry(dict(manifest)))
    apps.sort(key=lambda item: _norm(item.get("name")).lower())
    return apps


def list_stateful_apps() -> list[JsonObject]:
    apps: list[JsonObject] = []
    for manifest in _iter_app_manifests():
        sidebar_state = manifest.get("sidebar_state")
        if isinstance(sidebar_state, dict) and sidebar_state.get("enabled") is not False:
            entry = _stateful_app_catalog_entry({**manifest, "sidebar_state": sidebar_state})
            if entry:
                apps.append(entry)
    apps.sort(key=lambda item: _norm(item.get("name")).lower())
    return apps


def _derive_token_id(app_id: str, url: str) -> str:
    key = f"{app_id}\0{url}".encode("utf-8", "replace")
    return hashlib.sha256(key).hexdigest()[:16]


def _lane_from_params(params: JsonObject) -> JsonObject:
    return _as_object(params.get("lane"))


def _app_id_from_params(params: JsonObject) -> str:
    lane = _lane_from_params(params)
    return _norm(params.get("app_id") or params.get("appId") or lane.get("app_id") or lane.get("appId"))


def _base_url_from_params(params: JsonObject) -> str:
    lane = _lane_from_params(params)
    return _norm(params.get("base_url") or params.get("baseUrl") or lane.get("base_url") or lane.get("baseUrl"))


def _manifest_base_url(app_id: str, manifest: JsonObject | None) -> str:
    sidebar_state = _as_object((manifest or {}).get("sidebar_state"))
    base_url = _norm(sidebar_state.get("base_url") or (manifest or {}).get("base_url"))
    return base_url or f"/app/{app_id}"


def _console_worker_prefix(app_id: str, manifest: JsonObject | None) -> str:
    sidebar_state = _as_object((manifest or {}).get("sidebar_state"))
    return _norm(sidebar_state.get("console_worker_prefix") or sidebar_state.get("token_id") or app_id) or app_id


def _token_id_param(manifest: JsonObject | None) -> str:
    sidebar_state = _as_object((manifest or {}).get("sidebar_state"))
    return _norm(sidebar_state.get("token_id_param")) or "te2_token_id"


def _host_id_param(manifest: JsonObject | None) -> str:
    sidebar_state = _as_object((manifest or {}).get("sidebar_state"))
    return _norm(sidebar_state.get("host_id_param")) or "te2_host_id"


def _console_worker_id_param(manifest: JsonObject | None) -> str:
    sidebar_state = _as_object((manifest or {}).get("sidebar_state"))
    return _norm(sidebar_state.get("console_worker_id_param")) or "te2_console_worker_id"


def _default_token_id(app_id: str, manifest: JsonObject | None) -> str:
    return _console_worker_prefix(app_id, manifest)


def _derive_console_worker_id(app_id: str, manifest: JsonObject | None, url: str) -> str:
    return f"{_console_worker_prefix(app_id, manifest)}:{_derive_token_id(app_id, url)}"


def _icon_from_manifest(manifest: JsonObject | None) -> JsonObject:
    if not isinstance(manifest, dict):
        return {"kind": "text", "text": "APP"}
    icon_src = _norm(manifest.get("icon_src"))
    if icon_src:
        return {"kind": "image", "src": icon_src}
    icon_text = _norm(manifest.get("icon_text"))
    if icon_text:
        return {"kind": "text", "text": icon_text}
    icon_emoji = _norm(manifest.get("icon_emoji"))
    if icon_emoji:
        return {"kind": "emoji", "emoji": icon_emoji}
    name = _norm(manifest.get("name")) or _norm(manifest.get("id")) or "App"
    return {"kind": "text", "text": name[:2].upper()}


def _validate_state_url(app_id: str, raw_url: str, base_url: str | None = None) -> str:
    url = _norm(raw_url)
    if not url:
        raise ValueError("url is required")
    split = urlsplit(url)
    if split.scheme or split.netloc:
        raise ValueError("state URL must be same-origin relative")
    expected_path = urlsplit(_norm(base_url) or f"/app/{app_id}").path or f"/app/{app_id}"
    if split.path != expected_path:
        raise ValueError(f"state URL path must be {expected_path}")
    return urlunsplit(("", "", split.path, split.query, split.fragment))


def _with_url_params(raw_url: str, params: dict[str, str]) -> str:
    split = urlsplit(raw_url or "/")
    query = dict(parse_qsl(split.query, keep_blank_values=True))
    for key, value in params.items():
        if key and value:
            query[key] = value
    return urlunsplit((split.scheme, split.netloc, split.path, urlencode(query), split.fragment))


def _reserved_query_keys(manifest: JsonObject | None = None) -> set[str]:
    return {
        "embed",
        "te2_readiness_delay_ms",
        "readiness_delay_ms",
        _host_id_param(manifest),
        _token_id_param(manifest),
        _console_worker_id_param(manifest),
    }


def _normalize_query_state(value: object, manifest: JsonObject | None = None) -> JsonObject:
    raw = _as_object(value)
    if not raw:
        return {}
    reserved = _reserved_query_keys(manifest)
    normalized: JsonObject = {}
    for key, item in raw.items():
        safe_key = _norm(key)
        if not safe_key or safe_key in reserved:
            continue
        if isinstance(item, (str, int, float, bool)):
            normalized[safe_key] = item
    return normalized


def _query_state_from_url(raw_url: str, manifest: JsonObject | None = None) -> JsonObject:
    query = dict(parse_qsl(urlsplit(raw_url).query, keep_blank_values=True))
    return _normalize_query_state(query, manifest)


def _query_state_from_params(params: JsonObject, raw_url: str = "", manifest: JsonObject | None = None) -> JsonObject:
    explicit = _normalize_query_state(params.get("query_state") or params.get("queryState"), manifest)
    if explicit:
        return explicit
    state_kind = _norm(params.get("state_kind") or params.get("stateKind") or params.get("kind"))
    if state_kind == "path" and _norm(params.get("path")):
        return {"path": _norm(params.get("path"))}
    if raw_url:
        return _query_state_from_url(raw_url, manifest)
    return {}


def _build_window_url(
    app_id: str,
    manifest: JsonObject | None,
    params: JsonObject,
    host_id: str,
    token_id: str,
    console_worker_id: str = "",
) -> str:
    base_url = _manifest_base_url(app_id, manifest)
    declared_base_url = _base_url_from_params(params)
    if declared_base_url and urlsplit(declared_base_url).path != urlsplit(base_url).path:
        raise ValueError(f"base_url must be {base_url}")
    raw_url = _norm(params.get("url")) or f"{base_url}?embed=1"
    query_params = {
        key: str(value)
        for key, value in _query_state_from_params(params, "", manifest).items()
        if _norm(value)
    }
    query_params.update({
        "embed": "1",
        _host_id_param(manifest): host_id,
        _token_id_param(manifest): token_id,
    })
    if console_worker_id:
        query_params[_console_worker_id_param(manifest)] = console_worker_id
    delay_ms = _norm(params.get("te2_readiness_delay_ms") or params.get("readiness_delay_ms"))
    if delay_ms:
        query_params["te2_readiness_delay_ms"] = delay_ms
    return _validate_state_url(app_id, _with_url_params(raw_url, query_params), base_url)


def _normalize_readiness(value: object) -> JsonObject:
    raw = _as_object(value)
    status = (_norm(raw.get("status")) or "starting").lower()
    if status == "loading":
        status = "starting"
    if status not in ALLOWED_READINESS_STATUSES:
        status = "ready" if status in {"ok", "up", "serving"} else "error"
    normalized: JsonObject = {
        "status": status,
        "updated_at": _as_int(raw.get("updated_at") or raw.get("updatedAt"), _now_ms()),
    }
    for key in ("phase", "message", "console_worker_id", "consoleWorkerId", "source"):
        item = raw.get(key)
        if item is not None:
            normalized[key] = item
    details = raw.get("details")
    if isinstance(details, dict):
        normalized["details"] = dict(details)
    return normalized


def _host_id_for(app_id: str, token_id: str) -> str:
    return f"slot:{app_id}:{token_id}"


def _normalize_slot(raw: JsonObject) -> JsonObject:
    app_id = _norm(raw.get("app_id") or raw.get("appId"))
    host_id = _norm(raw.get("host_id") or raw.get("hostId"))
    url = _norm(raw.get("url"))
    if not app_id or not host_id or not url:
        return {}
    base_url = _norm(raw.get("base_url") or raw.get("baseUrl")) or f"/app/{app_id}"
    url = _validate_state_url(app_id, url, base_url)
    restore_url = _norm(raw.get("restore_url") or raw.get("restoreUrl")) or url
    restore_url = _validate_state_url(app_id, restore_url, base_url)
    token_id = _norm(raw.get("token_id") or raw.get("tokenId"))
    console_worker_id = _norm(raw.get("console_worker_id") or raw.get("consoleWorkerId"))
    console_worker_prefix = _norm(raw.get("console_worker_prefix") or raw.get("consoleWorkerPrefix"))
    state_kind = _norm(raw.get("state_kind") or raw.get("stateKind"))
    query_state = _query_state_from_params(raw, restore_url)
    stateful = _as_bool(raw.get("stateful"), bool(token_id or console_worker_id or console_worker_prefix))
    title = _norm(raw.get("title")) or _norm(raw.get("label")) or app_id
    load = _norm(raw.get("load")) or "eager"
    if load not in {"lazy", "eager"}:
        load = "eager"
    created_at = _as_int(raw.get("created_at") or raw.get("createdAt"), _now_ms())
    updated_at = _as_int(raw.get("updated_at") or raw.get("updatedAt"), created_at)
    icon = raw.get("icon")
    if not isinstance(icon, dict):
        icon = {}
    slot: JsonObject = {
        "kind": "app",
        "app_id": app_id,
        "appId": app_id,
        "base_url": base_url,
        "baseUrl": base_url,
        "stateful": stateful,
        "host_id": host_id,
        "hostId": host_id,
        "title": title,
        "label": title,
        "url": url,
        "restore_url": restore_url,
        "restoreUrl": restore_url,
        "load": load,
        "icon": icon,
        "created_at": created_at,
        "createdAt": created_at,
        "updated_at": updated_at,
        "updatedAt": updated_at,
        "version": _norm(raw.get("version")),
    }
    if stateful or token_id:
        slot["token_id"] = token_id
        slot["tokenId"] = token_id
    if stateful or console_worker_id:
        slot["console_worker_id"] = console_worker_id
        slot["consoleWorkerId"] = console_worker_id
    if stateful or console_worker_prefix:
        slot["console_worker_prefix"] = console_worker_prefix
        slot["consoleWorkerPrefix"] = console_worker_prefix
    if stateful or state_kind:
        slot["state_kind"] = state_kind
        slot["stateKind"] = state_kind
    if query_state:
        slot["query_state"] = query_state
        slot["queryState"] = query_state
    if stateful or raw.get("readiness") is not None:
        slot["readiness"] = _normalize_readiness(raw.get("readiness"))
    return slot


def _read_raw_pref_state() -> JsonObject:
    try:
        prefs = get_preferences_store().get_preferences()
        ui = prefs.get("ui") if isinstance(prefs, dict) else {}
        raw_state = ui.get(SIDEBAR_WINDOW_STATE_PREF_KEY) if isinstance(ui, dict) else {}
    except Exception:
        raw_state = {}
    return _as_object(raw_state)


def _load_pref_state() -> JsonObject:
    raw_state = _read_raw_pref_state()
    state = _empty_state()
    slots: dict[str, object] = {}

    raw_slots = raw_state.get("slots")
    if isinstance(raw_slots, dict):
        for key, value in raw_slots.items():
            slot = _normalize_slot(_as_object(value))
            host_id = _norm(slot.get("host_id")) or _norm(key)
            if not slot or not host_id:
                continue
            slots[host_id] = slot

    # One-time compatibility migration from the earlier draft array shape.
    if not slots:
        for item in _as_list(raw_state.get("windows")):
            slot = _normalize_slot(_as_object(item))
            host_id = _norm(slot.get("host_id"))
            if slot and host_id:
                slots[host_id] = slot

    raw_order = [_norm(item) for item in _as_list(raw_state.get("order")) if _norm(item)]
    order: list[str] = ["launcher"]
    for item in raw_order:
        if item == "launcher" or item in order:
            continue
        if item.startswith("url:") or item in slots:
            order.append(item)
    for host_id in slots:
        if host_id not in order:
            order.append(host_id)

    active = _norm(raw_state.get("active_host_id") or raw_state.get("activeHostId"))
    if active and active not in slots:
        active = ""

    state.update({
        "active_host_id": active,
        "order": order,
        "slots": slots,
        "updated_at": _as_int(raw_state.get("updated_at") or raw_state.get("updatedAt"), 0),
    })
    return state


def _save_pref_state(state: JsonObject) -> JsonObject:
    raw_slots = _as_object(state.get("slots"))
    slots: dict[str, object] = {}
    for key, value in raw_slots.items():
        slot = _normalize_slot(_as_object(value))
        host_id = _norm(slot.get("host_id")) or _norm(key)
        if slot and host_id:
            slots[host_id] = slot

    order: list[str] = ["launcher"]
    for item in [_norm(value) for value in _as_list(state.get("order")) if _norm(value)]:
        if item == "launcher" or item in order:
            continue
        if item.startswith("url:") or item in slots:
            order.append(item)
    for host_id in slots:
        if host_id not in order:
            order.append(host_id)

    active = _norm(state.get("active_host_id") or state.get("activeHostId"))
    if active and active not in slots:
        active = ""

    payload: JsonObject = {
        "version": SIDEBAR_WINDOW_STATE_VERSION,
        "active_host_id": active,
        "order": order,
        "slots": slots,
        "updated_at": _now_ms(),
    }
    get_preferences_store().update_preferences(ui={SIDEBAR_WINDOW_STATE_PREF_KEY: payload})
    return payload


def get_sidebar_window_state(active_host_id: str | None = None) -> JsonObject:
    state = _load_pref_state()
    slots = _as_object(state.get("slots"))
    active = _norm(active_host_id) or _norm(state.get("active_host_id"))
    if active and active not in slots:
        active = ""
    return {
        "version": SIDEBAR_WINDOW_STATE_VERSION,
        "active_host_id": active,
        "activeHostId": active,
        "order": list(_as_list(state.get("order"))),
        "slots": dict(slots),
        "catalog": list_launcher_apps(),
        "ts": _now_ms(),
    }


def _upsert_slot(state: JsonObject, slot: JsonObject, *, activate: bool = True) -> JsonObject:
    normalized = _normalize_slot(slot)
    if not normalized:
        raise ValueError("invalid sidebar slot")
    host_id = _norm(normalized.get("host_id"))
    raw_slots = _as_object(state.get("slots"))
    existing = _as_object(raw_slots.get(host_id))
    if existing:
        normalized = _normalize_slot({
            **existing,
            **normalized,
            "created_at": existing.get("created_at") or normalized.get("created_at"),
        })
    raw_slots[host_id] = normalized
    state["slots"] = raw_slots
    order = [_norm(item) for item in _as_list(state.get("order")) if _norm(item)] or ["launcher"]
    if "launcher" not in order:
        order.insert(0, "launcher")
    if host_id not in order:
        order.append(host_id)
    state["order"] = order
    state["updated_at"] = _now_ms()
    if activate:
        state["active_host_id"] = host_id
    return state


def create_sidebar_window(params: JsonObject) -> JsonObject:
    app_id = _app_id_from_params(params)
    manifest = _app_manifest(app_id)
    if manifest is None:
        raise ValueError(f"unknown app: {app_id or '(missing)'}")
    stateful = _is_stateful_manifest(manifest)
    now = _now_ms()
    base_url = _manifest_base_url(app_id, manifest)
    title = _norm(params.get("title") or params.get("label")) or _norm(manifest.get("name")) or app_id
    load = _norm(params.get("load")) or ("eager" if stateful else "lazy")
    slot: JsonObject = {
        "kind": "app",
        "app_id": app_id,
        "base_url": base_url,
        "stateful": stateful,
        "title": title,
        "label": title,
        "load": load,
        "icon": _icon_from_manifest(manifest),
        "created_at": now,
        "updated_at": now,
    }
    if stateful:
        raw_url = _norm(params.get("url")) or f"{base_url}?embed=1"
        token_id = _norm(params.get("token_id") or params.get("tokenId")) or _default_token_id(app_id, manifest)
        instance_id = _norm(params.get("instance_id") or params.get("instanceId")) or _new_instance_id()
        console_worker_prefix = _console_worker_prefix(app_id, manifest)
        console_worker_id = (
            _norm(params.get("console_worker_id") or params.get("consoleWorkerId"))
            or f"{console_worker_prefix}:{instance_id}"
        )
        host_id = _norm(params.get("host_id") or params.get("hostId")) or _host_id_for(app_id, console_worker_id or token_id)
        url = _build_window_url(app_id, manifest, {**params, "url": raw_url}, host_id, token_id, console_worker_id)
        slot.update({
            "host_id": host_id,
            "token_id": token_id,
            "console_worker_prefix": console_worker_prefix,
            "console_worker_id": console_worker_id,
            "state_kind": _norm(params.get("state_kind") or params.get("stateKind") or params.get("kind")) or "url",
            "query_state": _query_state_from_params(params, url, manifest),
            "url": url,
            "restore_url": url,
            "readiness": {"status": "starting", "phase": "created", "updated_at": now},
        })
    else:
        raw_url = _norm(params.get("url")) or base_url
        host_id = _norm(params.get("host_id") or params.get("hostId")) or _host_id_for(app_id, "base")
        slot.update({
            "host_id": host_id,
            "state_kind": "base_url",
            "url": _validate_state_url(app_id, raw_url, base_url),
            "restore_url": _validate_state_url(app_id, raw_url, base_url),
        })
    state = _upsert_slot(_load_pref_state(), slot, activate=bool(params.get("activate", True)))
    saved = _save_pref_state(state)
    window = _normalize_slot(slot)
    return {"ok": True, "window": window, "slot": window, "state": get_sidebar_window_state(_norm(saved.get("active_host_id")))}


def open_sidebar_window_url(params: JsonObject) -> JsonObject:
    app_id = _app_id_from_params(params)
    manifest = _stateful_manifest(app_id)
    if manifest is None:
        raise ValueError(f"app does not declare sidebar_state: {app_id or '(missing)'}")
    state = _load_pref_state()
    token_id = _norm(params.get("token_id") or params.get("tokenId"))
    console_worker_id = _norm(params.get("console_worker_id") or params.get("consoleWorkerId"))
    host_id = (
        _norm(params.get("host_id") or params.get("hostId"))
        or _host_id_for(app_id, console_worker_id or token_id or _default_token_id(app_id, manifest))
    )
    existing_slot = _as_object(_as_object(state.get("slots")).get(host_id))
    if not console_worker_id:
        console_worker_id = _norm(existing_slot.get("console_worker_id") or existing_slot.get("consoleWorkerId"))
    if not token_id:
        token_id = _norm(existing_slot.get("token_id") or existing_slot.get("tokenId")) or _default_token_id(app_id, manifest)
    restore_url = _build_window_url(app_id, manifest, params, host_id, token_id, console_worker_id)
    now = _now_ms()
    current_url = _norm(existing_slot.get("url")) or restore_url
    query_state = _query_state_from_params(params, restore_url, manifest)
    if "readiness" in params:
        readiness = _normalize_readiness(params.get("readiness"))
    else:
        readiness = _normalize_readiness(existing_slot.get("readiness")) if existing_slot else _normalize_readiness(None)
    if console_worker_id:
        readiness["console_worker_id"] = console_worker_id
    base_url = _manifest_base_url(app_id, manifest)
    title = _norm(params.get("title") or params.get("label")) or _norm(manifest.get("name")) or app_id
    slot: JsonObject = {
        "kind": "app",
        "host_id": host_id,
        "app_id": app_id,
        "base_url": base_url,
        "token_id": token_id,
        "console_worker_prefix": _console_worker_prefix(app_id, manifest),
        "console_worker_id": console_worker_id,
        "state_kind": _norm(params.get("state_kind") or params.get("stateKind") or params.get("kind")) or "url",
        "title": title,
        "label": title,
        "query_state": query_state,
        "url": current_url,
        "restore_url": restore_url,
        "load": _norm(params.get("load")) or "eager",
        "icon": _icon_from_manifest(manifest),
        "readiness": readiness,
        "updated_at": now,
        "created_at": _as_int(params.get("created_at"), now),
    }
    state = _upsert_slot(state, slot, activate=bool(params.get("activate", False)))
    saved = _save_pref_state(state)
    window = _normalize_slot(slot)
    return {"ok": True, "window": window, "slot": window, "state": get_sidebar_window_state(_norm(saved.get("active_host_id")))}


def activate_sidebar_window(params: JsonObject) -> JsonObject:
    host_id = _norm(params.get("host_id") or params.get("hostId"))
    if not host_id:
        raise ValueError("host_id is required")
    state = _load_pref_state()
    slots = _as_object(state.get("slots"))
    if host_id not in slots:
        raise ValueError(f"unknown sidebar window: {host_id}")
    state["active_host_id"] = host_id
    _save_pref_state(state)
    return {"ok": True, "host_id": host_id, "state": get_sidebar_window_state(host_id)}


def close_sidebar_window(params: JsonObject) -> JsonObject:
    host_id = _norm(params.get("host_id") or params.get("hostId"))
    if not host_id:
        raise ValueError("host_id is required")
    state = _load_pref_state()
    slots = _as_object(state.get("slots"))
    slots.pop(host_id, None)
    order = [_norm(item) for item in _as_list(state.get("order")) if _norm(item) and _norm(item) != host_id]
    if "launcher" not in order:
        order.insert(0, "launcher")
    state["slots"] = slots
    state["order"] = order
    if _norm(state.get("active_host_id")) == host_id:
        next_active = next((item for item in order if item != "launcher" and item in slots), "")
        state["active_host_id"] = next_active
    _save_pref_state(state)
    return {"ok": True, "closed": host_id, "state": get_sidebar_window_state(_norm(state.get("active_host_id")))}


def update_sidebar_window_readiness(params: JsonObject) -> JsonObject:
    host_id = _norm(params.get("host_id") or params.get("hostId"))
    if not host_id:
        raise ValueError("host_id is required")
    state = _load_pref_state()
    slots = _as_object(state.get("slots"))
    slot = _normalize_slot(_as_object(slots.get(host_id)))
    if not slot:
        raise ValueError(f"unknown sidebar window: {host_id}")
    readiness = _normalize_readiness(params.get("readiness") or params)
    console_worker_id = _norm(params.get("console_worker_id") or params.get("consoleWorkerId"))
    if console_worker_id:
        readiness["console_worker_id"] = console_worker_id
        slot["console_worker_id"] = console_worker_id
        slot["consoleWorkerId"] = console_worker_id
    if params.get("url"):
        app_id = _norm(slot.get("app_id") or params.get("app_id") or params.get("appId"))
        base_url = _norm(slot.get("base_url") or slot.get("baseUrl"))
        restore_url = _validate_state_url(app_id, _norm(params.get("url")), base_url)
        slot["restore_url"] = restore_url
        slot["restoreUrl"] = restore_url
        query_state = _query_state_from_params(params, restore_url)
        if query_state:
            slot["query_state"] = query_state
            slot["queryState"] = query_state
    if params.get("token_id") or params.get("tokenId"):
        token_id = _norm(params.get("token_id") or params.get("tokenId"))
        slot["token_id"] = token_id
        slot["tokenId"] = token_id
    slot["readiness"] = readiness
    slot["updated_at"] = _now_ms()
    slot["updatedAt"] = slot["updated_at"]
    slots[host_id] = _normalize_slot(slot)
    state["slots"] = slots
    _save_pref_state(state)
    updated = _normalize_slot(slot)
    return {"ok": True, "window": updated, "slot": updated, "state": get_sidebar_window_state(_norm(state.get("active_host_id")))}
