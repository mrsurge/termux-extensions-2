# pyright: strict
"""Lazy compatibility assembly for apps that still export FastAPI routers."""
from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from types import ModuleType
from typing import cast
import sys

from fastapi import APIRouter, FastAPI
from starlette.types import ASGIApp

EXPLICIT_APP_ROUTER_EXPORT = "TE2_APP_ROUTER"

def main_router_from_module(module: ModuleType, app_id: str) -> tuple[str, APIRouter]:
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


# This module is imported only after selecting the router-based app contract.
# Keep existing SUBAPPS mounting/lifespan ownership in the worker compatibility path.
def build_fastapi_application(
    module: ModuleType, app_id: str, *,
    lifespan: Callable[[object], AbstractAsyncContextManager[None]],
    subapps: list[tuple[str, ASGIApp]],
    loop_probe: Callable[[], dict[str, object]],
) -> ASGIApp:
    app = FastAPI(lifespan=lifespan)

    @app.get("/__te2/runtime/loop")
    async def runtime_loop() -> dict[str, object]:
        return {"ok": True, "data": loop_probe()}

    _ = runtime_loop
    router_name, main_router = main_router_from_module(module, app_id)
    print(f"DEBUG: Using main router '{router_name}' with {len(main_router.routes)} routes", file=sys.stderr)
    app.include_router(main_router)
    for path, subapp in subapps:
        print(f"DEBUG: Mounting at {path}", file=sys.stderr)
        app.mount(path, subapp)
    print(f"DEBUG: FastAPI app has {len(app.routes)} total routes before uvicorn.run()", file=sys.stderr)
    for route in list(app.routes)[:15]:
        print(f"  - {getattr(route, 'path', 'NO_PATH')} ({getattr(route, 'name', 'NO_NAME')})", file=sys.stderr)
    return app
