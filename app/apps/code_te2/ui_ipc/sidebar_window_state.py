# pyright: basic
from __future__ import annotations

import hashlib
import re
import secrets
import time
from typing import cast
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.extensions.apps.registry import AppRegistry

from ..stores import get_preferences_store

SIDEBAR_WINDOW_STATE_PREF_KEY = "sidebarWindowState"
SIDEBAR_WINDOW_STATE_VERSION = 2
ALLOWED_READINESS_STATUSES = {"starting", "ready", "error", "stopped"}
RUN_TARGET_TICKET_RE = re.compile(r"^[0-9a-f]{64}$")
LEGACY_CODE_TE2_IDENTITY_RE = re.compile(
    r"(?<![A-Za-z0-9_])file_editor_cm6(?![A-Za-z0-9_])"
)
CODE_TE2_IDENTITY_FIELDS = {
    "app_id",
    "appId",
    "host_id",
    "hostId",
    "base_url",
    "baseUrl",
    "url",
    "restore_url",
    "restoreUrl",
    "originalUrl",
    "token_id",
    "tokenId",
    "console_worker_id",
    "consoleWorkerId",
    "console_worker_prefix",
    "consoleWorkerPrefix",
}

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
        "slots": {},
        "updated_at": 0,
    }


def _canonicalize_code_te2_identity(value: str) -> str:
    return LEGACY_CODE_TE2_IDENTITY_RE.sub("code_te2", value)


def _canonicalize_legacy_code_te2_slot(
    raw: JsonObject,
) -> tuple[JsonObject, bool]:
    changed = False

    def visit(value: object) -> object:
        nonlocal changed
        if isinstance(value, dict):
            result: JsonObject = {}
            for key, item in value.items():
                safe_key = str(key)
                if safe_key in CODE_TE2_IDENTITY_FIELDS and isinstance(item, str):
                    canonical = _canonicalize_code_te2_identity(item)
                    changed = changed or canonical != item
                    result[safe_key] = canonical
                elif isinstance(item, (dict, list)):
                    result[safe_key] = visit(item)
                else:
                    result[safe_key] = item
            return result
        if isinstance(value, list):
            return [visit(item) if isinstance(item, (dict, list)) else item for item in value]
        return value

    return _as_object(visit(raw)), changed


def _iter_app_manifests() -> list[JsonObject]:
    try:
        registry = AppRegistry()
        return [app_def.to_payload() for app_def in registry.reload()]
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


def _validate_url_slot_url(raw_url: str) -> str:
    url = _norm(raw_url)
    if not url:
        raise ValueError("url is required")
    split = urlsplit(url)
    scheme = split.scheme.lower()
    if scheme and scheme not in {"http", "https"}:
        raise ValueError("URL slot must use http, https, or a relative URL")
    if split.netloc and not scheme:
        raise ValueError("absolute URL slots must include http:// or https://")
    if scheme:
        return urlunsplit(
            (scheme, split.netloc, split.path or "/", split.query, split.fragment)
        )
    return urlunsplit(("", "", split.path, split.query, split.fragment))


def _normalize_run_target_descriptor(
    value: object,
    *,
    canonical_url: str | None,
    require_label: bool,
) -> JsonObject:
    raw = _as_object(value)
    if not raw:
        return {}
    ticket = _norm(raw.get("ticket"))
    tunnel_path = _norm(raw.get("tunnelPath") or raw.get("tunnel_path"))
    preferred_port = _as_int(raw.get("preferredPort") or raw.get("preferred_port"))
    original_url = _validate_url_slot_url(
        _norm(raw.get("originalUrl") or raw.get("original_url"))
    )
    expires_at = _as_int(raw.get("expiresAt") or raw.get("expires_at"))
    if not RUN_TARGET_TICKET_RE.fullmatch(ticket):
        raise ValueError("runTargetRoute ticket is invalid")
    if tunnel_path != f"/api/run-targets/{ticket}/tunnel":
        raise ValueError("runTargetRoute tunnelPath is invalid")
    if preferred_port < 1 or preferred_port > 65535:
        raise ValueError("runTargetRoute preferredPort is invalid")
    if canonical_url is not None and original_url != canonical_url:
        raise ValueError("runTargetRoute originalUrl must match the Sidebar URL")
    route: JsonObject = {
        "dto": "RunTargetRoute",
        "version": 1,
        "ticket": ticket,
        "tunnelPath": tunnel_path,
        "preferredPort": preferred_port,
        "originalUrl": original_url,
        "expiresAt": expires_at,
    }
    if require_label:
        label = _norm(raw.get("label"))
        if not label:
            raise ValueError("runTargetRoute auxiliary label is required")
        route["label"] = label
    return route


