# pyright: strict
"""Exercise the real Code TE2 ASGI assembly in an isolated, import-blocked process."""
from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
import importlib.abc
import importlib.machinery
import sys
from types import ModuleType
from typing import override


class BlockFastAPI(importlib.abc.MetaPathFinder):
    @override
    def find_spec(self, fullname: str, path: Sequence[str] | None = None,
                  target: ModuleType | None = None) -> importlib.machinery.ModuleSpec | None:
        del path, target
        if fullname.split(".")[0] in {"fastapi", "pydantic", "pydantic_core"}:
            raise ImportError("forbidden Code TE2 import: " + fullname)
        return None


sys.meta_path.insert(0, BlockFastAPI())

import httpx
from starlette.testclient import TestClient

from app.apps.code_te2 import main
from app.apps.code_te2.http_app import SOCKET_PATHS
from app.apps.code_te2.socketio_gateway import CODE_TE2_SIO
from app.libs.app_worker_asgi import WorkerASGI, explicit_asgi_application

events: list[str] = []


@asynccontextmanager
async def worker_lifespan(_app: object) -> AsyncIterator[None]:
    events.append("ready")
    try:
        yield
    finally:
        await CODE_TE2_SIO.shutdown()
        events.append("stopped")


def check_http(client: httpx.Client) -> None:
    assert client.get("/status").status_code == 200
    assert client.get("/__te2/runtime/loop").status_code == 200
    assert client.post("/__te2/runtime/loop").status_code == 405
    response = client.get("/ui/monaco_editor/textmate/onig.wasm")
    assert response.status_code == 200
    assert response.content.startswith(b"\x00asm")
    for path in ("/ws/read", "/ws/edit_tracker", "/ws/debug_console"):
        assert client.get(path).status_code == 404


app = explicit_asgi_application(main, "code_te2")
assert app is main.TE2_ASGI_APP
assert app is not None
assert not hasattr(main, "TE2_APP_ROUTER") and not hasattr(main, "SUBAPPS")
with TestClient(WorkerASGI(app, lifespan=worker_lifespan, loop_probe=lambda: {"app_id": "code_te2"})) as client:
    assert events == ["ready"]
    check_http(client)
    # Real Engine.IO WebSocket handshake through every mount. Namespace/domain
    # effects are separately covered by RPC tests, not invoked against user state.
    for path in SOCKET_PATHS:
        with client.websocket_connect(path + "/?EIO=4&transport=websocket", headers={"Upgrade": "websocket"}) as websocket:
            packet = websocket.receive_text()
            assert packet.startswith('0{"sid":'), packet
assert events == ["ready", "stopped"]
assert not any(name.split(".")[0] in {"fastapi", "pydantic", "pydantic_core"} for name in sys.modules)
print("native code_te2 probe passed")
