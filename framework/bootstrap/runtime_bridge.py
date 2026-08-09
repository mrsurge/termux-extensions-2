from __future__ import annotations

import argparse
import os

import uvicorn
from fastapi import FastAPI

from app.te2_runtime_mounts import mount_te2_runtime_services, te2_runtime_lifespan


def build_app() -> FastAPI:
    app = FastAPI(lifespan=te2_runtime_lifespan)
    mount_te2_runtime_services(app)

    @app.get("/api/health")
    async def health() -> dict[str, object]:
        return {"ok": True, "service": "te2-runtime-bridge"}

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="te2-runtime-bridge",
        description="Serve the TE2 console and MCP mounts for the Rust framework.",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("TE2_RUNTIME_BRIDGE_HOST", "127.0.0.1"),
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("TE2_RUNTIME_BRIDGE_PORT", "0")),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    uvicorn.run(build_app(), host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