def _normalize_run_target_route(value: object, *, canonical_url: str) -> JsonObject:
    raw = _as_object(value)
    if not raw:
        return {}
    if _norm(raw.get("dto")) != "RunTargetRouteSet" and "primary" not in raw:
        return _normalize_run_target_descriptor(
            raw,
            canonical_url=canonical_url,
            require_label=False,
        )

    relay_group_id = _norm(raw.get("relayGroupId") or raw.get("relay_group_id"))
    owner_id = _norm(raw.get("ownerId") or raw.get("owner_id"))
    shell_id = _norm(raw.get("shellId") or raw.get("shell_id"))
    if not RUN_TARGET_TICKET_RE.fullmatch(relay_group_id):
        raise ValueError("runTargetRoute relayGroupId is invalid")
    if not owner_id or not shell_id:
        raise ValueError("runTargetRoute ownerId and shellId are required")
    primary = _normalize_run_target_descriptor(
        raw.get("primary"),
        canonical_url=canonical_url,
        require_label=False,
    )
    if relay_group_id != _norm(primary.get("ticket")):
        raise ValueError("runTargetRoute relayGroupId must identify the primary route")
    additional_obj = raw.get("additional")
    additional_values = (
        cast(list[object], additional_obj) if isinstance(additional_obj, list) else []
    )
    if len(additional_values) > 8:
        raise ValueError("runTargetRoute supports at most 8 auxiliary routes")
    seen_ports = {_as_int(primary.get("preferredPort"))}
    additional: list[object] = []
    for item in additional_values:
        route = _normalize_run_target_descriptor(
            item,
            canonical_url=None,
            require_label=True,
        )
        port = _as_int(route.get("preferredPort"))
        if port in seen_ports:
            raise ValueError(f"runTargetRoute contains duplicate port {port}")
        seen_ports.add(port)
        additional.append(route)
    return {
        "dto": "RunTargetRouteSet",
        "version": 1,
        "ownerId": owner_id,
        "shellId": shell_id,
        "relayGroupId": relay_group_id,
        "primary": primary,
        "additional": additional,
    }


def _normalize_run_profile_surface(value: object, *, canonical_url: str) -> JsonObject:
    raw = _as_object(value)
    if not raw:
        return {}
    if _norm(raw.get("dto")) != "RunProfileSurface" or _as_int(raw.get("version")) != 1:
        raise ValueError("runProfileSurface contract is invalid")
    surface_id = _norm(raw.get("surfaceId") or raw.get("surface_id"))
    project_path = _norm(raw.get("projectPath") or raw.get("project_path"))
    profile_id = _norm(raw.get("profileId") or raw.get("profile_id"))
    runner = _norm(raw.get("runner"))
    shell_id = _norm(raw.get("shellId") or raw.get("shell_id"))
    shell_label = _norm(raw.get("shellLabel") or raw.get("shell_label"))
    url = _validate_url_slot_url(_norm(raw.get("url")))
    if not all((surface_id, project_path, profile_id, runner, shell_id, shell_label)):
        raise ValueError("runProfileSurface identity is incomplete")
    if runner not in {"pagePreview", "node", "python", "custom"}:
        raise ValueError("runProfileSurface runner is invalid")
    if url != canonical_url:
        raise ValueError("runProfileSurface URL must match the Sidebar URL")
    return {
        "dto": "RunProfileSurface",
        "version": 1,
        "surfaceId": surface_id,
        "projectPath": project_path,
        "profileId": profile_id,
        "runner": runner,
        "shellId": shell_id,
        "shellLabel": shell_label,
        "url": url,
        "devRuntime": _as_bool(raw.get("devRuntime") or raw.get("dev_runtime")),
        "refreshRevision": max(
            0,
            _as_int(raw.get("refreshRevision") or raw.get("refresh_revision")),
        ),
    }


