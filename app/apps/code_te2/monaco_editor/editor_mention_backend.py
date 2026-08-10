# pyright: strict
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]


def _normalize_mention_payload(params: JsonObject) -> JsonObject:
    path = params.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ValueError("Missing path for editor mention")

    payload: JsonObject = {
        "path": path.strip(),
        "source": "editor",
        "target": params.get("target", {}),
    }
    for key in ("lineNo", "endLineNo", "col", "endCol", "content"):
        value = params.get(key)
        if value is not None:
            payload[key] = value
    return payload


async def handle_editor_mention_request(params: JsonObject) -> JsonObject:
    from ..ui_ipc.sidebar_ws import emit_sidebar_mention_targeted

    mention_payload = _normalize_mention_payload(params)
    result = await emit_sidebar_mention_targeted(mention_payload)
    logger.info("[editor:mention] relayed to sidebar_ipc path=%s", mention_payload["path"])
    return result
