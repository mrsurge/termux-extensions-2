"""Private typed access to the existing console owner, not an MCP dispatcher."""
from __future__ import annotations

import asyncio
import hmac
import math
from collections.abc import Awaitable, Callable

import msgspec
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

MAX_BODY = 8 * 1024 * 1024
Workers = Callable[[], list[str]]
Evaluate = Callable[[str, str, float], Awaitable[dict[str, object]]]


class EvalRequest(msgspec.Struct, forbid_unknown_fields=True):
    target_worker_id: str
    code: str
    timeout_seconds: float = 20.0


def console_owner_routes(token: str, workers: Workers, evaluate: Evaluate) -> list[Route]:
    def authorized(request: Request) -> bool:
        supplied = request.headers.get("x-te2-owner-key", "")
        return bool(token) and hmac.compare_digest(token.encode(), supplied.encode())

    async def list_workers(request: Request) -> JSONResponse:
        if not authorized(request):
            return JSONResponse({"error": "consoleOwner.unauthorized"}, status_code=401)
        return JSONResponse({"workers": workers(), "source": "te2_console.runtime"})

    async def eval_worker(request: Request) -> JSONResponse:
        if not authorized(request):
            return JSONResponse({"error": "consoleOwner.unauthorized"}, status_code=401)
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_BODY:
                return JSONResponse({"error": "consoleOwner.bodyTooLarge"}, status_code=413)
            body.extend(chunk)
        try:
            payload = msgspec.json.decode(body, type=EvalRequest)
            if not math.isfinite(payload.timeout_seconds):
                raise ValueError("timeout must be finite")
        except (msgspec.DecodeError, ValueError):
            return JSONResponse({"error": "consoleOwner.invalidRequest"}, status_code=400)
        try:
            return JSONResponse(await evaluate(payload.target_worker_id, payload.code, payload.timeout_seconds))
        except LookupError as exc:
            return JSONResponse({"ok": False, "error_type": "worker_not_registered", "error": str(exc), "workers": workers()})
        except asyncio.TimeoutError:
            return JSONResponse({"ok": False, "error_type": "eval_timeout",
                                 "error": f"console eval timed out after {payload.timeout_seconds:g}s",
                                 "target_worker_id": payload.target_worker_id, "workers": workers()})

    return [Route("/internal/console/workers", list_workers, methods=["GET"]),
            Route("/internal/console/eval", eval_worker, methods=["POST"])]
