# pyright: strict
from __future__ import annotations

import unittest
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import cast
from unittest.mock import patch

from app.apps.code_te2.frontend_rpc_codec import decode_frontend_rpc_message, encode_frontend_rpc_message
from app.apps.code_te2.monaco_editor.editor_rpc_messages import (
    build_editor_rpc_result, build_editor_rpc_error, build_editor_rpc_notification,
)
from app.apps.code_te2.monaco_editor.editor_rpc_emit import (
    emit_editor_rpc_result, emit_editor_rpc_error, emit_editor_rpc_notification,
)
from app.apps.code_te2.monaco_editor.editor_rpc_contract import (
    EDITOR_RPC_NOTIFICATION_DRAFT_DIFF, EDITOR_RPC_METHOD_DRAFT_DIFF_GET,
    EditorRpcDispatchError,
)
from app.apps.code_te2.monaco_editor import editor_rpc_socketio as adapter


class EditorRpcMessageTests(unittest.TestCase):
    def test_result_normalization_preserves_prior_rules(self) -> None:
        shared = {"n": 3}
        source: dict[object, object] = {"tuple": (1, "a"), "path": Path("file.py"), 2: "drop", "a": shared, "b": shared}
        result = build_editor_rpc_result("r", source)
        self.assertEqual(result, {"jsonrpc": "2.0", "id": "r", "result": {
            "tuple": [1, "a"], "path": "file.py", "a": {"n": 3}, "b": {"n": 3},
        }})
        self.assertEqual(source["tuple"], (1, "a"))

    def test_cycles_are_cut_without_changing_original(self) -> None:
        source: dict[str, object] = {}
        source["self"] = source
        self.assertEqual(build_editor_rpc_result(1, source)["result"], {"self": None})
        self.assertIs(source["self"], source)
        sequence: list[object] = []
        sequence.append(sequence)
        self.assertEqual(build_editor_rpc_result(1, sequence)["result"], [None])

    def test_nested_containers_are_bounded(self) -> None:
        nested: object = {"leaf": True}
        for _ in range(66):
            nested = [nested]
        result: object = build_editor_rpc_result(0, nested)["result"]
        for _ in range(65):
            self.assertIsInstance(result, list)
            result = cast(list[object], result)[0]
        self.assertIsNone(result)

    def test_error_data_and_notification_have_existing_shapes(self) -> None:
        cases: tuple[dict[str, object] | None, ...] = (None, {})
        for data in cases:
            self.assertEqual(build_editor_rpc_error(None, -1, "bad", data=data), {
                "jsonrpc": "2.0", "id": None, "error": {"code": -1, "message": "bad"},
            })
        self.assertEqual(build_editor_rpc_error(4, -1, "bad", data={"value": (1, 2)})["error"].get("data"), {"value": [1, 2]})
        self.assertEqual(build_editor_rpc_notification(EDITOR_RPC_NOTIFICATION_DRAFT_DIFF, {"value": (1, 2)}), {
            "jsonrpc": "2.0", "method": EDITOR_RPC_NOTIFICATION_DRAFT_DIFF, "params": {"value": [1, 2]},
        })


class EditorRpcBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_emit_wrappers_encode_completed_builder_values(self) -> None:
        received: list[object] = []
        async def emit(event: str, payload: bytes) -> None:
            self.assertEqual(event, "rpc")
            received.append(decode_frontend_rpc_message(payload, lane="editor"))
        await emit_editor_rpc_result(emit, "r", {"x": (1, 2)})
        await emit_editor_rpc_error(emit, "r", -1, "bad", data={"x": (1, 2)})
        await emit_editor_rpc_notification(emit, EDITOR_RPC_NOTIFICATION_DRAFT_DIFF, {"x": (1, 2)})
        self.assertEqual(received, [
            build_editor_rpc_result("r", {"x": (1, 2)}),
            build_editor_rpc_error("r", -1, "bad", data={"x": (1, 2)}),
            build_editor_rpc_notification(EDITOR_RPC_NOTIFICATION_DRAFT_DIFF, {"x": (1, 2)}),
        ])

    async def test_request_and_notification_use_same_dispatch_and_keep_reply_policy(self) -> None:
        namespace = adapter.EditorRpcSocketIONamespace("/rpc/editor")
        calls: list[tuple[str, dict[str, object], str]] = []
        received: list[object] = []
        async def dispatch(method: str, params: dict[str, object], *, source_client: str) -> object:
            calls.append((method, params, source_client))
            return {"path": "file.py"}
        async def emit(target: str, event: str, data: bytes) -> None:
            self.assertEqual(target, "sid")
            self.assertEqual(event, "rpc")
            received.append(decode_frontend_rpc_message(data, lane="editor"))
        with (
            patch.object(adapter, "dispatch_editor_runtime_request", dispatch),
            patch.object(namespace, "_client_id", return_value="client_aaaaaaaaaaaa"),
            patch.object(namespace, "_emit_to_sid", emit),
            patch.object(namespace, "_emit_to_room", emit),
        ):
            payload: dict[str, object] = {"jsonrpc": "2.0", "method": EDITOR_RPC_METHOD_DRAFT_DIFF_GET, "params": {"path": "file.py"}}
            await namespace.on_rpc("sid", encode_frontend_rpc_message(payload, lane="editor"))
            self.assertEqual(received, [])
            payload["id"] = "r1"
            await namespace.on_rpc("sid", encode_frontend_rpc_message(payload, lane="editor"))
        self.assertEqual(calls, [(EDITOR_RPC_METHOD_DRAFT_DIFF_GET, {"path": "file.py"}, "client_aaaaaaaaaaaa")] * 2)
        self.assertEqual(received, [
            build_editor_rpc_notification(EDITOR_RPC_NOTIFICATION_DRAFT_DIFF, {"path": "file.py"}),
            build_editor_rpc_result("r1", {"path": "file.py"}),
        ])

    async def test_dispatch_error_retains_request_id_and_data(self) -> None:
        namespace = adapter.EditorRpcSocketIONamespace("/rpc/editor")
        received: list[object] = []
        async def dispatch(method: str, params: dict[str, object], *, source_client: str) -> object:
            del method, params, source_client
            raise EditorRpcDispatchError(-32000, "rejected", data={"reason": "test"})
        async def emit(target: str, event: str, data: bytes) -> None:
            del target, event
            received.append(decode_frontend_rpc_message(data, lane="editor"))
        with (
            patch.object(adapter, "dispatch_editor_runtime_request", dispatch),
            patch.object(namespace, "_client_id", return_value="client_aaaaaaaaaaaa"),
            patch.object(namespace, "_emit_to_sid", emit),
        ):
            await namespace.on_rpc("sid", encode_frontend_rpc_message({
                "jsonrpc": "2.0", "id": 12, "method": "editor.open", "params": {},
            }, lane="editor"))
        self.assertEqual(received, [build_editor_rpc_error(12, -32000, "rejected", data={"reason": "test"})])

    async def test_runtime_binding_keeps_client_on_outbound_events(self) -> None:
        from app.apps.code_te2.monaco_editor import editor_runtime_dispatch as runtime
        from app.apps.code_te2.monaco_editor.editor_ws import editor_runtime_read_file_payload

        received: list[tuple[str, dict[str, object], str | None]] = []
        async def emit(event: str, payload: dict[str, object], *, client_instance_id: str | None = None) -> None:
            received.append((event, payload, client_instance_id))

        async def dispatch(method: str, params: dict[str, object], **dependencies: object) -> object:
            self.assertEqual(method, "test")
            self.assertEqual(params, {"ok": True})
            self.assertEqual(dependencies["source_client"], "client_a")
            self.assertIs(dependencies["read_file_payload"], editor_runtime_read_file_payload)
            deliver = cast(Callable[[str, dict[str, object]], Awaitable[None]], dependencies["emit_to_room"])
            await deliver("editor:open", {"path": "file.py"})
            return {"ok": True}

        with (
            patch.object(runtime, "dispatch_editor_rpc_request", dispatch),
            patch.object(runtime, "editor_runtime_emit_room_event", emit),
        ):
            result = await runtime.dispatch_editor_runtime_request("test", {"ok": True}, source_client="client_a")
        self.assertEqual(result, {"ok": True})
        self.assertEqual(received, [("editor:open", {"path": "file.py"}, "client_a")])
