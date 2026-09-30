"""Thin async domain adapter for the Rust-owned FWS observer. No wire codec."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Protocol, cast


class NativeFwsBridge(Protocol):
    def fws_start(self, url: str) -> None: ...
    def fws_read(self) -> object: ...
    def fws_call(self, epoch: int, request: object) -> object: ...
    def fws_reconnect(self, epoch: int) -> None: ...
    def fws_stop(self) -> None: ...


_bridge: NativeFwsBridge | None = None
logger = logging.getLogger(__name__)


def configure_native(bridge: NativeFwsBridge) -> None:
    global _bridge
    _bridge = bridge


class ObserverClient:
    def __init__(self) -> None:
        if _bridge is None:
            raise RuntimeError("native FWS observer is not configured")
        self.bridge: NativeFwsBridge = _bridge
        self.connected: bool = False
        self.epoch: int = 0
        self.handlers: dict[str, Callable[..., Awaitable[object | None]]] = {}
        self.reader: asyncio.Task[None] | None = None
        self.stopped: bool = False

    def on(self, event: str, handler: Callable[..., Awaitable[object | None]], *, namespace: str) -> object:
        if namespace != "/fws":
            raise ValueError("native observer only supports /fws")
        self.handlers[event] = handler
        return None

    async def connect(self, url: str, *, namespaces: list[str], socketio_path: str,
                      transports: list[str], wait: bool, wait_timeout: int, retry: bool) -> None:
        if namespaces != ["/fws"] or socketio_path != "fws_ws/socket.io" or transports != ["websocket"]:
            raise ValueError("unsupported native observer transport")
        if not wait or wait_timeout != 5 or not retry:
            raise ValueError("unsupported native observer reconnect policy")
        if self.reader is not None or self.stopped:
            raise RuntimeError("observer already started/stopped")
        # Nonblocking native start: network establishment belongs to its thread.
        self.bridge.fws_start(url)
        self.reader = asyncio.create_task(self._read(), name="native_fws_events")

    async def _read(self) -> None:
        try:
            while not self.stopped:
                value = await asyncio.to_thread(self.bridge.fws_read)
                if value is None or self.stopped:
                    return
                if not isinstance(value, dict):
                    raise TypeError("invalid native FWS event")
                event = cast(dict[str, object], value)
                name, epoch = event.get("event"), event.get("epoch")
                if not isinstance(name, str) or not isinstance(epoch, int):
                    raise TypeError("invalid native FWS event identity")
                if epoch < self.epoch:
                    continue
                self.epoch = epoch
                try:
                    if name == "connect":
                        self.connected = True
                        handler = self.handlers.get("connect")
                        if handler is not None:
                            _ = await handler()
                    elif name == "disconnect":
                        self.connected = False
                        handler = self.handlers.get("disconnect")
                        if handler is not None:
                            _ = await handler()
                    elif name == "notification" and self.connected:
                        handler = self.handlers.get("fws_notification")
                        if handler is not None:
                            _ = await handler(event.get("data"))
                except Exception:
                    logger.exception("Native FWS event failed; reconnecting for fresh state")
                    self.connected = False
                    if not self.stopped:
                        self.bridge.fws_reconnect(epoch)
        finally:
            self.connected = False

    async def call(self, event: str, data: object, *, namespace: str, timeout: int) -> object:
        if not self.connected or self.stopped:
            raise RuntimeError("FWS observer disconnected")
        if event != "fws_request" or namespace != "/fws" or timeout != 10:
            raise ValueError("unsupported native observer request")
        epoch = self.epoch
        try:
            response = await asyncio.to_thread(self.bridge.fws_call, epoch, data)
        except Exception:
            self.bridge.fws_reconnect(epoch)
            raise
        if self.stopped or not self.connected or self.epoch != epoch:
            raise RuntimeError("FWS response belongs to an old connection")
        if isinstance(response, dict) and cast(dict[str, object], response).get("error") is not None:
            self.bridge.fws_reconnect(epoch)
        return cast(object, response)

    async def shutdown(self) -> None:
        self.stopped = True
        self.connected = False
        # Wake the native read and reject pending acknowledgements before joining
        # the domain consumer; cancellation alone cannot cancel a blocking read.
        self.bridge.fws_stop()
        if self.reader is not None:
            await asyncio.gather(self.reader, return_exceptions=True)
            self.reader = None
