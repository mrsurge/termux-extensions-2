# pyright: strict
from __future__ import annotations

import asyncio
import unittest
from typing import override
from unittest.mock import patch

from app.apps.code_te2.ui_ipc.sidebar_projection_service import (
    SidebarProjection, build_client_state_projection,
    build_window_snapshot_projection, build_window_change_projection,
)
from app.apps.code_te2.ui_ipc import sidebar_projection_transport as transport
from app.apps.code_te2.ui_ipc import sidebar_ws
from app.apps.code_te2.ui_ipc import notifications
from app.apps.code_te2 import sidebar_window_events as events
from app.apps.code_te2.worker_services.event_bus import build_event
from app.apps.code_te2.ui_ipc.sidebar_rpc_contract import (
    SIDEBAR_IPC_RPC_NOTIFICATION_EVENT,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED, SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED,
)
from app.apps.code_te2.ui_ipc.rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED,
)

JsonObject = dict[str, object]


class RecordingNamespace:
    def __init__(self) -> None:
        self.records: list[JsonObject] = []
        self.failure: BaseException | None = None

    async def emit(self, event: str, data: object | None = None, *, to: str | None = None,
                   room: str | None = None, skip_sid: str | None = None, namespace: str | None = None) -> None:
        self.records.append({"event": event, "data": data, "to": to, "room": room,
                             "skip_sid": skip_sid, "namespace": namespace})
        if self.failure is not None:
            raise self.failure

    async def enter_room(self, sid: str, room: str) -> None:
        del sid, room

    async def save_session(self, sid: str, session: JsonObject) -> None:
        del sid, session

    async def get_session(self, sid: str) -> object:
        del sid
        return {}


class SidebarProjectionTests(unittest.TestCase):
    def test_fact_order_and_scopes(self) -> None:
        state: JsonObject = {"slots": {}}
        activated: JsonObject = {"hostId": "h"}
        readiness: JsonObject = {"ready": True}
        projections = build_window_change_projection(
            state, scope="client", activated_scope="global", client_id="c",
            activated=activated, readiness=readiness, exclude_connection="sender",
        )
        self.assertEqual([(p.lane, p.method, p.scope) for p in projections], [
            ("ui", UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED, "global"),
            ("sidebar", SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED, "global"),
            ("ui", UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED, "global"),
            ("sidebar", SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED, "global"),
            ("ui", UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED, "global"),
            ("sidebar", SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED, "client"),
        ])
        self.assertEqual([p.exclude_connection for p in projections], [None, "sender"] * 3)
        self.assertIs(projections[-1].payload, state)

    def test_missing_fact_client_falls_back_and_empty_fact_is_ignored(self) -> None:
        for client in (None, ""):
            projections = build_window_change_projection(
                {"slots": {}}, scope="client", activated_scope="client", client_id=client,
                activated={}, readiness={}, exclude_connection=None,
            )
            self.assertEqual(len(projections), 2)
            self.assertEqual(projections[-1].scope, "global")
        self.assertEqual(build_window_change_projection(
            {}, scope="global", activated_scope="global", client_id=None,
            activated={"hostId": "h"}, readiness={}, exclude_connection=None,
        ), ())

    def test_direct_snapshot_prioritizes_connection_and_includes_empty_state(self) -> None:
        projections = build_window_snapshot_projection({}, client_id="c", connection="s", exclude_connection="s")
        self.assertEqual(len(projections), 2)
        self.assertEqual(projections[-1].scope, "connection")
        self.assertEqual(projections[-1].target, "s")
        self.assertIsNone(projections[-1].exclude_connection)
        self.assertEqual(build_window_snapshot_projection({}, client_id="c")[-1].scope, "client")
        self.assertEqual(build_window_snapshot_projection({})[-1].scope, "global")

    def test_client_state_normalization_and_timestamp(self) -> None:
        projection = build_client_state_projection(" c ", " shortcut ", timestamp_ms=123, exclude_connection="s")
        self.assertEqual(projection.payload, {"client_id": "c", "clientId": "c", "activeShortcutId": "shortcut", "ts": 123})
        self.assertEqual((projection.scope, projection.target, projection.exclude_connection), ("client", "c", "s"))
        direct = build_client_state_projection("c", None, timestamp_ms=124, connection="s", exclude_connection="s")
        self.assertEqual((direct.scope, direct.target, direct.exclude_connection), ("connection", "s", None))


