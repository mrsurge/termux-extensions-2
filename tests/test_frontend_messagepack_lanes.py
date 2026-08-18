from __future__ import annotations

import asyncio
import unittest
from typing import cast
from unittest.mock import AsyncMock, patch

from socketio.exceptions import ConnectionRefusedError

from app.apps.code_te2.frontend_rpc_codec import (
    RPC_CODEC_AUTH_FIELD,
    RPC_CODEC_MSGPACK_V1,
    decode_frontend_rpc_message,
    encode_frontend_rpc_message,
)
from app.apps.code_te2.monaco_editor.editor_rpc_contract import (
    EDITOR_RPC_NOTIFICATION_READY,
)
from app.apps.code_te2.monaco_editor.editor_rpc_emit import (
    emit_editor_rpc_notification,
)
from app.apps.code_te2.monaco_editor.editor_rpc_socketio import (
    EditorRpcSocketIONamespace,
)
from app.apps.code_te2.host.run_target_service import (
    emit_run_target_routes_snapshot,
)
from app.apps.code_te2.ui_ipc.rpc_contract import (
    UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET,
    UI_IPC_RPC_NOTIFICATION_RUN_TARGET_ROUTES_CHANGED,
)
from app.apps.code_te2.ui_ipc.ui_ipc_ws import UIIPCNamespace


class EditorMessagePackTests(unittest.IsolatedAsyncioTestCase):
    async def test_notification_helper_emits_messagepack(self) -> None:
        emitted: list[tuple[str, bytes]] = []

        async def record(event: str, payload: bytes) -> None:
            emitted.append((event, payload))

        await emit_editor_rpc_notification(
            record,
            EDITOR_RPC_NOTIFICATION_READY,
            {"path": "/project/main.py"},
        )

        self.assertEqual(1, len(emitted))
        event, payload = emitted[0]
        self.assertEqual("rpc", event)
        self.assertEqual(
            {
                "jsonrpc": "2.0",
                "method": EDITOR_RPC_NOTIFICATION_READY,
                "params": {"path": "/project/main.py"},
            },
            decode_frontend_rpc_message(payload, lane="editor"),
        )

    async def test_malformed_editor_frame_emits_binary_parse_error(self) -> None:
        namespace = EditorRpcSocketIONamespace("/rpc/editor")
        emitted: list[object] = []

        async def record_emit(
            event: str,
            payload: object,
            *,
            room: str | None = None,
        ) -> None:
            del event, room
            emitted.append(payload)

        namespace.emit = record_emit  # type: ignore[method-assign]
        await namespace.on_rpc("editor-sid", b"\xc1")

        self.assertEqual(1, len(emitted))
        decoded = decode_frontend_rpc_message(emitted[0], lane="editor")
        error = cast(dict[str, object], decoded).get("error")
        self.assertIsInstance(error, dict)
        self.assertEqual(-32700, cast(dict[str, object], error).get("code"))

    async def test_editor_connect_rejects_missing_codec_auth(self) -> None:
        namespace = EditorRpcSocketIONamespace("/rpc/editor")

        with self.assertRaisesRegex(Exception, "missing_rpc_codec"):
            await namespace.on_connect("editor-sid", {}, None)


