from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from typing import cast

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.te2_runtime_mounts import mount_te2_runtime_services
from app.memory_profile import install_python_memory_profiler
from app.libs.asyncio_runtime import run
from app.libs.native_console_owner import console_owner_routes
from app.te2_console_runtime import list_console_workers, request_console_eval
from app.libs.native_scaffold_owner import scaffold_owner_routes
from app.libs.native_fws_log_owner import fws_log_owner_routes
from app.libs.native_selection_owner import native_selection_owner_routes
from app.extensions.apps.scaffold import list_templates, validate_proxy_shell_wrapper, scaffold_proxy_shell_wrapper


async def health(_request: Request) -> JSONResponse:
    # Starlette adds HEAD to GET routes; FastAPI's old health route did not.
    if _request.method != "GET":
        return JSONResponse({"detail": "Method Not Allowed"}, status_code=405,
                            headers={"Allow": "GET"})
    return JSONResponse({"ok": True, "service": "te2-runtime-bridge"})


def build_app() -> Starlette:
    async def evaluate(worker: str, code: str, timeout: float) -> dict[str, object]:
        return await request_console_eval(worker, code, timeout_seconds=timeout)

    owner_key = os.environ.get("TE2_RUNTIME_OWNER_KEY", "")
    app = Starlette(routes=[
        Route("/api/health", health, methods=["GET"]),
        *console_owner_routes(owner_key, list_console_workers, evaluate),
        *scaffold_owner_routes(owner_key, list_templates, validate_proxy_shell_wrapper,
                              scaffold_proxy_shell_wrapper),
        *fws_log_owner_routes(owner_key),
        *native_selection_owner_routes(owner_key, os.environ),
    ])
    mount_te2_runtime_services(app)
    return app


@dataclass(frozen=True)
class BridgeArgs:
    host: str
    port: int


def parse_args() -> BridgeArgs:
    parser = argparse.ArgumentParser(
        prog="te2-runtime-bridge",
        description="Serve the TE2 console relay and private owner APIs for the Rust framework.",
    )
    _ = parser.add_argument(
        "--host",
        default=os.environ.get("TE2_RUNTIME_BRIDGE_HOST", "127.0.0.1"),
    )
    _ = parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("TE2_RUNTIME_BRIDGE_PORT", "0")),
    )
    args = parser.parse_args()
    return BridgeArgs(host=cast(str, args.host), port=cast(int, args.port))


def main() -> int:
    args = parse_args()
    _ = install_python_memory_profiler("runtime_bridge")
    config = uvicorn.Config(build_app(), host=args.host, port=args.port,
                            log_level="info", loop="asyncio")
    run(uvicorn.Server(config).serve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
