"""Transport-neutral observer contracts; no shared runtime/process changes."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
import queue
import subprocess
import sys
from unittest.mock import patch

from app.apps.code_te2 import native_fws


class Bridge:
    def __init__(self) -> None:
        self.events: queue.Queue[object] = queue.Queue()
        self.reconnections: list[int] = []
        self.requests: list[tuple[int, object]] = []
        self.stopped: bool = False

    def fws_start(self, _url: str) -> None:
        self.events.put({"event": "connect", "epoch": 1})

    def fws_read(self) -> object:
        return self.events.get(timeout=3)

    def fws_call(self, epoch: int, request: object) -> object:
        self.requests.append((epoch, request))
        return {"result": {"state": {"shells": []}}}

    def fws_reconnect(self, epoch: int) -> None:
        self.reconnections.append(epoch)

    def fws_stop(self) -> None:
        self.stopped = True
        self.events.put(None)


async def connect(client: native_fws.ObserverClient) -> None:
    await client.connect("http://localhost:8089", namespaces=["/fws"],
                         socketio_path="fws_ws/socket.io", transports=["websocket"],
                         wait=True, wait_timeout=5, retry=True)


def test_snapshot_barrier_and_shutdown_release_consumer() -> None:
    async def run() -> None:
        bridge = Bridge()
        with patch.object(native_fws, "_bridge", bridge):
            client = native_fws.ObserverClient()
        entered, release, delivered = asyncio.Event(), asyncio.Event(), asyncio.Event()
        order: list[str] = []

        async def snapshot() -> None:
            entered.set()
            _ = await release.wait()
            _ = await client.call("fws_request", {"method": "fws.dashboard.open"}, namespace="/fws", timeout=10)
            order.append("snapshot")

        async def notification(_payload: object) -> None:
            order.append("event")
            delivered.set()

        _ = client.on("connect", snapshot, namespace="/fws")
        _ = client.on("fws_notification", notification, namespace="/fws")
        await connect(client)
        _ = await asyncio.wait_for(entered.wait(), 2)
        bridge.events.put({"event": "notification", "epoch": 1, "data": {}})
        await asyncio.sleep(0)
        assert not order
        release.set()
        _ = await asyncio.wait_for(delivered.wait(), 2)
        assert order == ["snapshot", "event"]
        await asyncio.wait_for(client.shutdown(), 2)
        assert bridge.stopped and not client.connected and client.reader is None
    asyncio.run(run())


def test_failed_handler_fences_notifications_until_reconnect() -> None:
    async def run() -> None:
        bridge = Bridge()
        with patch.object(native_fws, "_bridge", bridge):
            client = native_fws.ObserverClient()
        entered = asyncio.Event()
        attempts: list[object] = []

        async def notification(payload: object) -> None:
            attempts.append(payload)
            entered.set()
            raise ValueError("domain failed")

        _ = client.on("fws_notification", notification, namespace="/fws")
        await connect(client)
        bridge.events.put({"event": "notification", "epoch": 1, "data": "first"})
        bridge.events.put({"event": "notification", "epoch": 1, "data": "gap"})
        _ = await asyncio.wait_for(entered.wait(), 2)
        await client.shutdown()
        assert attempts == ["first"] and bridge.reconnections == [1]
    asyncio.run(run())


def test_main_import_excludes_displaced_network_stack(tmp_path: Path) -> None:
    env = os.environ.copy()
    env.update(HOME=str(tmp_path))
    for name in ("CONFIG", "DATA", "CACHE", "RUNTIME"):
        env[f"TE2_{name}_HOME"] = str(tmp_path / name.lower())
    script = """
import importlib.abc
import sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'socketio', 'engineio', 'aiohttp', 'framework_shells'}:
            raise ImportError('displaced import: ' + fullname)
sys.meta_path.insert(0, Block())
from app.apps.code_te2 import main
assert not {'socketio', 'engineio', 'aiohttp', 'framework_shells'} & sys.modules.keys()
"""
    result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1],
                            env=env, capture_output=True, timeout=20)
    assert result.returncode == 0, result.stderr.decode()
