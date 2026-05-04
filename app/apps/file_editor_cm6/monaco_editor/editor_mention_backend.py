# pyright: strict
from __future__ import annotations

import logging
from typing import Protocol, cast

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


def _normalize_mention_payload(params: JsonObject) -> JsonObject:
    path = params.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ValueError("Missing path for editor mention")

    payload: JsonObject = {"path": path.strip(), "source": "editor"}
    for key in ("lineNo", "endLineNo", "col", "endCol", "content"):
        value = params.get(key)
        if value is not None:
            payload[key] = value
    return payload


async def handle_editor_mention_request(params: JsonObject) -> JsonObject:
    from ..ui_ipc.ui_ipc_socketio import UI_IPC_SIO

    mention_payload = _normalize_mention_payload(params)
    ui_ipc_sio = cast(SocketIOEmitter, UI_IPC_SIO)
    await ui_ipc_sio.emit(
        "sidebar:mention",
        mention_payload,
        namespace="/sidebar_ipc",
        room="sidebar_ipc",
    )
    logger.info("[editor:mention] relayed to sidebar_ipc path=%s", mention_payload["path"])
    return {"ok": True}
