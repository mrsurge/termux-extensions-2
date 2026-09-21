# pyright: strict
from __future__ import annotations

import asyncio
import unittest
from typing import Literal
from unittest.mock import patch

from app.apps.code_te2.monaco_editor.editor_session_service import (
    EditorNotification, bootstrap_editor_session, publish_editor_result,
)
from app.apps.code_te2.monaco_editor.editor_rpc_contract import (
    EDITOR_RPC_METHOD_JUMP_TO_LINE, EDITOR_RPC_METHOD_GIT_BASELINES_GET,
    EDITOR_RPC_METHOD_DRAFT_DIFF_GET, EDITOR_RPC_NOTIFICATION_STATE_SSOT,
    EDITOR_RPC_NOTIFICATION_ADAPTER_STATE, EDITOR_RPC_NOTIFICATION_FILE_JUMP_TO_LINE,
    EDITOR_RPC_NOTIFICATION_GIT_BASELINES, EDITOR_RPC_NOTIFICATION_DRAFT_DIFF,
    JsonRpcId, EditorRpcNotification,
)
from app.apps.code_te2.open_state_backend import SidecarOpenStatePayload


class SessionHarness:
    def __init__(self) -> None:
        self.events: list[object] = []
        self.identities: list[tuple[str, str]] = []
        self.snapshot: dict[str, object] = {"openState": {}, "currentPath": "a.py"}
        self.adapter_failure: bool = False
        self.delivery_failure: BaseException | None = None

    def read_snapshot(self, *, client_instance_id: str, client_role: str) -> dict[str, object]:
        self.identities.append((client_instance_id, client_role))
        return self.snapshot

    def read_adapter(self) -> dict[str, object]:
        if self.adapter_failure:
            raise RuntimeError("adapter unavailable")
        return {"ready": True}

    async def deliver(self, notification: EditorNotification) -> None:
        if self.delivery_failure is not None:
            raise self.delivery_failure
        self.events.append(notification)

    async def publish_open(self, payload: SidecarOpenStatePayload, *, source: str) -> None:
        self.events.append(("open", payload, source))

    async def reply(self, request_id: JsonRpcId, result: object) -> None:
        self.events.append(("reply", request_id, result))

    async def boot(self, client: str = "client-a", role: str = "primary") -> None:
        await bootstrap_editor_session(
            client_instance_id=client, client_role=role,
            read_snapshot=self.read_snapshot, read_adapter_state=self.read_adapter,
            publish_open_state=self.publish_open, deliver=self.deliver,
        )


class EditorSessionServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_bootstrap_order_and_identity(self) -> None:
        h = SessionHarness()
        await h.boot("secondary-client", "secondary")
        self.assertEqual(h.identities, [("secondary-client", "secondary")])
        self.assertEqual(h.events, [
            EditorNotification("connection", EDITOR_RPC_NOTIFICATION_STATE_SSOT, h.snapshot),
            EditorNotification("connection", EDITOR_RPC_NOTIFICATION_ADAPTER_STATE, {"ready": True}),
            ("open", {}, "rpc_connect"),
        ])

    async def test_reconnect_reads_fresh_snapshot(self) -> None:
        h = SessionHarness()
        await h.boot()
        h.snapshot = {"currentPath": "b.py"}
        h.events.clear()
        await h.boot()
        self.assertEqual(h.events[0], EditorNotification("connection", EDITOR_RPC_NOTIFICATION_STATE_SSOT, h.snapshot))
        self.assertEqual(len(h.events), 2)
        self.assertEqual(len(h.identities), 2)

    async def test_adapter_failure_does_not_prevent_open_projection(self) -> None:
        h = SessionHarness()
        h.adapter_failure = True
        await h.boot()
        self.assertEqual(h.events[-1], ("open", {}, "rpc_connect"))
        self.assertEqual(len(h.events), 2)

    async def test_required_snapshot_delivery_failure_propagates(self) -> None:
        h = SessionHarness()
        h.delivery_failure = RuntimeError("disconnected")
        with self.assertRaisesRegex(RuntimeError, "disconnected"):
            await h.boot()
        self.assertEqual(h.events, [])

    async def test_cancellation_is_not_swallowed(self) -> None:
        h = SessionHarness()
        async def cancel_adapter() -> dict[str, object]:
            raise asyncio.CancelledError()
        # Cancellation during the optional adapter delivery must stop bootstrap.
        async def deliver(notification: EditorNotification) -> None:
            if notification.method == EDITOR_RPC_NOTIFICATION_ADAPTER_STATE:
                _ = await cancel_adapter()
            await h.deliver(notification)
        awaitable = bootstrap_editor_session(
            client_instance_id="a", client_role="primary", read_snapshot=h.read_snapshot,
            read_adapter_state=h.read_adapter, publish_open_state=h.publish_open, deliver=deliver,
        )
        with self.assertRaises(asyncio.CancelledError):
            await awaitable
        self.assertEqual(len(h.events), 1)

    async def test_result_notifications_precede_reply_with_correct_recipients(self) -> None:
        cases: tuple[tuple[str, Literal["client", "connection"], EditorRpcNotification], ...] = (
            (EDITOR_RPC_METHOD_JUMP_TO_LINE, "client", EDITOR_RPC_NOTIFICATION_FILE_JUMP_TO_LINE),
            (EDITOR_RPC_METHOD_GIT_BASELINES_GET, "client", EDITOR_RPC_NOTIFICATION_GIT_BASELINES),
            (EDITOR_RPC_METHOD_DRAFT_DIFF_GET, "connection", EDITOR_RPC_NOTIFICATION_DRAFT_DIFF),
        )
        for method, recipient, notification in cases:
            h = SessionHarness()
            result: dict[str, object] = {"path": "a.py"}
            await publish_editor_result(method=method, request_id="r1", result=result, deliver=h.deliver, reply=h.reply)
            self.assertEqual(h.events, [EditorNotification(recipient, notification, result), ("reply", "r1", result)])

    async def test_plain_results_do_not_notify(self) -> None:
        cases: tuple[tuple[str, object], ...] = (("unrelated", {}), (EDITOR_RPC_METHOD_JUMP_TO_LINE, None))
        for method, result in cases:
            h = SessionHarness()
            await publish_editor_result(method=method, request_id=42, result=result, deliver=h.deliver, reply=h.reply)
            self.assertEqual(h.events, [("reply", 42, result)])

    async def test_notification_failure_prevents_success_reply(self) -> None:
        h = SessionHarness()
        h.delivery_failure = RuntimeError("delivery failed")
        with self.assertRaisesRegex(RuntimeError, "delivery failed"):
            await publish_editor_result(method=EDITOR_RPC_METHOD_JUMP_TO_LINE, request_id="r", result={}, deliver=h.deliver, reply=h.reply)
        self.assertEqual(h.events, [])

    async def test_adapter_resolves_recipients_and_encodes_existing_envelope(self) -> None:
        from app.apps.code_te2.monaco_editor.editor_rpc_socketio import EditorRpcSocketIONamespace
        from app.apps.code_te2.frontend_rpc_codec import decode_frontend_rpc_message

        namespace = EditorRpcSocketIONamespace("/rpc/editor")
        received: list[tuple[str, str, object]] = []

        async def record(room: str, event: str, payload: bytes) -> None:
            received.append((room, event, decode_frontend_rpc_message(payload, lane="editor")))

        with (
            patch.object(namespace, "_emit_to_room", record),
            patch.object(namespace, "_client_id", return_value="client_aaaaaaaaaaaa"),
        ):
            for recipient in ("connection", "client"):
                await namespace._deliver_notification(  # pyright: ignore[reportPrivateUsage]
                    "sid", EditorNotification(recipient, EDITOR_RPC_NOTIFICATION_DRAFT_DIFF, {"path": "a.py"}),
                )
        self.assertEqual([item[0] for item in received], ["sid", "code_te2:client:client_aaaaaaaaaaaa"])
        self.assertEqual(received[0][1:], ("rpc", {
            "jsonrpc": "2.0", "method": EDITOR_RPC_NOTIFICATION_DRAFT_DIFF, "params": {"path": "a.py"},
        }))

    async def test_connect_adapter_registers_rooms_before_bootstrap_and_disconnect_cleans_identity(self) -> None:
        from app.apps.code_te2.monaco_editor import editor_rpc_socketio as adapter
        from app.apps.code_te2.monaco_editor.editor_client_registry import editor_client_identity, unregister_editor_client
        from app.apps.code_te2.frontend_rpc_codec import decode_frontend_rpc_message

        h = SessionHarness()
        namespace = adapter.EditorRpcSocketIONamespace("/rpc/editor")

        async def enter(sid: str, room: str) -> None:
            h.events.append(("enter", sid, room))

        async def leave(sid: str, room: str) -> None:
            h.events.append(("leave", sid, room))

        async def record(room: str, event: str, payload: bytes) -> None:
            h.events.append(("emit", room, event, decode_frontend_rpc_message(payload, lane="editor")))

        with (
            patch.object(namespace, "enter_room", enter),
            patch.object(namespace, "leave_room", leave),
            patch.object(namespace, "_emit_to_room", record),
            patch.object(adapter, "editor_runtime_build_connect_snapshot", h.read_snapshot),
            patch.object(adapter, "editor_runtime_emit_open_state_changed", h.publish_open),
            patch("app.apps.code_te2.workbench_adapter_shell_manager.get_adapter_state", h.read_adapter),
        ):
            try:
                await namespace.on_connect("session-test", {
                    "QUERY_STRING": "client_instance_id=client_aaaaaaaaaaaa&client_role=secondary",
                }, {"rpcCodec": "msgpack-v1"})
                self.assertEqual(h.events[:2], [
                    ("enter", "session-test", "code_te2"),
                    ("enter", "session-test", "code_te2:client:client_aaaaaaaaaaaa"),
                ])
                self.assertEqual(h.identities, [("client_aaaaaaaaaaaa", "secondary")])
                self.assertEqual(h.events[-1], ("open", {}, "rpc_connect"))
                self.assertIsNotNone(editor_client_identity("session-test"))
                await namespace.on_disconnect("session-test")
                self.assertIsNone(editor_client_identity("session-test"))
            finally:
                _ = unregister_editor_client("session-test")
