"""IPC control helpers for shell orchestration."""

from __future__ import annotations

import os
from typing import Any, Dict

import requests

FRAMEWORK_URL = os.environ.get("TE_FRAMEWORK_URL", "http://127.0.0.1:8089").rstrip("/")
FRAMEWORK_TOKEN = os.environ.get("TE_FRAMEWORK_SHELL_TOKEN")


class FrameworkError(RuntimeError):
    """Raised when the framework reports an error handling an IPC action."""


def _auth_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if FRAMEWORK_TOKEN:
        headers["X-Framework-Key"] = FRAMEWORK_TOKEN
    return headers


def spawn_agent(agent: str, cwd: str | None = None, session_id: str | None = None) -> Dict[str, Any]:
    """Synchronously request the framework to spawn an agent shell."""
    payload = {"agent": agent}
    if cwd:
        payload["cwd"] = cwd
    if session_id:
        payload["session_id"] = session_id
    url = f"{FRAMEWORK_URL}/api/internal/agents/spawn"
    resp = requests.post(url, json=payload, headers=_auth_headers(), timeout=15.0)
    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    if resp.status_code >= 400 or not data.get("ok", True):
        raise FrameworkError(data.get("error") or resp.text or "framework returned error")
    return data.get("data", {})
