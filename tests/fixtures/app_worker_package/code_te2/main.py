from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter


TE2_APP_ROUTER = APIRouter()
_started = False


async def te2_app_start() -> None:
    global _started
    _started = True


async def te2_app_stop() -> None:
    path = os.environ.get("TE2_TEST_LIFECYCLE_STOP_FILE")
    if path:
        _ = Path(path).write_text("stopped", encoding="utf-8")


@TE2_APP_ROUTER.get("/identity")
async def identity() -> dict[str, str]:
    assert _started, "transport served before application startup"
    return {
        "app_id": str(os.environ.get("TE_APP_ID") or ""),
        "module": __name__,
    }
