"""Capability-protected, read-only native selector on the existing sidecar."""
from __future__ import annotations

import asyncio
import hmac
import threading
from collections.abc import Mapping
from typing import Literal, cast

import msgspec
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from app.cli.native_selection import (
    CONTEXT_ENV, MAX_SELECTION_BYTES, NativeSelector, SelectionSnapshot, decode_context,
)
from app.cli.run_rust_framework import _load_bootstrap_module


class SelectionRequest(msgspec.Struct, forbid_unknown_fields=True):
    schema_version: Literal[1]


def failure(code: str, status: int) -> JSONResponse:
    payload: dict[str, str] = {'error': code}
    headers: dict[str, str] = {'Cache-Control': 'no-store'}
    return JSONResponse(payload, status_code=status, headers=headers)


def load_selector() -> NativeSelector:
    module = _load_bootstrap_module()
    callback = cast(object, getattr(module, 'native_selection_snapshot', None))
    if not callable(callback):
        raise ValueError('Bootstrap lacks native selection contract')
    return cast(NativeSelector, callback)


def native_selection_owner_routes(token: str, environment: Mapping[str, str],
                                  selector: NativeSelector | None = None) -> list[Route]:
    env = dict(environment)
    gate = threading.Lock()

    def resolve() -> bytes:
        try:
            context = decode_context(env[CONTEXT_ENV])
            result = (selector or load_selector())(env, context)
            if not isinstance(result, SelectionSnapshot):
                raise ValueError('Invalid native selection result')
            data = msgspec.json.encode(result)
            if len(data) > MAX_SELECTION_BYTES:
                raise ValueError('Native selection response exceeds byte limit')
            return data
        except SystemExit as exc:
            raise ValueError('Native selection rejected invalid declaration') from exc
        finally:
            gate.release()

    def consume_failure(task: asyncio.Task[bytes]) -> None:
        if not task.cancelled():
            task.exception()

    async def dispatch(request: Request) -> Response:
        headers: dict[str, str] = {'Cache-Control': 'no-store'}
        if not token or not hmac.compare_digest(token.encode(), request.headers.get('x-te2-owner-key', '').encode()):
            return failure('nativeSelection.unauthorized', 401)
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 4096:
                return failure('nativeSelection.bodyTooLarge', 413)
            body.extend(chunk)
        try:
            msgspec.json.decode(body, type=SelectionRequest)
        except msgspec.DecodeError:
            return failure('nativeSelection.invalidRequest', 400)
        if CONTEXT_ENV not in env:
            return failure('nativeSelection.preparationRequired', 503)
        if not gate.acquire(blocking=False):
            return failure('nativeSelection.busy', 503)
        # Cancellation does not release admission while the off-loop scan lives.
        task = asyncio.create_task(asyncio.to_thread(resolve))
        task.add_done_callback(consume_failure)
        try:
            data = await asyncio.shield(task)
        except Exception:
            return failure('nativeSelection.failed', 503)
        return Response(data, media_type='application/json', headers=headers)

    return [Route('/internal/native-runtime/select', dispatch, methods=['POST'])]
