"""Bounded opt-in dispatch for trusted live-worker diagnostics/evaluation."""
from __future__ import annotations

import asyncio
import concurrent.futures
import sys
import threading
from types import ModuleType
from collections.abc import Awaitable, Callable
from typing import Protocol, cast, final
from app.libs.runtime_debug_eval import DebugEvalError, evaluate

from app.libs.pipe_protocol import PipeEnvelope, PipeError, PipeIdentity, error_response, success_response

DebugHandler = Callable[[PipeEnvelope], Awaitable[object]]
class ReplyWriter(Protocol):
    def __call__(self, envelope: PipeEnvelope, before_write: Callable[[], None] | None = None) -> None: ...


@final
class RuntimeDebugPipe:
    """Own one bounded debug operation without borrowing the pipe-reader loop."""

    def __init__(
        self, *, enabled: bool, identity: PipeIdentity, reply: ReplyWriter,
        handler: DebugHandler | None = None,
        backend: ModuleType | None = None,
    ) -> None:
        self._enabled = enabled
        self._identity = identity
        self._reply = reply
        self._handler = handler or self._status
        self._backend = backend
        self._lock = threading.RLock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._closed = False
        self._pending: concurrent.futures.Future[None] | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            # EOF can precede HTTP startup; it disables diagnostics, not the app.
            if self._closed:
                return
            if self._loop is not None:
                raise RuntimeError("Diagnostic loop cannot be rebound")
            self._loop = loop

    def close(self) -> None:
        # Cancellation is cooperative, never a promise to roll back mutations.
        with self._lock:
            self._closed = True
            self._loop = None
            pending = self._pending
        if pending is not None:
            _ = pending.cancel()

    def submit(self, request: PipeEnvelope) -> bool:
        if not (request.method or "").startswith("runtime.debug."):
            return False
        with self._lock:
            loop = self._loop
            if not self._enabled:
                code = "runtimeDebug.disabled"
            elif request.target_name not in (None, "", self._identity.name) or request.target_nid not in (None, self._identity.nid):
                code = "protocol.wrongTarget"
            elif self._closed or loop is None or not loop.is_running():
                code = "runtimeDebug.unavailable"
            elif self._pending is not None:
                code = "runtimeDebug.busy"
            else:
                # Reserve before returning to stdin. No unbounded coroutine queue.
                operation = self._run(request)
                try:
                    future = asyncio.run_coroutine_threadsafe(operation, loop)
                except RuntimeError:
                    operation.close()
                    code = "runtimeDebug.unavailable"
                else:
                    self._pending = future
                    future.add_done_callback(self._finished)
                    return True
        self._reply(error_response(request, self._identity, PipeError(code, code, False)))
        return True

    def _finished(self, future: concurrent.futures.Future[None]) -> None:
        with self._lock:
            if self._pending is future:
                self._pending = None
        if not future.cancelled():
            error = future.exception()
            if error is not None:
                print(f"[runtime-debug] diagnostic reply failed: {type(error).__name__}", file=sys.stderr)

    async def _run(self, request: PipeEnvelope) -> None:
        with self._lock:
            if self._closed:
                return
            pending = self._pending
        try:
            result = await self._handler(request)
            response = result if isinstance(result, PipeEnvelope) else success_response(request, self._identity, result)
        except asyncio.CancelledError:
            raise
        except DebugEvalError as exc:
            response = error_response(request, self._identity, PipeError(exc.code, str(exc)[:1024], False))
        except Exception as exc:
            # Error text is bounded and does not invoke arbitrary object repr.
            response = error_response(request, self._identity, PipeError(
                "runtimeDebug.failed", f"{type(exc).__name__}: {str(exc)[:1024]}", False,
            ))
        # Pipe writes can block; never perform them on the app event loop.
        def release_admission() -> None:
            with self._lock:
                if self._pending is pending:
                    self._pending = None

        await asyncio.to_thread(self._reply, response, release_admission)

    async def _status(self, request: PipeEnvelope) -> object:
        if request.method == "runtime.debug.eval":
            params = cast(dict[str, object], request.params) if isinstance(request.params, dict) else {}
            code = params.get("code")
            if not isinstance(code, str):
                raise DebugEvalError("runtimeDebug.invalidCode", "code must be a string")
            if self._backend is None:
                raise DebugEvalError("runtimeDebug.unavailable", "Live backend module is unavailable")
            return await evaluate(code, self._backend)
        if request.method != "runtime.debug.status":
            return error_response(request, self._identity, PipeError(
                "protocol.methodNotFound", "Unknown runtime diagnostic method", False,
            ))
        return {"enabled": True, "loopRunning": asyncio.get_running_loop().is_running(), "threadId": threading.get_ident()}
