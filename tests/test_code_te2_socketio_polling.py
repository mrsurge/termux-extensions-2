"""Verify the real Rust-owned Code TE2 gateway offers Engine.IO upgrades."""
import json
import urllib.request

from framework.native_editor_worker.tests.test_code_te2 import native_app


def test_polling_handshake_offers_websocket_upgrade(native_app):
    url, *_ = native_app
    for path in ("/socket.io/", "/editor_ws/socket.io/", "/explorer_ws/socket.io/",
                 "/ui_ipc_ws/socket.io/", "/terminal_ws/socket.io/"):
        with urllib.request.urlopen(url + path + "?EIO=4&transport=polling") as response:
            packet = response.read().decode()
            assert response.status == 200
        assert packet.startswith("0")
        handshake = json.loads(packet[1:])
        assert "sid" in handshake
        assert "websocket" in handshake["upgrades"]
