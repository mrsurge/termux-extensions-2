"""Shared CLI/MCP adapter for the Rust-owned diagnostic control plane."""
from __future__ import annotations

import os
import stat
from urllib.parse import urlsplit
from typing import cast

import httpx
import msgspec

from app.te2_paths import te2_runtime_home

_DECODER: msgspec.json.Decoder[object] = msgspec.json.Decoder(object)


def framework_url() -> str:
    return os.environ.get("TE_FRAMEWORK_URL", f"http://127.0.0.1:{os.environ.get('TE_PORT', '8089')}").rstrip("/")


def local_credential(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Remote debug requests require an explicit credential")
    path = te2_runtime_home() / f"runtime-debug-{parsed.port or 80}.json"
    # Do not follow a substituted credential symlink or accept shared-readable files.
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError as exc:
        raise ValueError("No runtime credential; start this framework with --runtime-debug") from exc
    with os.fdopen(descriptor, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        if metadata.st_uid != os.geteuid() or metadata.st_mode & 0o077 or not stat.S_ISREG(metadata.st_mode):
            raise ValueError("Debug credential must be an owned private regular file")
        body = _DECODER.decode(stream.read(4097))
    if not isinstance(body, dict):
        raise ValueError("Invalid debug credential")
    data = cast(dict[str, object], body)
    token = data.get("token")
    if data.get("frameworkUrl") != url or not isinstance(token, str) or len(token) != 64:
        raise ValueError("Debug credential does not match this framework URL")
    return token


async def request_debug(
    operation: str, *, url: str | None = None, credential: str | None = None,
    target: dict[str, str] | None = None, code: str | None = None, timeout_seconds: int = 20,
) -> dict[str, object]:
    if operation not in {"workers", "status", "eval"}:
        raise ValueError("Unknown diagnostic operation")
    if not 1 <= timeout_seconds <= 30:
        raise ValueError("Timeout must be between 1 and 30 seconds")
    if code is not None and len(code.encode("utf-8")) > 32 * 1024:
        raise ValueError("Code exceeds 32 KiB")
    endpoint = (url or framework_url()).rstrip("/")
    token = credential if credential is not None else local_credential(endpoint)
    if not token:
        raise ValueError("Debug credential is required")
    payload: dict[str, object] = {"target": target, "timeoutSeconds": timeout_seconds}
    if code is not None:
        payload["code"] = code
    # No retries or redirects: an uncertain request may already have mutated state.
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds + 5, connect=3), follow_redirects=False, trust_env=False) as client:
        response = await client.request(
            "GET" if operation == "workers" else "POST",
            f"{endpoint}/api/runtime-debug/{operation}",
            headers={"Authorization": f"Bearer {token}"},
            json=None if operation == "workers" else payload,
        )
    body = _DECODER.decode(response.content)
    if not isinstance(body, dict):
        raise ValueError("Invalid framework diagnostic response")
    return cast(dict[str, object], body)
