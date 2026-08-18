# pyright: strict
from __future__ import annotations

import logging

from .worker_services.event_bus import (
    JsonObject,
    WorkerEvent,
    subscribe as subscribe_worker_event,
)

logger = logging.getLogger(__name__)

_event_bus_handlers_registered = False


def register_search_highlight_event_bus_handlers() -> None:
    """Project Explorer search-highlight facts onto the editor lane."""
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    subscribe_worker_event("SearchHighlightChanged", _handle_search_highlight_event)
    _event_bus_handlers_registered = True


async def _handle_search_highlight_event(event: WorkerEvent) -> None:
    payload = _editor_payload_from_event(event)
    client_instance_id = _string(event["payload"].get("clientInstanceId"))
    if not client_instance_id:
        logger.debug("[search_highlight_events] missing client identity")
        return
    try:
        from .monaco_editor.editor_ws import emit_editor_search_highlight_from_backend

        await emit_editor_search_highlight_from_backend(
            payload,
            client_instance_id=client_instance_id,
        )
    except Exception as exc:
        logger.debug("[search_highlight_events] editor emit failed: %s", exc)


def _editor_payload_from_event(event: WorkerEvent) -> JsonObject:
    raw = event["payload"]
    active = raw.get("active") is True
    payload: JsonObject = {
        "active": active,
        "projectPath": event.get("project_root") or "",
        "projectGeneration": event.get("project_generation") or 0,
        "reason": _string(raw.get("reason")),
        "source": _string(raw.get("source")) or event["source"],
    }
    if not active:
        return payload

    payload["query"] = _string(raw.get("query"))
    payload["isRegex"] = raw.get("isRegex") is True
    payload["isCaseSensitive"] = raw.get("isCaseSensitive") is True
    payload["isWholeWords"] = raw.get("isWholeWords") is True
    return payload


def _string(value: object) -> str:
    return value if isinstance(value, str) else ""
