# /data/data/com.termux/files/home/mrselect/app/libs/app_worker.py
from __future__ import annotations

import asyncio
import argparse
import importlib.util
import inspect
import json
import os
import signal
import sys
import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import AbstractAsyncContextManager, AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from types import FrameType, ModuleType, TracebackType
from typing import Protocol, cast
from urllib import request as urllib_request
from urllib.parse import quote

from fastapi import FastAPI, APIRouter
from starlette.types import ASGIApp
import uvicorn

from app.libs.pipe_protocol import PipeEnvelope
from app.memory_profile import install_python_memory_profiler


JsonObject = dict[str, object]
PipeDispatcher = Callable[[PipeEnvelope], object]
EXPLICIT_APP_ROUTER_EXPORT = "TE2_APP_ROUTER"


class PipeReader(Protocol):
    def readline(self) -> bytes | str: ...


class PipeWriter(Protocol):
    def write(self, data: bytes) -> object: ...

    def flush(self) -> object: ...


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
            subapps.append((path, cast(ASGIApp, subapp)))
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
    if EXPLICIT_APP_ROUTER_EXPORT in module.__dict__:
        explicit_router = cast(object, module.__dict__[EXPLICIT_APP_ROUTER_EXPORT])
        if not isinstance(explicit_router, APIRouter):
            raise RuntimeError(
                f"Backend module for {app_id} exports {EXPLICIT_APP_ROUTER_EXPORT}, but it is not a FastAPI APIRouter"
            )
        return EXPLICIT_APP_ROUTER_EXPORT, explicit_router

    expected_router_name = f"{app_id}_bp"
    candidate = module.__dict__.get(expected_router_name)
    if isinstance(candidate, APIRouter):
        return expected_router_name, candidate
    raise RuntimeError(
        f"Backend module for {app_id} must export {EXPLICIT_APP_ROUTER_EXPORT} or a FastAPI APIRouter named '{expected_router_name}'"
    )


def _raw_frame_has_content(raw: bytes | str) -> bool:
    return bool(raw.strip())


