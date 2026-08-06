# pyright: strict
from __future__ import annotations

import logging
from typing import cast

from ..context import ExplorerIntegrationHandlerContext

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]


async def handle_cm6_mirror(
    context: ExplorerIntegrationHandlerContext,
    params: JsonObject,
    msg_id: str | None,
) -> None:
    del params
    if msg_id:
        await context.emit_personal("explorer.cm6.mirror.ack", {"ok": True}, msg_id)


async def handle_mention_agent(
    context: ExplorerIntegrationHandlerContext,
    params: JsonObject,
    msg_id: str | None,
) -> None:
    del msg_id
    try:
        from ...ui_ipc.sidebar_ws import emit_sidebar_mention_targeted

        path = cast(str, params["path"])
        mention_payload: JsonObject = {
            "path": path,
            "source": "explorer",
            "target": params.get("target", {}),
        }
        for key in ("lineNo", "endLineNo", "col", "endCol", "content"):
            value = params.get(key)
            if value is not None:
                mention_payload[key] = value

        _ = await emit_sidebar_mention_targeted(mention_payload)
        logger.info("[mention:agent] relayed to sidebar_ipc path=%s", path)
    except Exception as exc:
        logger.warning("[mention:agent] relay failed: %s", exc)
        raise RuntimeError(f"Mention relay failed: {exc}") from exc

    del context


async def handle_pulse_alive(
    context: ExplorerIntegrationHandlerContext,
    params: JsonObject,
    msg_id: str | None,
) -> None:
    del context, params, msg_id
