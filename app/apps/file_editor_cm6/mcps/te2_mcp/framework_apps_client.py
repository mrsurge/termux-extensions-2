from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx


_TIMEOUT = httpx.Timeout(15.0, connect=3.0)


def _framework_url() -> str:
    return os.environ.get("TE_FRAMEWORK_URL", "http://127.0.0.1:8089").rstrip("/")


@dataclass(slots=True)
class FrameworkAppsClient:
    async def reload_apps(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_framework_url()}/api/apps/reload")
            resp.raise_for_status()
            body = resp.json()
        return body.get("data") if isinstance(body, dict) and "data" in body else body

    async def start_app(self, app_id: str) -> dict[str, Any]:
        safe_app_id = str(app_id or "").strip()
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_framework_url()}/api/apps/{safe_app_id}/start")
            resp.raise_for_status()
            body = resp.json()
        return body.get("data") if isinstance(body, dict) and "data" in body else body

    async def open_app(self, app_id: str) -> dict[str, Any]:
        safe_app_id = str(app_id or "").strip()
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_framework_url()}/api/apps/{safe_app_id}/open", json={})
            resp.raise_for_status()
            body = resp.json()
        return body.get("data") if isinstance(body, dict) and "data" in body else body

    async def get_catalog(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_framework_url()}/api/apps/catalog")
            resp.raise_for_status()
            body = resp.json()
        data = body.get("data") if isinstance(body, dict) else body
        return data if isinstance(data, list) else []
