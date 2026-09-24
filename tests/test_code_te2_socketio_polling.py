"""Verify the real Code TE2 ASGI mount accepts Engine.IO polling handshakes."""

import json
import unittest
from pathlib import Path

import httpx

from app.apps.code_te2.http_app import build_code_te2_asgi_app
from app.apps.code_te2.socketio_gateway import CODE_TE2_ASGI_APP


class SocketIoPollingTests(unittest.IsolatedAsyncioTestCase):
    async def test_polling_handshake_offers_websocket_upgrade(self) -> None:
        app_root = Path(__file__).resolve().parents[1] / "app/apps/code_te2"
        app = build_code_te2_asgi_app(
            static_dir=app_root / "static",
            agent_icon_dir=app_root / "static",
            socket_app=CODE_TE2_ASGI_APP,
        )
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test.local") as client:
            response = await client.get("/socket.io/?EIO=4&transport=polling")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.text.startswith("0"))
        handshake = json.loads(response.text[1:])
        self.assertIn("sid", handshake)
        self.assertIn("websocket", handshake["upgrades"])
