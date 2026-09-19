# pyright: strict
"""Editor bootstrap and result policy, independent of socket addressing/encoding."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, Protocol, cast

from ..open_state_backend import SidecarOpenStatePayload
from .editor_rpc_contract import (
    EDITOR_RPC_METHOD_DRAFT_DIFF_GET,
    EDITOR_RPC_METHOD_GIT_BASELINES_GET,
    EDITOR_RPC_METHOD_JUMP_TO_LINE,
    EDITOR_RPC_NOTIFICATION_ADAPTER_STATE,
    EDITOR_RPC_NOTIFICATION_DRAFT_DIFF,
    EDITOR_RPC_NOTIFICATION_FILE_JUMP_TO_LINE,
    EDITOR_RPC_NOTIFICATION_GIT_BASELINES,
    EDITOR_RPC_NOTIFICATION_STATE_SSOT,
    EditorRpcNotification,
    JsonRpcId,
)


@dataclass(frozen=True)
class EditorNotification:
    # "connection" is the requesting presentation; "client" includes its peers.
    # Neither the application policy nor DTO carries a Socket.IO SID/room name.
    recipient: Literal["connection", "client"]
    method: EditorRpcNotification
    params: dict[str, object]


class SnapshotReader(Protocol):
    def __call__(self, *, client_instance_id: str, client_role: str) -> dict[str, object]: ...


class OpenStatePublisher(Protocol):
    async def __call__(self, payload: SidecarOpenStatePayload, /, *, source: str) -> None: ...


DeliverNotification = Callable[[EditorNotification], Awaitable[None]]
DeliverResult = Callable[[JsonRpcId, object], Awaitable[None]]


async def bootstrap_editor_session(
    *,
    client_instance_id: str,
    client_role: str,
    read_snapshot: SnapshotReader,
    read_adapter_state: Callable[[], dict[str, object]],
    publish_open_state: OpenStatePublisher,
    deliver: DeliverNotification,
) -> None:
    # Bootstrap ordering is application policy, not a transport lifecycle hook.
    # Only the initial snapshot is mandatory; retain existing best-effort extras.
    snapshot = read_snapshot(client_instance_id=client_instance_id, client_role=client_role)
    await deliver(EditorNotification("connection", EDITOR_RPC_NOTIFICATION_STATE_SSOT, snapshot))
    open_state = snapshot.get("openState")
    try:
        await deliver(EditorNotification("connection", EDITOR_RPC_NOTIFICATION_ADAPTER_STATE, read_adapter_state()))
    except Exception:
        pass
    if isinstance(open_state, dict):
        try:
            await publish_open_state(cast(SidecarOpenStatePayload, cast(object, open_state)), source="rpc_connect")
        except Exception:
            pass


async def publish_editor_result(
    *,
    method: str,
    request_id: JsonRpcId,
    result: object,
    deliver: DeliverNotification,
    reply: DeliverResult,
) -> None:
    # Some responses also update sibling editor presentations. Keep those pushes
    # ahead of the reply and keep draft comparison private to the requester.
    if isinstance(result, dict):
        payload = cast(dict[str, object], result)
        if method == EDITOR_RPC_METHOD_JUMP_TO_LINE:
            await deliver(EditorNotification("client", EDITOR_RPC_NOTIFICATION_FILE_JUMP_TO_LINE, payload))
        elif method == EDITOR_RPC_METHOD_GIT_BASELINES_GET:
            await deliver(EditorNotification("client", EDITOR_RPC_NOTIFICATION_GIT_BASELINES, payload))
        elif method == EDITOR_RPC_METHOD_DRAFT_DIFF_GET:
            await deliver(EditorNotification("connection", EDITOR_RPC_NOTIFICATION_DRAFT_DIFF, payload))
    await reply(request_id, cast(object, result))
