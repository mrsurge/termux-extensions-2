"""Isolated real domain submit/Future/namespace-adapter parity, no live sockets."""
from __future__ import annotations

import asyncio
import concurrent.futures
import sys
import threading
from types import ModuleType
from typing import cast

import msgspec

from app.apps.code_te2 import native_worker, network_rpc_ingress
from app.apps.code_te2.native_socketio import NativeSocketServer

_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_previous: ModuleType | None = None
_server = NativeSocketServer()
_live = True


class Gateway(ModuleType):
    CODE_TE2_SIO: NativeSocketServer


class Namespace:
    def __init__(self, namespace: str) -> None:
        self.namespace = namespace

    def _set_server(self, server: object) -> None:
        assert server is _server

    async def trigger_event(self, event: str, *args: object) -> object:
        if not _live or args[0] != "owned-sid":
            raise RuntimeError("stale client")
        assert event == "rpc"
        await asyncio.sleep(0)
        return {"namespace":self.namespace,"sid":args[0],"data":args[1]}


def start() -> dict[str, str]:
    global _loop, _thread, _previous
    assert native_worker._loop is None
    _loop = asyncio.new_event_loop()
    ready = threading.Event()
    loop = _loop
    def run() -> None:
        asyncio.set_event_loop(loop)
        loop.call_soon(ready.set)
        loop.run_forever()
    _thread = threading.Thread(target=run)
    _thread.start()
    ready.wait()
    native_worker._loop = loop
    for namespace in ("/rpc/editor", "/rpc/explorer", "/ui_ipc"):
        _server.register_namespace(Namespace(namespace))
    key = "app.apps.code_te2.socketio_gateway"
    _previous = sys.modules.get(key)
    gateway = Gateway(key)
    gateway.CODE_TE2_SIO = _server
    sys.modules[key] = gateway
    return {"domain":str(native_worker.__file__),"adapter":str(network_rpc_ingress.__file__)}


def stop() -> None:
    global _loop, _thread
    native_worker._loop = None
    if _loop is not None and _thread is not None:
        _loop.call_soon_threadsafe(_loop.stop)
        _thread.join(timeout=5)
        assert not _thread.is_alive()
        _loop.close()
    key = "app.apps.code_te2.socketio_gateway"
    if _previous is None:
        sys.modules.pop(key, None)
    else:
        sys.modules[key] = _previous
    _loop, _thread = None, None


def fixture(index: int) -> bytes:
    values: list[object] = [None, True, 18446744073709551615, [],
        {"namespace":"forged", "sid":"forged", "event":"disconnect",
         "jsonrpc":"2.0","id":"λ🙂","method":"sample", "params":{"text":"λ🙂\n"*128,"binary":b"\0\xff"*1024}},
        {"items":[{"path":f"/project/{i}.rs", "range":[i,1,i,4]} for i in range(512)]}]
    return msgspec.msgpack.encode(values[index])


def graph(namespace: str, data: object) -> concurrent.futures.Future[object]:
    return native_worker.submit({"namespace":namespace,"sid":"owned-sid","event":"rpc","data":data})


def check_python() -> None:
    global _live
    for namespace in ("/rpc/editor", "/rpc/explorer", "/ui_ipc"):
        for index in range(6):
            wire = fixture(index)
            data = cast(object, msgspec.msgpack.decode(wire))
            expected = graph(namespace, data).result(2)
            assert native_worker.submit_rpc(namespace,"owned-sid","rpc",wire).result(2) == expected
    _live = False
    try:
        for future in [graph("/rpc/editor",None), native_worker.submit_rpc("/rpc/editor","owned-sid","rpc",b"\xc0")]:
            try:
                future.result(2)
            except RuntimeError as error:
                assert str(error) == "stale client"
            else:
                raise AssertionError("stale dispatch succeeded")
    finally:
        _live = True
    for namespace, sid, event in [("/terminal","owned-sid","rpc"),("/ui_ipc","","rpc"),("/rpc/editor","owned-sid","disconnect")]:
        try:
            native_worker.submit_rpc(namespace,sid,event,b"\xc0").result(2)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid transport context accepted")
