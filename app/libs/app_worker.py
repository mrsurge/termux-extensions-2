# /data/data/com.termux/files/home/mrselect/app/libs/app_worker.py
from __future__ import annotations

# Capture module entry before framework/web imports. This excludes interpreter
# initialization and package loading before Python begins executing this file.
import time
_WORKER_MODULE_ENTRY = time.perf_counter()
import os
from app.libs.runtime_startup_trace import StartupTrace
_startup_trace = StartupTrace(os.environ.get("TE_APP_ID", "unknown"), started=_WORKER_MODULE_ENTRY)
_startup_trace.mark("python.module_entry")

import asyncio
import argparse
import importlib.util
import inspect
import json
import sys
import threading
import socket
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import AbstractAsyncContextManager, AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, TracebackType
from typing import TYPE_CHECKING, Protocol, cast, override
from urllib import request as urllib_request
from urllib.parse import quote

_startup_trace.mark("common_stdlib_imports.end")
if TYPE_CHECKING:
    from fastapi import APIRouter
    from starlette.types import ASGIApp

with _startup_trace.span("worker_support.import"):
    from app.libs.pipe_protocol import PipeEnvelope
    from app.libs.runtime_debug_pipe import RuntimeDebugPipe
    from app.libs.app_lifecycle import application_lifecycle
    from app.memory_profile import install_python_memory_profiler


JsonObject = dict[str, object]
PipeDispatcher = Callable[[PipeEnvelope], object]
EXPLICIT_APP_ROUTER_EXPORT = "TE2_APP_ROUTER"
__all__ = ["main", "EXPLICIT_APP_ROUTER_EXPORT", "_main_router_from_module"]


class PipeReader(Protocol):
    def read1(self, size: int) -> bytes: ...


class HttpResponse(Protocol):
    def read(self) -> bytes: ...


class HttpResponseContext(Protocol):
    def __enter__(self) -> HttpResponse: ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> object: ...


class LifespanContextCallable(Protocol):
    def __call__(self, app: object) -> AbstractAsyncContextManager[object]: ...


@dataclass(frozen=True)
class AppWorkerArgs:
    app_id: str
    port: int | None
    backend_module: str
    pipe: bool
    bootstrap_module: str | None = None


@dataclass(frozen=True)
class PreparedWorker:
    module: ModuleType
    app: ASGIApp
    start_pipe: Callable[[], None]


