# pyright: strict
from __future__ import annotations

import logging
from typing import Protocol, cast

from ..context import ExplorerIntegrationHandlerContext

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]


class SocketIOEmitter(Protocol):
    async def emit(
        self,
        event: str,
        data: object,
        *,
        room: str | None = None,
        namespace: str | None = None,
    ) -> None: ...


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
        from ...ui_ipc.ui_ipc_socketio import UI_IPC_SIO

        ui_ipc_sio = cast(SocketIOEmitter, UI_IPC_SIO)
        path = cast(str, params["path"])
        mention_payload: JsonObject = {"path": path, "source": "explorer"}
        for key in ("lineNo", "endLineNo", "col", "endCol", "content"):
            value = params.get(key)
            if value is not None:
                mention_payload[key] = value

        await ui_ipc_sio.emit(
            "sidebar:mention",
            mention_payload,
            namespace="/sidebar_ipc",
            room="sidebar_ipc",
        )
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
