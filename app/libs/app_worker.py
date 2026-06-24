# /data/data/com.termux/files/home/mrselect/app/libs/app_worker.py

import asyncio
import argparse
import importlib.util
import inspect
import json
import os
import signal
import sys
import threading
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path
from urllib import request as urllib_request
from urllib.parse import quote

from fastapi import FastAPI, APIRouter
import uvicorn


def _framework_url() -> str:
    explicit = str(os.environ.get("TE_FRAMEWORK_URL") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    port = str(os.environ.get("TE_PORT") or "8089").strip() or "8089"
    return f"http://127.0.0.1:{port}"


def _post_framework_readiness(app_id: str, payload: dict | None = None) -> None:
    body = dict(payload or {})
    body.setdefault("app_id", app_id)
    body.setdefault("status", "ready")
    body.setdefault("phase", "backend_serving")
    body.setdefault("source", "app_worker")
    endpoint = f"{_framework_url()}/api/apps/{quote(app_id, safe='')}/readiness"
    req = urllib_request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib_request.urlopen(req, timeout=5) as resp:
        resp.read()


def _runtime_loop_probe_payload(app_id: str) -> dict:
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


def _run_pipe_worker(app_id: str, module, protocol_stdout) -> None:
    from app.libs.pipe_protocol import (
        PipeEnvelope,
        PipeError,
        PipeIdentity,
        PipeProtocolError,
        decode_line,
        encode_line,
        error_response,
        process_error_response,
        success_response,
    )

    dispatcher = getattr(module, "te2_pipe_dispatch", None)
    if not callable(dispatcher):
        print(
            f"[app-worker] Backend module for {app_id} does not expose te2_pipe_dispatch",
            file=sys.stderr,
        )
        sys.exit(1)

    responder = PipeIdentity.from_env()
    stdin = getattr(sys.stdin, "buffer", sys.stdin)
    stdout = getattr(protocol_stdout, "buffer", protocol_stdout)

    def _target_mismatch(request_envelope: PipeEnvelope) -> PipeError | None:
        target_name = str(request_envelope.target_name or "").strip()
        if target_name and target_name != responder.name:
            return PipeError(
                "protocol.wrongTarget",
                f"request targeted {target_name!r}, but this pipe is {responder.name!r}",
                False,
                {
                    "expectedName": responder.name,
                    "actualName": target_name,
                    "expectedNid": responder.nid,
                    "actualNid": request_envelope.target_nid,
                },
            )
        target_nid = request_envelope.target_nid
        if target_nid is not None and target_nid != responder.nid:
            return PipeError(
                "protocol.wrongTarget",
                f"request targeted NID {target_nid}, but this pipe is NID {responder.nid}",
                False,
                {
                    "expectedName": responder.name,
                    "actualName": target_name or None,
                    "expectedNid": responder.nid,
                    "actualNid": target_nid,
                },
            )
        return None

    def _write_response(envelope) -> None:
        payload = encode_line(envelope)
        if isinstance(payload, bytes):
            stdout.write(payload)
        else:
            stdout.write(payload.encode("utf-8"))
        stdout.flush()

    # Pipe mode reserves stdout for JSONL protocol frames. Backend imports and
    # dispatchers can still log freely because main() redirects sys.stdout first.
    while True:
        raw = stdin.readline()
        if raw in (b"", ""):
            return
        raw_is_blank = not raw.strip() if isinstance(raw, str) else not bytes(raw).strip()
        if raw_is_blank:
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

        if request_envelope.kind != "request":
            _write_response(
                error_response(
                    request_envelope,
                    responder,
                    PipeError(
                        "protocol.expectedRequest",
                        "pipe worker only accepts request envelopes",
                        False,
                    ),
                )
            )
            continue

        target_error = _target_mismatch(request_envelope)
        if target_error is not None:
            _write_response(error_response(request_envelope, responder, target_error))
            continue

        try:
            result = dispatcher(request_envelope)
            if inspect.isawaitable(result):
                result = asyncio.run(result)
            if result is None:
                response = error_response(
                    request_envelope,
                    responder,
                    PipeError(
                        "protocol.methodNotFound",
                        f"Method not found: {request_envelope.method or '<missing>'}",
                        False,
                    ),
                )
            elif isinstance(result, PipeEnvelope):
                response = result
            else:
                response = success_response(request_envelope, responder, result)
        except Exception as exc:
            response = error_response(
                request_envelope,
                responder,
                PipeError("protocol.dispatchFailed", str(exc), True),
            )
            print(f"[app-worker] Pipe dispatch failed for {app_id}: {exc}", file=sys.stderr)
        _write_response(response)


def main():
    parser = argparse.ArgumentParser(description="Termux Extensions App Worker")
    parser.add_argument("--app-id", required=True, help="The ID of the app to run.")
    parser.add_argument("--port", type=int, help="The port to run the HTTP app worker on.")
    parser.add_argument("--backend-module", required=True, help="The path to the backend module.")
    parser.add_argument(
        "--pipe",
        action="store_true",
        help="Run the backend module as a JSONL pipe service.",
    )
    args = parser.parse_args()
    if not args.pipe and args.port is None:
        parser.error("--port is required unless --pipe is set")

    protocol_stdout = None
    if args.pipe:
        protocol_stdout = sys.stdout
        sys.stdout = sys.stderr
    os.environ["TE_APP_ID"] = args.app_id

    mounted_subapps = []
    backend_serving_hook = None

    @asynccontextmanager
    async def lifespan(_app):
        async with AsyncExitStack() as stack:
            for path, subapp in mounted_subapps:
                router = getattr(subapp, "router", None)
                lifespan_context = getattr(router, "lifespan_context", None)
                if lifespan_context is None:
                    continue
                print(f"DEBUG: Entering lifespan for mounted sub-app at {path}", file=sys.stderr)
                await stack.enter_async_context(lifespan_context(subapp))
            serving_task = None
            if callable(backend_serving_hook):
                async def _run_backend_serving_hook():
                    await asyncio.sleep(0.1)
                    try:
                        result = backend_serving_hook()
                        if inspect.isawaitable(result):
                            result = await result
                        if isinstance(result, dict):
                            await asyncio.to_thread(_post_framework_readiness, args.app_id, result)
                    except Exception as exc:
                        print(f"[app-worker] Backend serving hook failed for {args.app_id}: {exc}", file=sys.stderr)

                serving_task = asyncio.create_task(_run_backend_serving_hook())
            else:
                async def _run_default_backend_serving_post():
                    await asyncio.sleep(0.1)
                    try:
                        await asyncio.to_thread(_post_framework_readiness, args.app_id)
                    except Exception as exc:
                        print(f"[app-worker] Backend readiness post failed for {args.app_id}: {exc}", file=sys.stderr)

                serving_task = asyncio.create_task(_run_default_backend_serving_post())
            yield
            if serving_task is not None and not serving_task.done():
                serving_task.cancel()

    app = FastAPI(lifespan=lifespan)

    @app.get("/__te2/runtime/loop")
    async def te2_runtime_loop_probe():
        return {"ok": True, "data": _runtime_loop_probe_payload(args.app_id)}

    try:
        # Add project root to the Python path
        project_root = Path(__file__).resolve().parents[2]
        sys.path.insert(0, str(project_root))

        module_name = f"app.apps.{args.app_id}.{Path(args.backend_module).stem}"
        spec = importlib.util.spec_from_file_location(module_name, args.backend_module)
        if spec is None:
            raise ImportError(f"Could not create spec for module {module_name} at {args.backend_module}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        if args.pipe and not callable(getattr(module, "te2_pipe_dispatch", None)):
            raise RuntimeError(
                f"Backend module for {args.app_id} does not expose te2_pipe_dispatch"
            )

        if args.pipe:
            from app.libs import pipe_runtime
            from app.libs.pipe_protocol import PipeIdentity

            pipe_runtime.configure(
                getattr(module, "te2_pipe_dispatch"),
                PipeIdentity.from_env(),
            )

        if args.pipe and args.port is None:
            _run_pipe_worker(args.app_id, module, protocol_stdout)
            return

        # Look for the main router with app_id in the name (e.g., file_editor_cm6_bp)
        # This ensures we get the main router, not sub-routers that are included in it
        expected_router_name = f"{args.app_id}_bp"
        router_found = False
        router_obj = None
        
        print(f"DEBUG: Looking for main router '{expected_router_name}' in module", file=sys.stderr)
        
        for obj_name in dir(module):
            obj = getattr(module, obj_name)
            if isinstance(obj, APIRouter):
                print(f"DEBUG: Found APIRouter '{obj_name}' with {len(obj.routes)} routes", file=sys.stderr)
                
                # Prioritize exact match with expected name
                if obj_name == expected_router_name:
                    print(f"DEBUG: Using main router '{obj_name}' (exact match)", file=sys.stderr)
                    for route in list(obj.routes)[:10]:
                        route_path = getattr(route, 'path', 'NO_PATH')
                        print(f"  - {route_path}", file=sys.stderr)
                    if len(obj.routes) > 10:
                        print(f"  ... and {len(obj.routes) - 10} more routes", file=sys.stderr)
                    
                    app.include_router(obj)
                    router_obj = obj
                    router_found = True
                    break
        
        if not router_found:
            raise RuntimeError(f"No FastAPI APIRouter named '{expected_router_name}' found in {args.backend_module}")
        
        # Mount optional sub-apps if the backend module provides them (fallback)
        subapps = getattr(module, 'SUBAPPS', None)
        if subapps:
            print(f"DEBUG: Mounting {len(subapps)} sub-app(s)", file=sys.stderr)
            for path, subapp in subapps:
                print(f"  - Mounting at {path}", file=sys.stderr)
                mounted_subapps.append((path, subapp))
                app.mount(path, subapp)

        backend_serving_hook = getattr(module, 'te2_app_backend_serving', None)

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
    
    print(f"DEBUG: Starting uvicorn on http://127.0.0.1:{args.port}", file=sys.stderr)

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=args.port,
        lifespan="on",
        timeout_graceful_shutdown=2.0,
        log_config=None,
    )
    server = uvicorn.Server(config)

    def _force_exit(signum, _frame):
        print(f"[app-worker] Received signal {signum}; forcing shutdown", file=sys.stderr)
        server.force_exit = True
        server.should_exit = True

    signal.signal(signal.SIGTERM, _force_exit)
    signal.signal(signal.SIGINT, _force_exit)

    server.run()

if __name__ == "__main__":
    main()
