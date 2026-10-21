# pyright: strict
from __future__ import annotations

from typing import cast
from urllib.parse import parse_qsl, urlsplit

JsonObject = dict[str, object]

MAX_ID_LENGTH = 512


def _object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _id(value: object) -> str:
    text = str(value or "").strip()
    if len(text) > MAX_ID_LENGTH:
        raise ValueError("Sidebar identity exceeds its limit")
    return text


def _app_alias(value: object) -> str:
    return _id(value).lower().replace("_", "-")


def _conversation_id(slot: JsonObject) -> str:
    query_state = _object(slot.get("query_state") or slot.get("queryState"))
    value = _id(query_state.get("conversation_id") or query_state.get("conversationId"))
    if value:
        return value
    raw_url_value = slot.get("restore_url") or slot.get("restoreUrl") or slot.get("url")
    raw_url = raw_url_value.strip() if isinstance(raw_url_value, str) else ""
    if not raw_url:
        return ""
    query = dict(parse_qsl(urlsplit(raw_url).query, keep_blank_values=True))
    return _id(query.get("conversation_id") or query.get("conversationId"))


def bind_sidebar_mention_client(payload: JsonObject, source_client: str) -> JsonObject:
    """Bind a browser mention to its own lane's registered client, not a label."""
    client_id = str(source_client or "").strip()
    target = _object(payload.get("target"))
    supplied = str(target.get("clientId") or target.get("client_id") or "").strip()
    if not client_id or supplied != client_id:
        raise ValueError("mention target client does not match requesting client")
    return {**payload, "target": {**target, "clientId": client_id, "client_id": client_id}}


def resolve_targeted_sidebar_mention(
    payload: JsonObject,
    *,
    sidebar_state: JsonObject,
    live_host_client_ids: set[str],
    registered_peer_app_ids: set[str],
    registered_presentations: dict[tuple[str, str], str],
) -> tuple[str, JsonObject]:
    raw_path = payload.get("path")
    path = raw_path.strip() if isinstance(raw_path, str) else ""
    if not path:
        raise ValueError("missing mention path")

    raw_target = _object(payload.get("target"))
    client_id = _id(raw_target.get("client_id") or raw_target.get("clientId"))
    host_id = _id(raw_target.get("host_id") or raw_target.get("hostId"))
    presentation_id = _id(
        raw_target.get("presentation_id") or raw_target.get("presentationId")
    )
    if not client_id or not host_id or not presentation_id:
        raise ValueError("mention target requires clientId, hostId, and presentationId")
    if client_id not in live_host_client_ids:
        raise ValueError("mention target client is not connected")
    if registered_presentations.get((client_id, host_id)) != presentation_id:
        raise ValueError("mention target presentation is not registered")

    slots = _object(sidebar_state.get("slots"))
    slot = _object(slots.get(host_id))
    if not slot:
        raise ValueError("mention target sidebar window is not active")
    app_id = _id(slot.get("app_id") or slot.get("appId"))
    state_kind = _id(slot.get("state_kind") or slot.get("stateKind")).lower()
    if not app_id or (
        state_kind != "conversation" and _app_alias(app_id) not in {"als", "als-rs"}
    ):
        raise ValueError("mention target is not an agent conversation")
    if _app_alias(app_id) not in {_app_alias(value) for value in registered_peer_app_ids}:
        raise ValueError("mention target app has no registered Sidebar peer")

    conversation_id = _conversation_id(slot)
    if not conversation_id:
        raise ValueError("mention target has no conversation identity")

    routed = dict(payload)
    routed["path"] = path
    routed["conversation_id"] = conversation_id
    routed["conversationId"] = conversation_id
    routed["target"] = {
        "client_id": client_id,
        "clientId": client_id,
        "host_id": host_id,
        "hostId": host_id,
        "presentation_id": presentation_id,
        "presentationId": presentation_id,
        "app_id": app_id,
        "appId": app_id,
    }
    return app_id, routed