def _framework_url() -> str:
    explicit = str(os.environ.get("TE_FRAMEWORK_URL") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    port = str(os.environ.get("TE_PORT") or "8089").strip() or "8089"
    return f"http://127.0.0.1:{port}"


def _post_framework_readiness(app_id: str, payload: JsonObject | None = None) -> None:
    body: JsonObject = dict(payload or {})
    _ = body.setdefault("app_id", app_id)
    _ = body.setdefault("status", "ready")
    _ = body.setdefault("phase", "backend_serving")
    _ = body.setdefault("source", "app_worker")
    endpoint = f"{_framework_url()}/api/apps/{quote(app_id, safe='')}/readiness"
    req = urllib_request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    response_context = cast(HttpResponseContext, urllib_request.urlopen(req, timeout=5))
    with response_context as resp:
        _ = resp.read()


def _runtime_loop_probe_payload(app_id: str) -> JsonObject:
    loop = asyncio.get_running_loop()
    loop_type = type(loop)
    return {
        "process_kind": "app_worker",
        "app_id": app_id,
        "pid": os.getpid(),
        "loop_module": loop_type.__module__,
        "loop_class": loop_type.__name__,
        "is_uvloop": loop_type.__module__.startswith("uvloop"),
    }


def _pipe_dispatcher_from_module(module: ModuleType, app_id: str) -> PipeDispatcher:
    dispatcher = getattr(module, "te2_pipe_dispatch", None)
    if not callable(dispatcher):
        raise RuntimeError(f"Backend module for {app_id} does not expose te2_pipe_dispatch")
    return cast(PipeDispatcher, dispatcher)


def _backend_serving_hook_from_module(module: ModuleType) -> Callable[[], object] | None:
    hook = getattr(module, "te2_app_backend_serving", None)
    if not callable(hook):
        return None
    return cast(Callable[[], object], hook)


def _module_subapps(module: ModuleType) -> list[tuple[str, ASGIApp]]:
    raw = getattr(module, "SUBAPPS", None)
    if not isinstance(raw, list | tuple):
        return []
    items = cast(list[object] | tuple[object, ...], raw)
    subapps: list[tuple[str, ASGIApp]] = []
    for item in items:
        if not isinstance(item, tuple):
            continue
        tuple_item = cast(tuple[object, ...], item)
        if len(tuple_item) != 2:
            continue
        path, subapp = tuple_item
        if isinstance(path, str) and callable(subapp):
            # ASGIApp is type-only so pipe workers do not import the web stack.
            subapps.append((path, cast("ASGIApp", subapp)))
    return subapps


def _subapp_lifespan_context(subapp: ASGIApp) -> LifespanContextCallable | None:
    router = getattr(subapp, "router", None)
    lifespan_context = getattr(router, "lifespan_context", None)
    if not callable(lifespan_context):
        return None
    return cast(LifespanContextCallable, lifespan_context)


def _parse_args(parser: argparse.ArgumentParser) -> AppWorkerArgs:
    namespace_obj: object = parser.parse_args()
    return AppWorkerArgs(
        app_id=str(getattr(namespace_obj, "app_id", "") or ""),
        port=_optional_int_arg(getattr(namespace_obj, "port", None)),
        backend_module=str(getattr(namespace_obj, "backend_module", "") or ""),
        pipe=bool(getattr(namespace_obj, "pipe", False)),
        bootstrap_module=str(getattr(namespace_obj, "bootstrap_module", "") or "") or None,
    )


def _optional_int_arg(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    return value if isinstance(value, int) else None


def _legacy_backend_module_name(app_id: str, backend_module: str) -> str:
    return f"app.apps.{app_id}.{Path(backend_module).stem}"


def _backend_module_name(
    app_id: str,
    backend_module: str,
    package_root: Path,
) -> str:
    """Resolve built-in backends from their source package, not public app id."""
    backend_path = Path(backend_module).resolve(strict=False)
    try:
        relative_path = backend_path.relative_to(package_root.resolve(strict=False))
    except ValueError:
        return _legacy_backend_module_name(app_id, backend_module)

    if relative_path.suffix != ".py":
        return _legacy_backend_module_name(app_id, backend_module)
    module_parts = relative_path.with_suffix("").parts
    if not module_parts or any(not part.isidentifier() for part in module_parts):
        return _legacy_backend_module_name(app_id, backend_module)
    return ".".join(module_parts)


def _main_router_from_module(module: ModuleType, app_id: str) -> tuple[str, APIRouter]:
    # Retain the helper for existing callers without importing FastAPI at startup.
    from app.libs.app_worker_fastapi import main_router_from_module as resolve_router

    return resolve_router(module, app_id)


def _pipe_messages(reader: PipeReader) -> Iterator[object]:
    from app.libs.messagepack_stream import MessagePackStream

    decoder = MessagePackStream()
    while chunk := reader.read1(65536):
        yield from decoder.feed(chunk)
    decoder.finish()


def _run_pipe_worker(
    app_id: str, module: ModuleType, protocol_stdout: object,
    debug_pipe: RuntimeDebugPipe | None = None,
) -> None:
    from app.libs import pipe_runtime
    from app.libs.pipe_protocol import (
        PipeError,
        PipeIdentity,
        PipeProtocolError,
        decode_envelope,
        process_error_response,
    )

    try:
        _ = _pipe_dispatcher_from_module(module, app_id)
    except RuntimeError:
        print(
            f"[app-worker] Backend module for {app_id} does not expose te2_pipe_dispatch",
            file=sys.stderr,
        )
        sys.exit(1)

    responder = PipeIdentity.from_env()
    stdin = cast(PipeReader, getattr(sys.stdin, "buffer", sys.stdin))
    pipe_runtime.configure_stdio_transport(protocol_stdout)
    _write_response = pipe_runtime.write_envelope

    # Pipe mode reserves stdout for MessagePack maps. Backend imports and
    # dispatchers can still log freely because main() redirects sys.stdout first.
    messages = _pipe_messages(stdin)
    while True:
        try:
            value = next(messages)
        except StopIteration:
            pipe_runtime.close_stdio_transport("Framework pipe reached EOF")
            if debug_pipe is not None:
                debug_pipe.close()
            return
        except Exception as exc:
            # Unknown frame boundaries cannot safely be skipped. Do not guess
            # where the next request begins after corrupt or truncated input.
            print(f"[app-worker] Invalid MessagePack pipe stream: {exc}", file=sys.stderr)
            pipe_runtime.close_stdio_transport(str(exc))
            if debug_pipe is not None:
                debug_pipe.close()
            return
        try:
            request_envelope = decode_envelope(value)
        except PipeProtocolError as exc:
            _write_response(
                process_error_response(
                    responder,
                    PipeError("protocol.invalidFrame", str(exc), False),
                )
            )
            continue

        if request_envelope.kind in {"response", "error"}:
            if not pipe_runtime.accept_response(request_envelope):
                print(
                    f"[app-worker] Unmatched pipe response id={request_envelope.id!r}",
                    file=sys.stderr,
                )
            continue

        if request_envelope.kind in {"notification", "progress"}:
            if not pipe_runtime.accept_notification(request_envelope):
                print(
                    f"[app-worker] Unhandled pipe notification method={request_envelope.method!r}",
                    file=sys.stderr,
                )
            continue

        if request_envelope.kind != "request":
            _write_response(
                process_error_response(
                    responder,
                    PipeError(
                        "protocol.expectedRequest",
                        "pipe worker only accepts request/response/error envelopes",
                        False,
                    ),
                )
            )
            continue

        # Only the reserved diagnostic lane moves off the reader; ordinary app
        # dispatch keeps its existing ordering and execution behavior.
        if debug_pipe is not None and debug_pipe.submit(request_envelope):
            continue
        response = pipe_runtime.dispatch_request(request_envelope)
        _write_response(response)


def main() -> None:
    parser = argparse.ArgumentParser(description="Termux Extensions App Worker")
    _ = parser.add_argument("--app-id", required=True, help="The ID of the app to run.")
    _ = parser.add_argument("--port", type=int, help="The port to run the HTTP app worker on.")
    _ = parser.add_argument("--backend-module", required=True, help="The path to the backend module.")
    _ = parser.add_argument("--bootstrap-module", help="Opt-in async preparation module for HTTP workers.")
    _ = parser.add_argument(
        "--pipe",
        action="store_true",
        help="Run the backend module as a MessagePack pipe service.",
    )
    args = _parse_args(parser)
    startup_trace = _startup_trace
    startup_trace.app_id = args.app_id
    startup_trace.mark("worker.entry")
    if not args.pipe and args.port is None:
        parser.error("--port is required unless --pipe is set")
    if args.bootstrap_module and args.port is None:
        parser.error("--bootstrap-module requires an HTTP worker (--port)")

    protocol_stdout: object | None = None
    if args.pipe:
        protocol_stdout = sys.stdout
        sys.stdout = sys.stderr
    os.environ["TE_APP_ID"] = args.app_id
    _ = install_python_memory_profiler(f"app_worker-{args.app_id}")

    # Legacy workers keep their synchronous assembly path. Opted-in workers build
    # inside Uvicorn's signal scope, on the very loop that later serves requests.
    prepared = None if args.bootstrap_module else _assemble_worker(args, protocol_stdout)
    if args.port is not None:
        _run_http_worker(args, protocol_stdout, prepared)


def _assemble_worker(args: AppWorkerArgs, protocol_stdout: object | None) -> PreparedWorker | None:
    startup_trace = _startup_trace

    mounted_subapps: list[tuple[str, ASGIApp]] = []
    backend_serving_hook: Callable[[], object] | None = None
    debug_pipe: RuntimeDebugPipe | None = None

    @asynccontextmanager
    async def lifespan(_app: object) -> AsyncIterator[None]:
        startup_trace.mark("lifespan.begin")
        async with AsyncExitStack() as stack:
            for path, subapp in mounted_subapps:
                lifespan_context = _subapp_lifespan_context(subapp)
                if lifespan_context is None:
                    continue
                print(f"DEBUG: Entering lifespan for mounted sub-app at {path}", file=sys.stderr)
                with startup_trace.span("subapp.lifespan:" + path):
                    _ = await stack.enter_async_context(lifespan_context(subapp))
            serving_task: asyncio.Task[None]
            hook = backend_serving_hook
            if hook is not None:
                async def _run_backend_serving_hook() -> None:
                    await asyncio.sleep(0.1)
                    try:
                        with startup_trace.span("backend.serving_hook"):
                            result = hook()
                            if inspect.isawaitable(result):
                                result = await cast(Awaitable[object], result)
                        if isinstance(result, dict):
                            await asyncio.to_thread(
                                _post_framework_readiness,
                                args.app_id,
                                cast(JsonObject, result),
                            )
                            startup_trace.mark("framework.readiness_posted")
                    except Exception as exc:
                        print(f"[app-worker] Backend serving hook failed for {args.app_id}: {exc}", file=sys.stderr)

                serving_task = asyncio.create_task(_run_backend_serving_hook())
            else:
                async def _run_default_backend_serving_post() -> None:
                    await asyncio.sleep(0.1)
                    try:
                        await asyncio.to_thread(_post_framework_readiness, args.app_id)
                        startup_trace.mark("framework.readiness_posted")
                    except Exception as exc:
                        print(f"[app-worker] Backend readiness post failed for {args.app_id}: {exc}", file=sys.stderr)

                serving_task = asyncio.create_task(_run_default_backend_serving_post())
            # Publish the live loop only after mounted apps have initialized.
            if debug_pipe is not None:
                debug_pipe.bind(asyncio.get_running_loop())
            try:
                startup_trace.mark("lifespan.ready")
                yield
            finally:
                if debug_pipe is not None:
                    debug_pipe.close()
                if not serving_task.done():
                    _ = serving_task.cancel()
                _ = await asyncio.gather(serving_task, return_exceptions=True)

    try:
        # Add project root to the Python path
        project_root = Path(__file__).resolve().parents[2]
        sys.path.insert(0, str(project_root))

        module_name = _backend_module_name(args.app_id, args.backend_module, project_root)
        spec = importlib.util.spec_from_file_location(module_name, args.backend_module)
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not create spec for module {module_name} at {args.backend_module}")
        module: ModuleType = importlib.util.module_from_spec(spec)
        previous_module = sys.modules.get(module_name)
        sys.modules[module_name] = module
        try:
            with startup_trace.span("backend.import"):
                spec.loader.exec_module(module)
        except BaseException:
            if previous_module is None:
                _ = sys.modules.pop(module_name, None)
            else:
                sys.modules[module_name] = previous_module
            raise

        if args.pipe:
            from app.libs import pipe_runtime
            from app.libs.pipe_protocol import PipeIdentity

            pipe_dispatcher = _pipe_dispatcher_from_module(module, args.app_id)
            pipe_runtime.configure(
                pipe_dispatcher,
                PipeIdentity.from_env(),
            )
            if protocol_stdout is None:
                raise RuntimeError("Pipe protocol stdout is not configured")
            pipe_runtime.configure_stdio_transport(protocol_stdout)
            debug_pipe = RuntimeDebugPipe(
                enabled=os.environ.get("TE2_RUNTIME_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"},
                identity=PipeIdentity.from_env(),
                reply=pipe_runtime.write_envelope,
                backend=module,
            )

        if args.pipe and args.port is None:
            if protocol_stdout is None:
                raise RuntimeError("Pipe protocol stdout is not configured")
            _run_pipe_worker(args.app_id, module, protocol_stdout, debug_pipe)
            return

        from app.libs.app_worker_asgi import explicit_asgi_application, WorkerASGI

        native_app = explicit_asgi_application(module, args.app_id)
        if native_app is not None:
            app = WorkerASGI(
                native_app, lifespan=lifespan,
                loop_probe=lambda: _runtime_loop_probe_payload(args.app_id),
            )
        else:
            with startup_trace.span("fastapi.import"):
                from app.libs.app_worker_fastapi import build_fastapi_application
            mounted_subapps.extend(_module_subapps(module))
            app = build_fastapi_application(
                module, args.app_id, lifespan=lifespan, subapps=mounted_subapps,
                loop_probe=lambda: _runtime_loop_probe_payload(args.app_id),
            )

        backend_serving_hook = _backend_serving_hook_from_module(module)
        startup_trace.mark("backend.assembled")

    except Exception as e:
        print(f"Error loading app backend: {e}", file=sys.stderr)
        raise RuntimeError(f"Error loading app backend: {e}") from e

    def start_pipe() -> None:
        if args.pipe:
            if protocol_stdout is None:
                raise RuntimeError("Pipe protocol stdout is not configured")
            pipe_thread = threading.Thread(
                target=_run_pipe_worker,
                args=(args.app_id, module, protocol_stdout, debug_pipe),
                name=f"te2-{args.app_id}-pipe-rpc",
                daemon=True,
            )
            pipe_thread.start()
            print(f"DEBUG: Started app-worker pipe RPC loop for {args.app_id}", file=sys.stderr)

    return PreparedWorker(module, app, start_pipe)


def _run_http_worker(
    args: AppWorkerArgs, protocol_stdout: object | None, prepared: PreparedWorker | None,
) -> None:
    startup_trace = _startup_trace
    port = args.port
    if port is None:
        raise RuntimeError("--port is required for HTTP app-worker mode")

    print(f"DEBUG: Starting uvicorn on http://127.0.0.1:{port}", file=sys.stderr)

    with startup_trace.span("uvicorn.import"):
        import uvicorn

    config = uvicorn.Config(
        prepared.app if prepared is not None else "te2-worker:pending-bootstrap",
        host="127.0.0.1",
        port=port,
        lifespan="on",
        timeout_graceful_shutdown=2,
        log_config=None,
    )
    # Uvicorn's startup returns after socket creation, unlike ASGI lifespan which
    # runs before listening. Observe that boundary without changing its ordering.
    class StartupObservedServer(uvicorn.Server):
        @override
        async def _serve(self, sockets: list[socket.socket] | None = None) -> None:
            # Worker-owned services surround the transport, not its ASGI lifespan.
            # Stay inside serve()'s signal scope: it re-raises SIGTERM on exit,
            # so an outer serve() finally would never finish application cleanup.
            async with AsyncExitStack() as stack:
                worker = prepared
                if args.bootstrap_module:
                    from app.libs.app_worker_bootstrap import bootstrap_context, assemble_off_loop

                    _ = await stack.enter_async_context(bootstrap_context(args.bootstrap_module))
                    worker = await assemble_off_loop(lambda: _assemble_worker(args, protocol_stdout))
                if worker is None:
                    raise RuntimeError("HTTP worker assembly did not return an application")
                if self.should_exit:
                    return
                self.config.app = worker.app
                worker.start_pipe()
                _ = await stack.enter_async_context(application_lifecycle(worker.module))
                await super()._serve(sockets=sockets)

        @override
        async def startup(self, sockets: list[socket.socket] | None = None) -> None:
            with startup_trace.span("uvicorn.startup"):
                await super().startup(sockets=sockets)
            if self.started:
                startup_trace.mark("listener.ready")

    server = StartupObservedServer(config)

    server.run()

if __name__ == "__main__":
    main()
