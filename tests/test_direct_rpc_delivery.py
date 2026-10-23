"""Direct ingress preserves namespace policy; lifecycle stays on general delivery."""
from __future__ import annotations

import asyncio

import msgspec
import pytest

from app.apps.code_te2.native_socketio import NativeNamespace, NativeSocketServer
from app.apps.code_te2.network_rpc_ingress import deliver_rpc


class Handler(NativeNamespace):
    def __init__(self, namespace: str) -> None:
        super().__init__(namespace)
        self.calls: list[tuple[str, object]] = []
        self.mode: str = "normal"
        self.entered = asyncio.Event()
        self.finished = asyncio.Event()
        self.release = asyncio.Event()

    async def on_rpc(self, sid: str, data: object) -> object:
        self.calls.append((sid, data))
        if self.mode == "error":
            raise TypeError("handler failed; never retry")
        if self.mode == "cancel":
            raise asyncio.CancelledError
        if self.mode == "wait":
            self.entered.set()
            try:
                await self.release.wait()
            finally:
                self.finished.set()
        return {"sid": sid, "data": data}

    async def on_disconnect(self, sid: str, reason: object) -> None:
        raise TypeError("disconnect failed")


@pytest.mark.parametrize("namespace", ["/rpc/editor", "/rpc/explorer", "/ui_ipc"])
def test_direct_rpc_preserves_payload_identity_sessions_and_failures(namespace: str) -> None:
    async def run() -> None:
        server = NativeSocketServer()
        handler = Handler(namespace)
        server.register_namespace(handler)
        await server.save_session("owned", {"owner": "kept"}, namespace)
        values: list[object] = [None, True, 2**64-1, [],
            {"namespace": "/terminal", "sid": "forged", "event": "disconnect",
             "params": {"binary": b"\0\xff", "unicode": "λ🙂"}}]
        for data in values:
            expected = await server.deliver({"namespace": namespace, "sid": "owned", "event": "rpc", "data": data})
            actual = await deliver_rpc(server, namespace, "owned", "rpc", msgspec.msgpack.encode(data))
            assert actual == expected == {"sid": "owned", "data": data}
        assert len(handler.calls) == len(values) * 2
        assert await server.get_session("owned", namespace) == {"owner": "kept"}
        handler.mode = "error"
        before = len(handler.calls)
        with pytest.raises(TypeError, match="never retry"):
            await deliver_rpc(server, namespace, "owned", "rpc", b"\xc0")
        assert len(handler.calls) == before + 1
        handler.mode = "cancel"
        assert await deliver_rpc(server, namespace, "owned", "rpc", b"\xc0") is None
        assert await server.deliver({"namespace": namespace, "sid": "owned", "event": "rpc"}) is None
        # Only the existing general disconnect path removes its exact session,
        # including when the disconnect callback raises.
        with pytest.raises(TypeError, match="disconnect failed"):
            await server.deliver({"namespace": namespace, "sid": "owned", "event": "disconnect"})
        assert await server.get_session("owned", namespace) == {}
    asyncio.run(run())


@pytest.mark.parametrize("direct", [False, True])
def test_rpc_task_cancellation_keeps_native_namespace_semantics(direct: bool) -> None:
    async def run() -> None:
        server = NativeSocketServer()
        handler = Handler("/rpc/editor")
        handler.mode = "wait"
        server.register_namespace(handler)
        operation = (deliver_rpc(server, handler.namespace, "owned", "rpc", b"\xc0")
                     if direct else server.deliver({"namespace": handler.namespace, "sid": "owned", "event": "rpc"}))
        task = asyncio.create_task(operation)
        await asyncio.wait_for(handler.entered.wait(), 2)
        task.cancel()
        assert await task is None
        assert handler.finished.is_set() and len(handler.calls) == 1
    asyncio.run(run())


def test_invalid_rpc_context_or_frame_never_reaches_handler() -> None:
    async def run() -> None:
        server = NativeSocketServer()
        handler = Handler("/ui_ipc")
        server.register_namespace(handler)
        for namespace, sid, event in [("/terminal", "owned", "rpc"), ("/ui_ipc", "", "rpc"), ("/ui_ipc", "owned", "disconnect")]:
            with pytest.raises(ValueError, match="invalid native RPC context"):
                await deliver_rpc(server, namespace, sid, event, b"\xc1")
        with pytest.raises(msgspec.DecodeError):
            await deliver_rpc(server, "/ui_ipc", "owned", "rpc", b"\xc1")
        assert not handler.calls
    asyncio.run(run())