def _run_pipe_worker(app_id: str, module: ModuleType, protocol_stdout: object) -> None:
    from app.libs import pipe_runtime
    from app.libs.pipe_protocol import (
        PipeError,
        PipeIdentity,
        PipeProtocolError,
        decode_line,
        encode_line,
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
    stdout = cast(PipeWriter, getattr(protocol_stdout, "buffer", protocol_stdout))

    def _write_response(envelope: PipeEnvelope) -> None:
        payload = encode_line(envelope)
        _ = stdout.write(payload)
        _ = stdout.flush()

    # Pipe mode reserves stdout for JSONL protocol frames. Backend imports and
    # dispatchers can still log freely because main() redirects sys.stdout first.
    while True:
        raw = stdin.readline()
        if raw in (b"", ""):
            return
        if not _raw_frame_has_content(raw):
            continue
        try:
            request_envelope = decode_line(raw)
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

        response = pipe_runtime.dispatch_request(request_envelope)
        _write_response(response)


def main() -> None:
    parser = argparse.ArgumentParser(description="Termux Extensions App Worker")
    _ = parser.add_argument("--app-id", required=True, help="The ID of the app to run.")
    _ = parser.add_argument("--port", type=int, help="The port to run the HTTP app worker on.")
    _ = parser.add_argument("--backend-module", required=True, help="The path to the backend module.")
    _ = parser.add_argument(
        "--pipe",
        action="store_true",
        help="Run the backend module as a JSONL pipe service.",
    )
    args = _parse_args(parser)
    if not args.pipe and args.port is None:
        parser.error("--port is required unless --pipe is set")

    protocol_stdout: object | None = None
    if args.pipe:
        protocol_stdout = sys.stdout
        sys.stdout = sys.stderr
    os.environ["TE_APP_ID"] = args.app_id
    _ = install_python_memory_profiler(f"app_worker-{args.app_id}")

    mounted_subapps: list[tuple[str, ASGIApp]] = []
    backend_serving_hook: Callable[[], object] | None = None

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        async with AsyncExitStack() as stack:
            for path, subapp in mounted_subapps:
                lifespan_context = _subapp_lifespan_context(subapp)
                if lifespan_context is None:
                    continue
                print(f"DEBUG: Entering lifespan for mounted sub-app at {path}", file=sys.stderr)
                _ = await stack.enter_async_context(lifespan_context(subapp))
            serving_task: asyncio.Task[None]
            hook = backend_serving_hook
            if hook is not None:
                async def _run_backend_serving_hook() -> None:
                    await asyncio.sleep(0.1)
                    try:
                        result = hook()
                        if inspect.isawaitable(result):
                            result = await cast(Awaitable[object], result)
                        if isinstance(result, dict):
                            await asyncio.to_thread(
                                _post_framework_readiness,
                                args.app_id,
                                cast(JsonObject, result),
                            )
                    except Exception as exc:
                        print(f"[app-worker] Backend serving hook failed for {args.app_id}: {exc}", file=sys.stderr)

                serving_task = asyncio.create_task(_run_backend_serving_hook())
            else:
                async def _run_default_backend_serving_post() -> None:
                    await asyncio.sleep(0.1)
                    try:
                        await asyncio.to_thread(_post_framework_readiness, args.app_id)
                    except Exception as exc:
                        print(f"[app-worker] Backend readiness post failed for {args.app_id}: {exc}", file=sys.stderr)

                serving_task = asyncio.create_task(_run_default_backend_serving_post())
            yield
            if not serving_task.done():
                _ = serving_task.cancel()

    app = FastAPI(lifespan=lifespan)

    @app.get("/__te2/runtime/loop")
    async def te2_runtime_loop_probe() -> JsonObject:
        return {"ok": True, "data": _runtime_loop_probe_payload(args.app_id)}

    _ = te2_runtime_loop_probe

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

        if args.pipe and args.port is None:
            if protocol_stdout is None:
                raise RuntimeError("Pipe protocol stdout is not configured")
            _run_pipe_worker(args.app_id, module, protocol_stdout)
            return

        router_name, main_router = _main_router_from_module(module, args.app_id)
        print(
            f"DEBUG: Using main router '{router_name}' with {len(main_router.routes)} routes",
            file=sys.stderr,
        )
        for route in list(main_router.routes)[:10]:
            route_path = getattr(route, "path", "NO_PATH")
            print(f"  - {route_path}", file=sys.stderr)
        if len(main_router.routes) > 10:
            print(f"  ... and {len(main_router.routes) - 10} more routes", file=sys.stderr)
        app.include_router(main_router)
        
        # Mount optional sub-apps if the backend module provides them (fallback)
        subapps = _module_subapps(module)
        if subapps:
            print(f"DEBUG: Mounting {len(subapps)} sub-app(s)", file=sys.stderr)
            for path, subapp in subapps:
                print(f"  - Mounting at {path}", file=sys.stderr)
                mounted_subapps.append((path, subapp))
                app.mount(path, subapp)

        backend_serving_hook = _backend_serving_hook_from_module(module)

    except Exception as e:
        print(f"Error loading app backend: {e}", file=sys.stderr)
        sys.exit(1)

    # Final check: how many routes does the app have?
    print(f"DEBUG: FastAPI app has {len(app.routes)} total routes before uvicorn.run()", file=sys.stderr)
    for route in list(app.routes)[:15]:
        route_path = getattr(route, 'path', 'NO_PATH')
        route_name = getattr(route, 'name', 'NO_NAME')
        print(f"  - {route_path} ({route_name})", file=sys.stderr)
    if len(app.routes) > 15:
        print(f"  ... and {len(app.routes) - 15} more routes", file=sys.stderr)

    if args.pipe:
        if protocol_stdout is None:
            raise RuntimeError("Pipe protocol stdout is not configured")
        pipe_thread = threading.Thread(
            target=_run_pipe_worker,
            args=(args.app_id, module, protocol_stdout),
            name=f"te2-{args.app_id}-pipe-rpc",
            daemon=True,
        )
        pipe_thread.start()
        print(
            f"DEBUG: Started app-worker pipe RPC loop for {args.app_id}",
            file=sys.stderr,
        )
    
    port = args.port
    if port is None:
        raise RuntimeError("--port is required for HTTP app-worker mode")

    print(f"DEBUG: Starting uvicorn on http://127.0.0.1:{port}", file=sys.stderr)

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        lifespan="on",
        timeout_graceful_shutdown=2,
        log_config=None,
    )
    server = uvicorn.Server(config)

    def _force_exit(signum: int, _frame: FrameType | None) -> None:
        print(f"[app-worker] Received signal {signum}; forcing shutdown", file=sys.stderr)
        server.force_exit = True
        server.should_exit = True

    _ = signal.signal(signal.SIGTERM, _force_exit)
    _ = signal.signal(signal.SIGINT, _force_exit)

    server.run()

if __name__ == "__main__":
    main()
