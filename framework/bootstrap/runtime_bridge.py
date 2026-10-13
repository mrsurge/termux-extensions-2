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

from app.te2_runtime_mounts import mount_te2_runtime_services, te2_runtime_lifespan
from app.memory_profile import install_python_memory_profiler
from app.libs.asyncio_runtime import run


async def health(_request: Request) -> JSONResponse:
    # Starlette adds HEAD to GET routes; FastAPI's old health route did not.
    if _request.method != "GET":
        return JSONResponse({"detail": "Method Not Allowed"}, status_code=405,
                            headers={"Allow": "GET"})
    return JSONResponse({"ok": True, "service": "te2-runtime-bridge"})


def build_app() -> Starlette:
    app = Starlette(lifespan=te2_runtime_lifespan,
                    routes=[Route("/api/health", health, methods=["GET"])])
    mount_te2_runtime_services(app)
    return app


@dataclass(frozen=True)
class BridgeArgs:
    host: str
    port: int


def parse_args() -> BridgeArgs:
    parser = argparse.ArgumentParser(
        prog="te2-runtime-bridge",
        description="Serve the TE2 console and MCP mounts for the Rust framework.",
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