def _normalize_extension_webview_surface(
    value: object,
    *,
    canonical_url: str,
) -> JsonObject:
    raw = _as_object(value)
    if not raw:
        return {}
    if (
        _norm(raw.get("dto")) != "ExtensionWebviewSurface"
        or _as_int(raw.get("version")) != 1
    ):
        raise ValueError("webviewSurface contract is invalid")
    surface_id = _norm(raw.get("surfaceId") or raw.get("surface_id"))
    host_id = _norm(raw.get("hostId") or raw.get("host_id"))
    workspace_id = _norm(raw.get("workspaceId") or raw.get("workspace_id"))
    project_path = _norm(raw.get("projectPath") or raw.get("project_path"))
    extension_id = _norm(raw.get("extensionId") or raw.get("extension_id"))
    view_id = _norm(raw.get("viewId") or raw.get("view_id"))
    url = _validate_url_slot_url(_norm(raw.get("url")))
    if not all(
        (
            surface_id,
            host_id,
            workspace_id,
            project_path,
            extension_id,
            view_id,
        )
    ):
        raise ValueError("webviewSurface identity is incomplete")
    if url != canonical_url:
        raise ValueError("webviewSurface URL must match the Sidebar URL")
    return {
        "dto": "ExtensionWebviewSurface",
        "version": 1,
        "surfaceId": surface_id,
        "hostId": host_id,
        "workspaceId": workspace_id,
        "projectPath": project_path,
        "extensionId": extension_id,
        "viewId": view_id,
        "url": url,
    }


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


def _url_host_id() -> str:
    return f"url:{secrets.token_hex(8)}"


def _normalize_url_slot(raw: JsonObject) -> JsonObject:
    host_id = _norm(raw.get("host_id") or raw.get("hostId"))
    url = _validate_url_slot_url(
        _norm(raw.get("url") or raw.get("restore_url") or raw.get("restoreUrl"))
    )
    if not host_id or not url:
        return {}
    title = _norm(raw.get("title")) or _norm(raw.get("label")) or "URL"
    load = _norm(raw.get("load")) or "lazy"
    if load not in {"lazy", "eager"}:
        load = "lazy"
    created_at = _as_int(raw.get("created_at") or raw.get("createdAt"), _now_ms())
    updated_at = _as_int(raw.get("updated_at") or raw.get("updatedAt"), created_at)
    icon = raw.get("icon")
    if not isinstance(icon, dict):
        icon = {"kind": "text", "text": "URL"}
    query_state = _normalize_query_state(
        raw.get("query_state") or raw.get("queryState") or raw.get("state")
    )
    query_state["url"] = url
    raw_dev_tools = (
        raw.get("dev_tools") if "dev_tools" in raw else raw.get("devTools")
    )
    dev_tools = _as_bool(raw_dev_tools, False)
    devtools_target_id = _norm(
        raw.get("devtools_target_id") or raw.get("devToolsTargetId")
    )
    devtools_target_label = _norm(
        raw.get("devtools_target_label") or raw.get("devToolsTargetLabel")
    )
    if dev_tools and not devtools_target_id:
        raise ValueError("devTools URL slots require devToolsTargetId")
    slot: JsonObject = {
        "kind": "url",
        "host_id": host_id,
        "hostId": host_id,
        "title": title,
        "label": title,
        "url": url,
        "restore_url": url,
        "restoreUrl": url,
        "load": load,
        "icon": icon,
        "state_kind": "url",
        "stateKind": "url",
        "query_state": query_state,
        "queryState": query_state,
        "state": {"url": url},
        "created_at": created_at,
        "createdAt": created_at,
        "updated_at": updated_at,
        "updatedAt": updated_at,
        "version": _norm(raw.get("version")),
        "dev_tools": dev_tools,
        "devTools": dev_tools,
    }
    if dev_tools:
        slot.update(
            {
                "dev_tools": True,
                "devTools": True,
                "devtools_target_id": devtools_target_id,
                "devToolsTargetId": devtools_target_id,
                "devtools_target_label": devtools_target_label or title,
                "devToolsTargetLabel": devtools_target_label or title,
            }
        )
    route_value = raw.get("run_target_route") or raw.get("runTargetRoute")
    if route_value is not None:
        route = _normalize_run_target_route(route_value, canonical_url=url)
        slot["run_target_route"] = route
        slot["runTargetRoute"] = route
    surface_value = raw.get("run_profile_surface") or raw.get("runProfileSurface")
    if surface_value is not None:
        surface = _normalize_run_profile_surface(surface_value, canonical_url=url)
        slot["run_profile_surface"] = surface
        slot["runProfileSurface"] = surface
    webview_surface_value = raw.get("webview_surface") or raw.get("webviewSurface")
    if webview_surface_value is not None:
        webview_surface = _normalize_extension_webview_surface(
            webview_surface_value,
            canonical_url=url,
        )
        slot["webview_surface"] = webview_surface
        slot["webviewSurface"] = webview_surface
    return slot


