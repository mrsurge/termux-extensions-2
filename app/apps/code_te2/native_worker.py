"""Real Code TE2 domain lifecycle hosted by the independent Rust executable."""
from __future__ import annotations

import asyncio
import concurrent.futures
import os
import sys
import threading
from collections.abc import Callable
from typing import Protocol, cast

from app.libs import pipe_runtime
from app.libs.app_worker_bootstrap import assemble_off_loop
from app.libs.pipe_inbound import InboundEnvelopeRouter
from app.libs.pipe_protocol import PipeEnvelope, PipeIdentity, PipeError, PipeProtocolError, decode_envelope, process_error_response
from app.libs.runtime_debug_pipe import RuntimeDebugPipe
from .native_socketio import NativeBridge

_loop: asyncio.AbstractEventLoop | None = None
_stop: asyncio.Event | None = None
_router: InboundEnvelopeRouter | None = None
_debug: RuntimeDebugPipe | None = None
_ready: concurrent.futures.Future[dict[str, object]] = concurrent.futures.Future()
_done: concurrent.futures.Future[None] = concurrent.futures.Future()
_thread: threading.Thread | None = None


class StructFields(Protocol):
    __struct_fields__: tuple[str, ...]
    __struct_encode_fields__: tuple[str, ...]


def _struct_values(value: object) -> dict[str, object]:
    fields = cast(StructFields, value)
    return {wire: cast(object, getattr(value, field)) for field, wire in zip(fields.__struct_fields__, fields.__struct_encode_fields__)}


class NativePipeTransport:
    def __init__(self, bridge: NativeBridge) -> None:
        self.bridge: NativeBridge = bridge

    def write(self, envelope: PipeEnvelope, before_write: Callable[[], None] | None = None) -> None:
        # Structural conversion only: Rust remains the MessagePack wire owner.
        data = _struct_values(envelope)
        if envelope.error is not None:
            data["error"] = _struct_values(envelope.error)
        if before_write is not None:
            before_write()
        self.bridge.pipe_send(data)


def start(bridge: NativeBridge) -> dict[str, object]:
    global _thread, _router
    if _thread is not None:
        raise RuntimeError("native worker already started")
    from .persistence_io import configure_native
    configure_native(bridge)
    from .native_shells import configure_native as configure_native_shells
    configure_native_shells(bridge)
    from .terminal_log_io import configure_native as configure_terminal_logs
    configure_terminal_logs(bridge)
    identity = PipeIdentity.from_env()
    pipe_runtime.configure(lambda envelope: None, identity)
    pipe_runtime.configure_transport(NativePipeTransport(bridge))
    _router = InboundEnvelopeRouter(
        identity=identity, accept_response=pipe_runtime.accept_response,
        accept_notification=pipe_runtime.accept_notification,
        dispatch=pipe_runtime.dispatch_request, reply=pipe_runtime.write_envelope,
        report=lambda message: print(message, file=sys.stderr),
    )

    def run() -> None:
        global _loop, _stop, _debug, _router
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)

        async def lifecycle() -> None:
            global _stop, _debug, _router
            from .intelligence_bootstrap import te2_worker_bootstrap
            _stop = asyncio.Event()
            async with te2_worker_bootstrap():
                def assemble() -> None:
                    from . import main
                    from .socketio_gateway import CODE_TE2_SIO
                    del main, CODE_TE2_SIO
                await assemble_off_loop(assemble)
                # Already imported above; retain statically typed module bindings.
                from . import main
                from .socketio_gateway import CODE_TE2_SIO
                CODE_TE2_SIO.attach(bridge)
                pipe_runtime.configure(main.te2_pipe_dispatch, identity)
                _debug = RuntimeDebugPipe(
                    enabled=os.environ.get("TE2_RUNTIME_DEBUG", "").lower() in {"1", "true", "yes"},
                    identity=identity, reply=pipe_runtime.write_envelope, backend=main,
                )
                _debug.bind(asyncio.get_running_loop())
                _router = InboundEnvelopeRouter(
                    identity=identity, accept_response=pipe_runtime.accept_response,
                    accept_notification=pipe_runtime.accept_notification,
                    dispatch=pipe_runtime.dispatch_request, reply=pipe_runtime.write_envelope,
                    report=lambda message: print(message, file=sys.stderr), debug=_debug,
                )
                await main.te2_app_start()
                _ready.set_result({"namespaces": list(CODE_TE2_SIO.namespace_handlers), "agentIconDir": str(main.AGENT_ICON_DIR)})
                try:
                    _ = await _stop.wait()
                finally:
                    _debug.close()
                    await main.te2_app_stop()
        try:
            _loop.run_until_complete(lifecycle())
        except BaseException as error:
            if not _ready.done():
                _ready.set_exception(error)
            _done.set_exception(error)
        else:
            _done.set_result(None)
        finally:
            pending = asyncio.all_tasks(_loop)
            for task in pending:
                _ = task.cancel()
            _ = _loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            _loop.close()
    _thread = threading.Thread(target=run, name="code-te2-domain", daemon=True)
    _thread.start()
    return _ready.result(timeout=90)


def control(value: object) -> None:
    if _router is None:
        raise RuntimeError("native pipe not initialized")
    try:
        envelope = decode_envelope(value)
    except PipeProtocolError as error:
        pipe_runtime.write_envelope(process_error_response(PipeIdentity.from_env(), PipeError("protocol.invalidFrame", str(error), False)))
        return
    _router.deliver(envelope)


def submit(value: dict[str, object]) -> concurrent.futures.Future[object]:
    loop = _loop
    if loop is None or not loop.is_running():
        raise RuntimeError("native domain loop unavailable")

    async def deliver() -> object:
        if value.get("kind") == "loop":
            loop = asyncio.get_running_loop()
            return {"ok": True, "data": {"process_kind": "app_worker", "app_id": "code_te2",
                    "pid": os.getpid(), "loop_module": type(loop).__module__,
                    "loop_class": type(loop).__name__, "is_uvloop": type(loop).__module__.startswith("uvloop")}}
        if value.get("kind") == "theme":
            from .theme_catalog import load_extension_theme
            return await asyncio.to_thread(load_extension_theme, str(value["extension"]), str(value["file"]))
        from .socketio_gateway import CODE_TE2_SIO
        return await CODE_TE2_SIO.deliver(value)
    return asyncio.run_coroutine_threadsafe(deliver(), loop)


def stop(reason: str) -> None:
    pipe_runtime.close_transport(reason)
    if _debug is not None:
        _debug.close()
    loop, event = _loop, _stop
    if loop is not None and event is not None and loop.is_running():
        _ = loop.call_soon_threadsafe(event.set)
    _done.result(timeout=5)