class SidebarProjectionAdapterTests(unittest.IsolatedAsyncioTestCase):
    @override
    def __init__(self, methodName: str = "runTest") -> None:
        super().__init__(methodName)
        self.ns: RecordingNamespace = RecordingNamespace()
        self.ui: list[tuple[str, JsonObject]] = []

    async def record_ui(self, method: str, payload: JsonObject) -> None:
        self.ui.append((method, payload))

    async def test_direct_adapter_target_room_and_exclusion(self) -> None:
        with patch.object(notifications, "emit_ui_ipc_rpc_notification", self.record_ui):
            for projection in build_window_snapshot_projection({"slots": {}}, client_id=" c ", exclude_connection="s"):
                await sidebar_ws._deliver_direct_projection(self.ns, projection)  # pyright: ignore[reportPrivateUsage]
        self.assertEqual(len(self.ui), 1)
        self.assertEqual(self.ns.records[0]["room"], "sidebar:client:c")
        self.assertEqual(self.ns.records[0]["skip_sid"], "s")
        self.assertEqual(self.ns.records[0]["event"], SIDEBAR_IPC_RPC_NOTIFICATION_EVENT)
        self.assertEqual(self.ns.records[0]["data"], {"jsonrpc": "2.0", "method": SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED, "params": {"slots": {}}})
        projection = build_client_state_projection("c", None, timestamp_ms=1, connection="s", exclude_connection="s")
        await sidebar_ws._deliver_direct_projection(self.ns, projection)  # pyright: ignore[reportPrivateUsage]
        self.assertEqual(self.ns.records[-1]["to"], "s")
        self.assertIsNone(self.ns.records[-1]["skip_sid"])

    async def test_direct_ui_failure_stops_sidebar_delivery(self) -> None:
        async def fail(method: str, payload: JsonObject) -> None:
            del method, payload
            raise RuntimeError("UI failed")
        with (
            patch.object(notifications, "emit_ui_ipc_rpc_notification", fail),
            patch("app.apps.code_te2.ui_ipc.sidebar_window_state.get_sidebar_window_state", return_value={"slots": {}}),
        ):
            with self.assertRaisesRegex(RuntimeError, "UI failed"):
                await sidebar_ws._emit_sidebar_windows_changed(self.ns)  # pyright: ignore[reportPrivateUsage]
        self.assertEqual(self.ns.records, [])

    async def test_direct_sidebar_failure_propagates(self) -> None:
        self.ns.failure = RuntimeError("Sidebar failed")
        with self.assertRaisesRegex(RuntimeError, "Sidebar failed"):
            await sidebar_ws._deliver_direct_projection(  # pyright: ignore[reportPrivateUsage]
                self.ns, build_client_state_projection("c", None, timestamp_ms=1),
            )

    async def test_fact_failures_are_isolated_and_order_is_preserved(self) -> None:
        self.ns.failure = RuntimeError("Sidebar failed")
        attempted_ui: list[str] = []
        async def fail_ui(method: str, payload: JsonObject) -> None:
            del payload
            attempted_ui.append(method)
            raise RuntimeError("UI failed")
        event = build_event("SidebarWindowStateChanged", source="test", payload={
            "state": {"slots": {}}, "activated": {"hostId": "h"}, "readiness": {"ready": True},
            "clientId": "c", "sidebarScope": "client", "activatedScope": "client", "skipSidebarSid": "s",
        })
        with (
            patch.object(notifications, "emit_ui_ipc_rpc_notification", fail_ui),
            patch.object(transport, "emit_code_te2_socketio", self.ns.emit),
        ):
            await events._handle_sidebar_window_state_changed_event(event)  # pyright: ignore[reportPrivateUsage]
        self.assertEqual(attempted_ui, [UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED, UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED, UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED])
        self.assertEqual([r["room"] for r in self.ns.records], ["sidebar:client:c", "sidebar_ipc", "sidebar:client:c"])
        self.assertEqual([r["skip_sid"] for r in self.ns.records], ["s"] * 3)
        self.assertEqual([r["namespace"] for r in self.ns.records], ["/sidebar_ipc"] * 3)

    async def test_fact_cancellation_propagates(self) -> None:
        self.ns.failure = asyncio.CancelledError()
        with patch.object(transport, "emit_code_te2_socketio", self.ns.emit):
            with self.assertRaises(asyncio.CancelledError):
                await transport.deliver_window_fact_projection(SidebarProjection("sidebar", "test", {}))

    async def test_fact_delivery_alternates_ui_and_sidebar(self) -> None:
        sequence: list[str] = []
        async def ui(method: str, payload: JsonObject) -> None:
            del payload
            sequence.append("ui:" + method)
        async def sidebar(event: str, data: object | None = None, *, namespace: str,
                          room: str | None = None, skip_sid: str | None = None) -> None:
            del event, data, namespace, room, skip_sid
            sequence.append("sidebar")
        event = build_event("SidebarWindowStateChanged", source="test", payload={
            "state": {"slots": {}}, "activated": {"hostId": "h"},
            "readiness": {"ready": True},
        })
        with (
            patch.object(notifications, "emit_ui_ipc_rpc_notification", ui),
            patch.object(transport, "emit_code_te2_socketio", sidebar),
        ):
            await events._handle_sidebar_window_state_changed_event(event)  # pyright: ignore[reportPrivateUsage]
        self.assertEqual(sequence, [
            "ui:" + UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED, "sidebar",
            "ui:" + UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED, "sidebar",
            "ui:" + UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED, "sidebar",
        ])

    async def test_client_state_wrapper_reads_current_selection(self) -> None:
        # The service receives a snapshot of the existing state, not a new store.
        with patch.dict(sidebar_ws._client_active_shortcuts, {"c": "selected"}, clear=True):  # pyright: ignore[reportPrivateUsage]
            await sidebar_ws._emit_client_state(self.ns, " c ", to_sid="s")  # pyright: ignore[reportPrivateUsage]
        data = self.ns.records[0]["data"]
        self.assertIsInstance(data, dict)
        from typing import cast
        params = cast(dict[str, object], data)["params"]
        self.assertIsInstance(params, dict)
        self.assertEqual(cast(dict[str, object], params)["activeShortcutId"], "selected")
        self.assertEqual(cast(dict[str, object], params)["clientId"], "c")
        self.assertIsInstance(cast(dict[str, object], params)["ts"], int)
        self.assertEqual(self.ns.records[0]["to"], "s")