class UiIpcMessagePackTests(unittest.IsolatedAsyncioTestCase):
    async def test_binary_ui_request_returns_binary_ack(self) -> None:
        namespace = UIIPCNamespace("/ui_ipc")
        request = {
            "jsonrpc": "2.0",
            "id": "ui_ipc_1",
            "method": UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET,
            "params": {},
        }

        with patch(
            "app.apps.code_te2.ui_ipc.ui_ipc_ws.dispatch_ui_ipc_rpc_request",
            new=AsyncMock(return_value={"ok": True}),
        ):
            response = await namespace.on_rpc(
                "ui-sid",
                encode_frontend_rpc_message(request, lane="ui_ipc"),
            )

        self.assertIsInstance(response, bytes)
        self.assertEqual(
            {
                "jsonrpc": "2.0",
                "id": "ui_ipc_1",
                "result": {"ok": True},
            },
            decode_frontend_rpc_message(cast(bytes, response), lane="ui_ipc"),
        )

    async def test_malformed_ui_frame_returns_binary_parse_error(self) -> None:
        namespace = UIIPCNamespace("/ui_ipc")

        response = await namespace.on_rpc("ui-sid", b"\xc1")

        self.assertIsInstance(response, bytes)
        decoded = decode_frontend_rpc_message(cast(bytes, response), lane="ui_ipc")
        error = cast(dict[str, object], decoded).get("error")
        self.assertIsInstance(error, dict)
        self.assertEqual(-32700, cast(dict[str, object], error).get("code"))

    async def test_ui_connect_rejects_wrong_codec_auth(self) -> None:
        namespace = UIIPCNamespace("/ui_ipc")

        with self.assertRaisesRegex(Exception, "unsupported_rpc_codec"):
            await namespace.on_connect(
                "ui-sid",
                {},
                {RPC_CODEC_AUTH_FIELD: "json"},
            )

    async def test_sidebar_namespace_does_not_require_frontend_codec_auth(self) -> None:
        namespace = UIIPCNamespace("/sidebar_ipc")
        entered: list[tuple[str, str]] = []

        async def enter_room(sid: str, room: str) -> None:
            entered.append((sid, room))

        namespace.enter_room = enter_room  # type: ignore[method-assign]
        await namespace.on_connect("sidebar-sid", {}, None)

        self.assertEqual([("sidebar-sid", "sidebar_ipc")], entered)

    async def test_ui_connect_accepts_exact_codec_version(self) -> None:
        namespace = UIIPCNamespace("/ui_ipc")
        entered: list[tuple[str, str]] = []

        async def enter_room(sid: str, room: str) -> None:
            entered.append((sid, room))

        async def emit(*args: object, **kwargs: object) -> None:
            del args, kwargs

        namespace.enter_room = enter_room  # type: ignore[method-assign]
        namespace.emit = emit  # type: ignore[method-assign]
        with patch(
            "app.apps.code_te2.ui_ipc.ui_ipc_ws._emit_browser_connect_adapter_state",
            new=AsyncMock(),
        ) as emit_adapter_state:
            await namespace.on_connect(
                "ui-sid",
                {},
                {RPC_CODEC_AUTH_FIELD: RPC_CODEC_MSGPACK_V1},
            )
            await asyncio.sleep(0)

        self.assertEqual([("ui-sid", "ui_ipc")], entered)
        emit_adapter_state.assert_awaited_once()

    async def test_native_ui_connect_joins_native_room_and_receives_route_snapshot(self) -> None:
        namespace = UIIPCNamespace("/ui_ipc")
        entered: list[tuple[str, str]] = []
        emitted: list[tuple[str, object, str | None]] = []

        async def enter_room(sid: str, room: str) -> None:
            entered.append((sid, room))

        async def save_session(sid: str, session: dict[str, object]) -> None:
            self.assertEqual("native-sid", sid)
            self.assertEqual("android_native", session["source"])

        async def emit(
            event: str,
            payload: object,
            *,
            to: str | None = None,
        ) -> None:
            emitted.append((event, payload, to))

        projection = {
            "dto": "RunTargetRouteProjection",
            "version": 1,
            "groups": [],
        }
        namespace.enter_room = enter_room  # type: ignore[method-assign]
        namespace.save_session = save_session  # type: ignore[method-assign]
        namespace.emit = emit  # type: ignore[method-assign]
        with patch(
            "app.apps.code_te2.host.run_target_service.list_run_target_routes",
            new=AsyncMock(return_value=projection),
        ):
            await namespace.on_connect(
                "native-sid",
                {
                    "QUERY_STRING": (
                        "app_id=code_te2&source=android_native&client_id=android%3Agecko"
                    )
                },
                {RPC_CODEC_AUTH_FIELD: RPC_CODEC_MSGPACK_V1},
            )

        self.assertEqual(
            [("native-sid", "ui_ipc"), ("native-sid", "ui_ipc_native")],
            entered,
        )
        decoded = [
            decode_frontend_rpc_message(cast(bytes, payload), lane="ui_ipc")
            for _, payload, _ in emitted
        ]
        self.assertIn(
            {
                "jsonrpc": "2.0",
                "method": UI_IPC_RPC_NOTIFICATION_RUN_TARGET_ROUTES_CHANGED,
                "params": projection,
            },
            decoded,
        )

    async def test_native_ui_connect_is_rejected_when_route_snapshot_is_unavailable(self) -> None:
        namespace = UIIPCNamespace("/ui_ipc")
        entered: list[tuple[str, str]] = []

        async def enter_room(sid: str, room: str) -> None:
            entered.append((sid, room))

        namespace.enter_room = enter_room  # type: ignore[method-assign]
        namespace.save_session = AsyncMock()  # type: ignore[method-assign]
        with patch(
            "app.apps.code_te2.host.run_target_service.list_run_target_routes",
            new=AsyncMock(side_effect=RuntimeError("pipe unavailable")),
        ):
            with self.assertRaisesRegex(
                ConnectionRefusedError,
                "Native run-target projection is unavailable",
            ):
                await namespace.on_connect(
                    "native-sid",
                    {
                        "QUERY_STRING": (
                            "app_id=code_te2&source=android_native&client_id=android%3Agecko"
                        )
                    },
                    {RPC_CODEC_AUTH_FIELD: RPC_CODEC_MSGPACK_V1},
                )

        self.assertEqual(
            [("native-sid", "ui_ipc"), ("native-sid", "ui_ipc_native")],
            entered,
        )

    async def test_native_connect_snapshot_is_serialized_with_route_publications(self) -> None:
        first_list_started = asyncio.Event()
        release_first_list = asyncio.Event()
        list_calls = 0
        emitted: list[int] = []

        async def list_routes() -> dict[str, object]:
            nonlocal list_calls
            list_calls += 1
            current = list_calls
            if current == 1:
                first_list_started.set()
                await release_first_list.wait()
            return {
                "dto": "RunTargetRouteProjection",
                "version": 1,
                "groups": [],
                "testSequence": current,
            }

        async def emit(projection: dict[str, object]) -> None:
            emitted.append(cast(int, projection["testSequence"]))

        with patch(
            "app.apps.code_te2.host.run_target_service.list_run_target_routes",
            new=list_routes,
        ):
            first = asyncio.create_task(emit_run_target_routes_snapshot(emit))
            await first_list_started.wait()
            second = asyncio.create_task(emit_run_target_routes_snapshot(emit))
            await asyncio.sleep(0)
            self.assertEqual(1, list_calls)
            release_first_list.set()
            await asyncio.gather(first, second)

        self.assertEqual([1, 2], emitted)


if __name__ == "__main__":
    unittest.main()
