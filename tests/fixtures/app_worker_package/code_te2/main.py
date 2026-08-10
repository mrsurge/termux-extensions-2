from __future__ import annotations

import os

from fastapi import APIRouter


TE2_APP_ROUTER = APIRouter()


@TE2_APP_ROUTER.get("/identity")
async def identity() -> dict[str, str]:
    return {
        "app_id": str(os.environ.get("TE_APP_ID") or ""),
        "module": __name__,
    }
