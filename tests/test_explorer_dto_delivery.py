# pyright: strict
from __future__ import annotations

import unittest
from collections.abc import Callable
from unittest.mock import AsyncMock, patch
from typing_extensions import override

from app.apps.code_te2.explorer.transport.connection_manager import ConnectionManager, JsonMessage
from app.apps.code_te2.explorer.transport.rpc_emit import emit_project_explorer_rpc_notification


class RecordingConnection:
    def __init__(self, client: str, *, fail: bool = False) -> None:
        self.client_instance_id: str = client
        self.fail: bool = fail
        self.messages: list[JsonMessage] = []
        self.on_send: Callable[[], None] | None = None

    async def accept(self) -> None:
        pass

    async def send_message(self, message: JsonMessage) -> None:
        if self.fail:
            raise RuntimeError("disconnected")
        self.messages.append(message)
        if self.on_send is not None:
            self.on_send()


class ExplorerDtoDeliveryTests(unittest.IsolatedAsyncioTestCase):
    def __init__(self, methodName: str = "runTest") -> None:
        super().__init__(methodName)
        self.manager: ConnectionManager = ConnectionManager()
        self.message: JsonMessage = {
            "jsonrpc": "2.0", "method": "explorer.test", "params": {"count": 2},
        }

    @override
    def tearDown(self) -> None:
        self.manager.stop_pulse()

    async def test_project_delivery_passes_dto_without_json_conversion(self) -> None:
        first = RecordingConnection("a")
        second = RecordingConnection("b")
        other = RecordingConnection("c")
        for connection in (first, second):
            self.manager.register_existing(connection, "/project")
        self.manager.register_existing(other, "/other")
        with patch("json.dumps", side_effect=AssertionError("DTO encoded as JSON")):
            self.assertTrue(await self.manager.broadcast("/project", self.message))
        self.assertIs(first.messages[0], self.message)
        self.assertIs(second.messages[0], self.message)
        self.assertEqual(other.messages, [])

    async def test_client_target_includes_all_presentations_only_for_that_client(self) -> None:
        connections = [RecordingConnection(client) for client in ("a", "a", "b")]
        for connection in connections:
            self.manager.register_existing(connection, "/project")
        self.assertTrue(await self.manager.send_client("a", self.message))
        self.assertEqual([len(c.messages) for c in connections], [1, 1, 0])
        self.assertFalse(await self.manager.send_client("missing", self.message))

    async def test_disconnect_during_delivery_does_not_skip_next_peer(self) -> None:
        first = RecordingConnection("a")
        second = RecordingConnection("b")
        first.on_send = lambda: self.manager.disconnect(first)
        for connection in (first, second):
            self.manager.register_existing(connection, "/project")
        self.assertTrue(await self.manager.broadcast("/project", self.message))
        self.assertEqual(second.messages, [self.message])

    async def test_failed_peer_does_not_block_healthy_peer_or_change_fallback_result(self) -> None:
        bad = RecordingConnection("a", fail=True)
        good = RecordingConnection("b")
        self.manager.register_existing(bad, "/project")
        self.assertFalse(await self.manager.broadcast("/project", self.message))
        self.manager.register_existing(good, "/project")
        self.assertTrue(await self.manager.broadcast("/project", self.message))
        self.assertEqual(good.messages, [self.message])

    async def test_personal_delivery_and_project_reassignment(self) -> None:
        connection = RecordingConnection("a")
        self.manager.register_existing(connection, "/old")
        await self.manager.send_personal(connection, self.message)
        self.manager.reassign_all("/new")
        self.assertFalse(await self.manager.broadcast("/old", self.message))
        self.assertTrue(await self.manager.broadcast("/new", self.message))
        self.assertEqual(connection.messages, [self.message, self.message])

    async def test_project_miss_keeps_existing_all_client_fallback(self) -> None:
        # A single shared project remains authoritative even during client remaps.
        fallback = AsyncMock()
        with (
            patch("app.apps.code_te2.explorer.transport.connection_manager.manager", self.manager),
            patch("app.apps.code_te2.explorer.transport.rpc_emit.emit_explorer_rpc_notification", fallback),
        ):
            await emit_project_explorer_rpc_notification("/project", "explorer.test", {})
            fallback.assert_awaited_once_with("explorer.test", {})
            fallback.reset_mock()
            self.manager.register_existing(RecordingConnection("a"), "/project")
            await emit_project_explorer_rpc_notification("/project", "explorer.test", {})
            fallback.assert_not_awaited()
