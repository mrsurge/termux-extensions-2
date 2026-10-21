"""Sidebar service policy; framework relay metadata is not UI focus authority."""
from __future__ import annotations

from typing import cast

from ..sidebar_window_events import publish_sidebar_window_state_changed
from ..ui_ipc.sidebar_window_state import get_sidebar_window_state, open_sidebar_window_url

JsonObject = dict[str, object]
CALLERS = {"terminal", "file_explorer", "file_editor"}


def _object(value: object) -> JsonObject:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError("Sidebar service requires an object")
    return cast(JsonObject, value)


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _matching_aliases(params: JsonObject, keys: tuple[str, ...], expected: str) -> None:
    for key in keys:
        if key in params and params[key] != expected:
            raise ValueError(f"Sidebar {key} does not match its owner")


async def dispatch_sidebar_service(value: object) -> JsonObject:
    body = _object(value)
    if set(body) != {"service", "version", "method", "context", "payload", "source"}:
        raise ValueError("Invalid Sidebar service envelope")
    if body["service"] != "sidebar" or type(body["version"]) is not int or body["version"] != 1:
        raise ValueError("Unsupported Sidebar service version")
    source = _object(body["source"])
    app_id = _text(source.get("appId"))
    if set(source) != {"appId", "shellId"} or app_id not in CALLERS or not _text(source.get("shellId")):
        raise ValueError("Missing framework-derived Sidebar caller")
    # These are backend facts, not per-client foreground requests.
    if body["context"] not in (None, {}):
        raise ValueError("Sidebar fact publication does not accept presentation authority")
    params = dict(_object(body["payload"]))
    if body["method"] == "cwd.get":
        if params or app_id not in {"terminal", "file_explorer"}:
            raise ValueError("Invalid Sidebar CWD request")
        from ..ui_ipc.sidebar_ws import get_sidebar_cwd_snapshot
        return get_sidebar_cwd_snapshot("request")
    if body["method"] != "window.state.update":
        raise ValueError("Unsupported Sidebar service method")
    if params.get("activate", False) is not False:
        raise ValueError("Backend state publication cannot activate a client window")
    _matching_aliases(params, ("app_id", "appId"), app_id)
    lane = _object(params.get("lane", {}))
    _matching_aliases(lane, ("app_id", "appId"), app_id)
    host_id = _text(params.get("host_id") or params.get("hostId"))
    if not host_id:
        raise ValueError("Sidebar slot identity is required")
    _matching_aliases(params, ("host_id", "hostId"), host_id)
    slots = _object(get_sidebar_window_state().get("slots"))
    slot = _object(slots.get(host_id, {}))
    if not slot or slot.get("app_id") != app_id:
        raise ValueError("Sidebar slot does not belong to this app")
    token_id = _text(slot.get("token_id"))
    _matching_aliases(params, ("token_id", "tokenId"), token_id)
    base_url = _text(slot.get("base_url"))
    _matching_aliases(params, ("base_url", "baseUrl"), base_url)
    _matching_aliases(lane, ("base_url", "baseUrl"), base_url)
    params.update(app_id=app_id, host_id=host_id, token_id=token_id, activate=False)
    # Reuse the ledger owner and its normal global projection, without fake SIDs
    # or changes to per-client foreground/presentation registrations.
    result = open_sidebar_window_url(params)
    await publish_sidebar_window_state_changed(
        _object(result["state"]), source=f"{app_id}_pipe_state", sidebar_scope="global",
    )
    return result
