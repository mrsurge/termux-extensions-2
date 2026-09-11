from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from ..client_presentation import normalize_client_instance_id

JsonObject = dict[str, object]


def _object(value: object) -> JsonObject:
    if not isinstance(value, Mapping):
        return {}
    mapping = cast(Mapping[object, object], value)
    return {str(key): item for key, item in mapping.items()}


def _text(value: object) -> str:
    return str(value or "").strip()


def _app_aliases(value: object) -> set[str]:
    app_id = _text(value)
    if not app_id:
        return set()
    aliases = {app_id}
    if "-" in app_id:
        aliases.add(app_id.replace("-", "_"))
    if "_" in app_id:
        aliases.add(app_id.replace("_", "-"))
    return aliases


def resolve_sidebar_file_open_target(
    payload: JsonObject,
    *,
    sidebar_state: JsonObject,
    live_host_client_ids: set[str],
    registered_presentations: dict[tuple[str, str], str],
    active_windows: dict[str, str],
    requester_app_id: str,
) -> tuple[str, JsonObject]:
    target = _object(payload.get("target"))
    client_id = normalize_client_instance_id(
        target.get("client_id") or target.get("clientId")
    )
    host_id = _text(target.get("host_id") or target.get("hostId"))
    if client_id is None or not host_id:
        raise ValueError("file open target requires client and host identity")
    if client_id not in live_host_client_ids:
        raise ValueError("file open target client is not connected")
    if _text(active_windows.get(client_id)) != host_id:
        raise ValueError("file open target window is not active")

    presentation_id = _text(registered_presentations.get((client_id, host_id)))
    if not presentation_id:
        raise ValueError("file open target presentation is not registered")

    slots = _object(sidebar_state.get("slots"))
    slot = _object(slots.get(host_id))
    slot_app_id = _text(slot.get("app_id") or slot.get("appId"))
    if not slot or not (_app_aliases(slot_app_id) & _app_aliases(requester_app_id)):
        raise ValueError("file open target does not belong to requester app")

    routed = dict(payload)
    routed["target"] = {
        "client_id": client_id,
        "clientId": client_id,
        "host_id": host_id,
        "hostId": host_id,
        "presentation_id": presentation_id,
        "presentationId": presentation_id,
    }
    return client_id, routed


__all__ = ["resolve_sidebar_file_open_target"]