def _normalize_slot(raw: JsonObject) -> JsonObject:
    kind = _norm(raw.get("kind")).lower()
    if kind == "url":
        return _normalize_url_slot(raw)
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
    explicit_query_state = "query_state" in raw or "queryState" in raw
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
    if query_state or explicit_query_state:
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
    migrated_legacy_identity = False

    raw_slots = raw_state.get("slots")
    if isinstance(raw_slots, dict):
        entries: list[tuple[bool, str, object]] = []
        for key, value in raw_slots.items():
            safe_key = _norm(key)
            canonical_key = _canonicalize_code_te2_identity(safe_key)
            key_migrated = canonical_key != safe_key
            entries.append((key_migrated, canonical_key, value))
        # Canonical records win when both identities are present.
        entries.sort(key=lambda item: item[0])
        for key_migrated, canonical_key, value in entries:
            canonical_raw, value_migrated = _canonicalize_legacy_code_te2_slot(
                _as_object(value)
            )
            migrated_legacy_identity = (
                migrated_legacy_identity or key_migrated or value_migrated
            )
            slot = _normalize_slot(canonical_raw)
            host_id = _norm(slot.get("host_id")) or canonical_key
            if not slot or not host_id:
                continue
            if host_id in slots and (key_migrated or value_migrated):
                continue
            slots[host_id] = slot

    # One-time compatibility migration from the earlier draft array shape.
    if not slots:
        for item in _as_list(raw_state.get("windows")):
            canonical_raw, value_migrated = _canonicalize_legacy_code_te2_slot(
                _as_object(item)
            )
            migrated_legacy_identity = migrated_legacy_identity or value_migrated
            slot = _normalize_slot(canonical_raw)
            host_id = _norm(slot.get("host_id"))
            if slot and host_id:
                slots[host_id] = slot

    state.update({
        "slots": slots,
        "updated_at": _as_int(raw_state.get("updated_at") or raw_state.get("updatedAt"), 0),
    })
    if migrated_legacy_identity:
        try:
            return _save_pref_state(state)
        except Exception:
            pass
    return state


def _save_pref_state(state: JsonObject) -> JsonObject:
    raw_slots = _as_object(state.get("slots"))
    slots: dict[str, object] = {}
    for key, value in raw_slots.items():
        slot = _normalize_slot(_as_object(value))
        host_id = _norm(slot.get("host_id")) or _norm(key)
        if slot and host_id:
            slots[host_id] = slot

    payload: JsonObject = {
        "version": SIDEBAR_WINDOW_STATE_VERSION,
        "slots": slots,
        "updated_at": _now_ms(),
    }
    get_preferences_store().update_preferences(ui={SIDEBAR_WINDOW_STATE_PREF_KEY: payload})
    return payload


def get_sidebar_window_state() -> JsonObject:
    state = _load_pref_state()
    slots = _as_object(state.get("slots"))
    return {
        "version": SIDEBAR_WINDOW_STATE_VERSION,
        "slots": dict(slots),
        "catalog": list_launcher_apps(),
        "ts": _now_ms(),
    }


def _upsert_slot(state: JsonObject, slot: JsonObject) -> JsonObject:
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
    state["updated_at"] = _now_ms()
    return state


