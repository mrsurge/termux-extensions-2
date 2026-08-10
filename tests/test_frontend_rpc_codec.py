from __future__ import annotations

import unittest
from typing import cast
from unittest.mock import patch

from app.apps.code_te2 import frontend_rpc_codec
from app.apps.code_te2.frontend_rpc_codec import (
    RPC_CODEC_AUTH_FIELD,
    RPC_CODEC_MSGPACK_V1,
    FrontendRpcCodecError,
    decode_frontend_rpc_message,
    encode_frontend_rpc_message,
    require_msgpack_v1_auth,
)
from app.apps.code_te2.explorer.transport.rpc_contract import (
    JsonRpcErrorEnvelope,
    JsonRpcSuccessEnvelope,
)
from app.apps.code_te2.explorer.transport.rpc_socketio import (
    ExplorerRpcSocketShim,
    ExplorerRpcSocketIONamespace,
)


class FrontendRpcCodecTests(unittest.TestCase):
    def test_messagepack_round_trip_preserves_rpc_envelope(self) -> None:
        envelope = {
            "jsonrpc": "2.0",
            "id": "explorer_1",
            "method": "explorer.list",
            "params": {"rel": ".", "open": ["src"]},
        }

        encoded = encode_frontend_rpc_message(envelope, lane="explorer")
        decoded = decode_frontend_rpc_message(encoded, lane="explorer")

        self.assertIsInstance(encoded, bytes)
        self.assertEqual(envelope, decoded)

    def test_decode_rejects_non_binary_payload(self) -> None:
        with self.assertRaisesRegex(FrontendRpcCodecError, "binary_rpc_payload_required"):
            decode_frontend_rpc_message({"method": "explorer.list"}, lane="explorer")

    def test_decode_rejects_invalid_messagepack(self) -> None:
        with self.assertRaisesRegex(FrontendRpcCodecError, "invalid_msgpack_payload"):
            decode_frontend_rpc_message(b"\xc1", lane="explorer")

    def test_auth_requires_exact_codec_version(self) -> None:
        require_msgpack_v1_auth({RPC_CODEC_AUTH_FIELD: RPC_CODEC_MSGPACK_V1})

        for auth in (None, {}, {RPC_CODEC_AUTH_FIELD: "json"}):
            with self.subTest(auth=auth):
                with self.assertRaises(FrontendRpcCodecError):
                    require_msgpack_v1_auth(auth)

    def test_disabled_metrics_do_not_take_timestamps(self) -> None:
        envelope = {"method": "explorer.list", "params": {"rel": "."}}
        with (
            patch.object(frontend_rpc_codec, "_METRICS_ENABLED", False),
            patch.object(
                frontend_rpc_codec.time,
                "perf_counter_ns",
                side_effect=AssertionError("disabled metrics took a timestamp"),
            ),
        ):
            encoded = encode_frontend_rpc_message(envelope, lane="explorer")
            self.assertEqual(
                envelope,
                decode_frontend_rpc_message(encoded, lane="explorer"),
            )


class _TestExplorerNamespace(ExplorerRpcSocketIONamespace):
    async def _dispatch_rpc(
        self,
        sid: str,
        data: object,
    ) -> JsonRpcSuccessEnvelope | JsonRpcErrorEnvelope | None:
        del sid
        request = cast(dict[str, object], data)
        request_id = request.get("id")
        return {
            "jsonrpc": "2.0",
            "id": request_id if isinstance(request_id, str) else "missing",
            "result": {"ok": True},
        }


class ExplorerMessagePackNamespaceTests(unittest.IsolatedAsyncioTestCase):
    async def test_binary_request_returns_binary_ack(self) -> None:
        namespace = _TestExplorerNamespace()
        request = {
            "jsonrpc": "2.0",
            "id": "explorer_1",
            "method": "explorer.list",
            "params": {"rel": "."},
        }

        response = await namespace.on_rpc(
            "test-sid",
            encode_frontend_rpc_message(request, lane="explorer"),
        )

        self.assertIsInstance(response, bytes)
        self.assertEqual(
            {
                "jsonrpc": "2.0",
                "id": "explorer_1",
                "result": {"ok": True},
            },
            decode_frontend_rpc_message(response, lane="explorer"),
        )

    async def test_invalid_messagepack_returns_binary_parse_error(self) -> None:
        namespace = _TestExplorerNamespace()

        response = await namespace.on_rpc("test-sid", b"\xc1")

        self.assertIsInstance(response, bytes)
        decoded = decode_frontend_rpc_message(response, lane="explorer")
        self.assertIsInstance(decoded, dict)
        error = cast(dict[str, object], decoded).get("error")
        self.assertIsInstance(error, dict)
        self.assertEqual(-32700, cast(dict[str, object], error).get("code"))

    async def test_internal_notification_is_encoded_before_socketio_emit(self) -> None:
        emitted: list[tuple[str, object, str | None]] = []
        namespace = _TestExplorerNamespace()

        async def record_emit(
            event: str,
            data: object,
            *,
            room: str | None = None,
            namespace: str | None = None,
        ) -> None:
            del namespace
            emitted.append((event, data, room))

        namespace.emit = record_emit  # type: ignore[method-assign]
        shim = ExplorerRpcSocketShim(namespace, "test-sid")

        await shim.send_text(
            '{"jsonrpc":"2.0","method":"search.job.result","params":{"count":2}}'
        )

        self.assertEqual(1, len(emitted))
        event, payload, room = emitted[0]
        self.assertEqual("rpc.notify", event)
        self.assertEqual("test-sid", room)
        self.assertEqual(
            {
                "jsonrpc": "2.0",
                "method": "search.job.result",
                "params": {"count": 2},
            },
            decode_frontend_rpc_message(payload, lane="explorer"),
        )


if __name__ == "__main__":
    unittest.main()
