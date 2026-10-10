from __future__ import annotations

import unittest
from typing import cast
from unittest.mock import patch

from app.apps.code_te2.frontend_rpc_codec import (
    RPC_CODEC_AUTH_FIELD,
    RPC_CODEC_MSGPACK_V1,
    FrontendRpcCodecError,
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
    def test_auth_requires_exact_codec_version(self) -> None:
        require_msgpack_v1_auth({RPC_CODEC_AUTH_FIELD: RPC_CODEC_MSGPACK_V1})
        for auth in (None, {}, {RPC_CODEC_AUTH_FIELD: "json"}):
            with self.subTest(auth=auth):
                with self.assertRaises(FrontendRpcCodecError):
                    require_msgpack_v1_auth(auth)

    def test_gzip_is_explicit_editor_only_opt_in(self) -> None:
        auth = {RPC_CODEC_AUTH_FIELD: "msgpack-gzip-v1"}
        with self.assertRaises(FrontendRpcCodecError):
            require_msgpack_v1_auth(auth)
        require_msgpack_v1_auth(auth, allow_gzip=True)
        require_msgpack_v1_auth({RPC_CODEC_AUTH_FIELD: RPC_CODEC_MSGPACK_V1}, allow_gzip=True)

    def test_negotiation_import_does_not_load_a_python_codec(self) -> None:
        import os
        import subprocess
        import sys
        result = subprocess.run([sys.executable, "-c",
            "import sys; from app.apps.code_te2 import frontend_rpc_codec; "
            "assert not ({'msgspec', 'msgpack', 'json'} & sys.modules.keys()); "
            "assert not hasattr(frontend_rpc_codec, 'encode_frontend_rpc_message')"],
            env={k: v for k, v in os.environ.items() if k != "PYTHONPATH"},
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


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
    async def test_request_returns_ack_dto(self) -> None:
        namespace = _TestExplorerNamespace()
        request = {
            "jsonrpc": "2.0",
            "id": "explorer_1",
            "method": "explorer.list",
            "params": {"rel": "."},
        }

        response = await namespace.on_rpc(
            "test-sid",
            request,
        )

        self.assertIsInstance(response, dict)
        self.assertEqual(
            {
                "jsonrpc": "2.0",
                "id": "explorer_1",
                "result": {"ok": True},
            },
            response,
        )

    async def test_internal_result_completes_ack_without_wire_encoding(self) -> None:
        shim = ExplorerRpcSocketShim(_TestExplorerNamespace(), "test-sid", "client_a")
        future = shim.open_request("request_a")
        envelope: dict[str, object] = {
            "jsonrpc": "2.0", "id": "request_a", "result": {"ok": True},
        }
        with patch.object(shim.namespace, "emit", side_effect=AssertionError("pending reply emitted as notification")):
            await shim.send_message(envelope)
        self.assertTrue(future.done())
        self.assertEqual(await future, envelope)

    async def test_internal_notification_reaches_native_edge_as_dto(self) -> None:
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
        shim = ExplorerRpcSocketShim(
            namespace,
            "test-sid",
            "client_aaaaaaaaaaaa",
        )

        await shim.send_message(
            {"jsonrpc": "2.0", "method": "search.job.result", "params": {"count": 2}}
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
            payload,
        )


if __name__ == "__main__":
    unittest.main()
