# pyright: strict
from __future__ import annotations

import importlib
from typing import Awaitable, Callable, cast

from ..monaco_editor.editor_backend_services.contracts import JsonMap

RunActiveFileHook = Callable[[dict[str, object] | None], Awaitable[dict[str, object]]]


async def handle_host_run_active_file_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    payload: JsonMap = dict(data)
    if "source_client" not in payload:
        payload["source_client"] = source_name
    terminal_backend = importlib.import_module("app.apps.file_editor_cm6.terminal_backend")
    hook = cast(RunActiveFileHook, getattr(terminal_backend, "handle_run_active_file_request"))
    return await hook(payload)
