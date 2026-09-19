# pyright: strict
"""Ordered Sidebar window/client projections, without transport or store access."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED,
)
from .sidebar_rpc_contract import (
    SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED,
)

JsonObject = dict[str, object]
SidebarProjectionScope = Literal["client", "global"]


@dataclass(frozen=True)
class SidebarProjection:
    # Logical delivery metadata only; adapters resolve room names and wire format.
    lane: Literal["ui", "sidebar"]
    method: str
    payload: JsonObject
    scope: Literal["connection", "client", "global"] = "global"
    target: str | None = None
    exclude_connection: str | None = None


def build_client_state_projection(
    client_id: str, active_shortcut: str | None, *, timestamp_ms: int,
    connection: str | None = None, exclude_connection: str | None = None,
) -> SidebarProjection:
    safe_id = str(client_id or "").strip()
    payload: JsonObject = {
        "client_id": safe_id, "clientId": safe_id,
        "activeShortcutId": str(active_shortcut or "").strip(), "ts": timestamp_ms,
    }
    return SidebarProjection(
        "sidebar", SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE, payload,
        "connection" if connection else "client", connection or safe_id,
        None if connection else exclude_connection,
    )


def build_window_snapshot_projection(
    state: JsonObject, *, client_id: str | None = None,
    connection: str | None = None, exclude_connection: str | None = None,
) -> tuple[SidebarProjection, ...]:
    # Registration/direct snapshots always reach UI first, including empty state.
    return (
        SidebarProjection("ui", UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED, state),
        SidebarProjection(
            "sidebar", SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED, state,
            "connection" if connection else "client" if client_id else "global",
            connection or client_id, None if connection else exclude_connection,
        ),
    )


def build_window_change_projection(
    state: JsonObject, *, scope: SidebarProjectionScope,
    activated_scope: SidebarProjectionScope, client_id: str | None,
    activated: JsonObject, readiness: JsonObject, exclude_connection: str | None,
) -> tuple[SidebarProjection, ...]:
    # Ledger facts retain activation -> readiness -> state ordering. Each UI
    # delivery precedes its Sidebar peer. Readiness is always global, and a
    # missing client keeps the established all-client fallback for ledger facts.
    if not state:
        return ()
    result: list[SidebarProjection] = []
    updates = (
        (activated, UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED,
         SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED, activated_scope),
        (readiness, UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED,
         SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED, "global"),
        (state, UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
         SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED, scope),
    )
    for payload, ui_method, sidebar_method, target_scope in updates:
        if not payload:
            continue
        result.append(SidebarProjection("ui", ui_method, payload))
        result.append(SidebarProjection(
            "sidebar", sidebar_method, payload,
            "client" if target_scope == "client" and client_id else "global",
            client_id, exclude_connection,
        ))
    return tuple(result)