def create_sidebar_window(params: JsonObject) -> JsonObject:
    kind = _norm(params.get("kind")).lower()
    if kind == "url":
        now = _now_ms()
        url = _validate_url_slot_url(
            _norm(
                params.get("url")
                or params.get("restore_url")
                or params.get("restoreUrl")
            )
        )
        host_id = _norm(params.get("host_id") or params.get("hostId")) or _url_host_id()
        label = _norm(params.get("title") or params.get("label")) or "URL"
        url_slot: JsonObject = {
            "kind": "url",
            "host_id": host_id,
            "hostId": host_id,
            "title": label,
            "label": label,
            "url": url,
            "restore_url": url,
            "restoreUrl": url,
            "load": _norm(params.get("load")) or "lazy",
            "icon": (
                _as_object(params.get("icon"))
                if isinstance(params.get("icon"), dict)
                else {"kind": "text", "text": "URL"}
            ),
            "state_kind": "url",
            "stateKind": "url",
            "query_state": {"url": url},
            "queryState": {"url": url},
            "state": {"url": url},
            "created_at": now,
            "updated_at": now,
            "version": _norm(params.get("version")),
        }
        raw_dev_tools = (
            params.get("dev_tools")
            if "dev_tools" in params
            else params.get("devTools")
        )
        dev_tools = _as_bool(raw_dev_tools, False)
        url_slot.update({"dev_tools": dev_tools, "devTools": dev_tools})
        if dev_tools:
            target_id = _norm(
                params.get("devtools_target_id") or params.get("devToolsTargetId")
            )
            target_label = _norm(
                params.get("devtools_target_label")
                or params.get("devToolsTargetLabel")
            ) or label
            url_slot.update(
                {
                    "devtools_target_id": target_id,
                    "devToolsTargetId": target_id,
                    "devtools_target_label": target_label,
                    "devToolsTargetLabel": target_label,
                }
            )
        route_value = params.get("run_target_route") or params.get("runTargetRoute")
        if route_value is not None:
            route = _normalize_run_target_route(route_value, canonical_url=url)
            url_slot["run_target_route"] = route
            url_slot["runTargetRoute"] = route
        surface_value = params.get("run_profile_surface") or params.get("runProfileSurface")
        if surface_value is not None:
            surface = _normalize_run_profile_surface(surface_value, canonical_url=url)
            url_slot["run_profile_surface"] = surface
            url_slot["runProfileSurface"] = surface
        webview_surface_value = params.get("webview_surface") or params.get("webviewSurface")
        if webview_surface_value is not None:
            webview_surface = _normalize_extension_webview_surface(
                webview_surface_value,
                canonical_url=url,
            )
            url_slot["webview_surface"] = webview_surface
            url_slot["webviewSurface"] = webview_surface
        state = _upsert_slot(_load_pref_state(), url_slot)
        _save_pref_state(state)
        window = _normalize_slot(url_slot)
        return {
            "ok": True,
            "window": window,
            "slot": window,
            "state": get_sidebar_window_state(),
        }

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
    state = _upsert_slot(_load_pref_state(), slot)
    _save_pref_state(state)
    window = _normalize_slot(slot)
    return {"ok": True, "window": window, "slot": window, "state": get_sidebar_window_state()}


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
    state = _upsert_slot(state, slot)
    _save_pref_state(state)
    window = _normalize_slot(slot)
    return {"ok": True, "window": window, "slot": window, "state": get_sidebar_window_state()}


def activate_sidebar_window(params: JsonObject) -> JsonObject:
    host_id = _norm(params.get("host_id") or params.get("hostId"))
    if not host_id:
        raise ValueError("host_id is required")
    state = _load_pref_state()
    slots = _as_object(state.get("slots"))
    if host_id not in slots:
        raise ValueError(f"unknown sidebar window: {host_id}")
    return {"ok": True, "host_id": host_id, "state": get_sidebar_window_state()}


def close_sidebar_window(params: JsonObject) -> JsonObject:
    host_id = _norm(params.get("host_id") or params.get("hostId"))
    if not host_id:
        raise ValueError("host_id is required")
    state = _load_pref_state()
    slots = _as_object(state.get("slots"))
    slots.pop(host_id, None)
    state["slots"] = slots
    _save_pref_state(state)
    return {"ok": True, "closed": host_id, "state": get_sidebar_window_state()}


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
    return {"ok": True, "window": updated, "slot": updated, "state": get_sidebar_window_state()}
