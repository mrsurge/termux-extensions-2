"""Correlated extension-host requests for canonical visible editor navigation."""

from __future__ import annotations

import asyncio
import importlib
import logging
from typing import Protocol, cast

JsonObject = dict[str, object]

log = logging.getLogger("extension_navigation_backend")

_pending_open_completions: dict[
    str,
    tuple[str, asyncio.Future[JsonObject]],
] = {}
_navigation_tasks: set[asyncio.Task[None]] = set()


class AdapterRpc(Protocol):
    async def __call__(
        self,
        method: str,
        params: JsonObject | None = None,
        timeout: float = 30.0,
    ) -> JsonObject: ...


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def resolve_extension_open_complete(
    payload: JsonObject,
    client_instance_id: str,
) -> bool:
    """Resolve the exact pending WBA open after Monaco publishes openComplete."""
    request_id = str(payload.get("request_id") or payload.get("requestId") or "")
    if not request_id:
        return False
    waiting = _pending_open_completions.get(request_id)
    if waiting is None:
        return False
    expected_client, future = waiting
    if expected_client != client_instance_id or future.done():
        return False
    future.set_result(dict(payload))
    return True


async def _notify_wba(params: JsonObject) -> None:
    module = importlib.import_module(
        "app.apps.code_te2.workbench_adapter_shell_manager"
    )
    adapter_rpc = cast(AdapterRpc, getattr(module, "adapter_rpc"))

    response = await adapter_rpc(
        "vscode.extensionNavigation.complete",
        params,
        timeout=10.0,
    )
    error = response.get("error")
    if error:
        raise RuntimeError(f"WBA navigation completion failed: {error}")


async def _run_extension_open(event: JsonObject) -> None:
    request_id = str(event.get("requestId") or event.get("request_id") or "")
    path = str(event.get("path") or "")
    client_instance_id = str(event.get("clientInstanceId") or "")
    if not request_id or not path or not client_instance_id:
        log.warning("ignored malformed extension open request")
        return

    loop = asyncio.get_running_loop()
    completion: asyncio.Future[JsonObject] = loop.create_future()
    previous = _pending_open_completions.pop(request_id, None)
    if previous is not None and not previous[1].done():
        _ = previous[1].cancel("extension open request was replaced")
    _pending_open_completions[request_id] = (client_instance_id, completion)

    try:
        from .host.file_ops_backend import handle_host_open_request

        _ = await handle_host_open_request(
            {
                "path": path,
                "request_id": request_id,
                "line": event.get("line"),
                "column": event.get("column"),
                "focus": event.get("focus"),
                "source": "extension_navigation",
                "reason": "extension_navigation",
            },
            source_name=client_instance_id,
            request_prefix="extension_open",
        )
        completed = await asyncio.wait_for(completion, timeout=20.0)
        completed_path = str(completed.get("path") or "")
        if completed_path and completed_path != path:
            raise RuntimeError("editor open completed for a different path")
        await _notify_wba(
            {
                "ok": True,
                "requestId": request_id,
                "path": path,
                "clientInstanceId": client_instance_id,
            }
        )
    except Exception as exc:
        log.warning("extension open failed request=%s path=%s: %s", request_id, path, exc)
        try:
            await _notify_wba(
                {
                    "ok": False,
                    "requestId": request_id,
                    "path": path,
                    "clientInstanceId": client_instance_id,
                    "error": str(exc),
                }
            )
        except Exception as notify_exc:
            log.warning(
                "extension open failure acknowledgement failed request=%s: %s",
                request_id,
                notify_exc,
            )
    finally:
        current = _pending_open_completions.get(request_id)
        if current is not None and current[1] is completion:
            _ = _pending_open_completions.pop(request_id, None)


def schedule_extension_open(event: JsonObject) -> None:
    """Schedule without blocking the Framework-Shell stdout push drain."""
    task = asyncio.create_task(
        _run_extension_open(_json_object(event)),
        name=f"extension_editor_open:{event.get('requestId') or 'unknown'}",
    )
    _navigation_tasks.add(task)
    task.add_done_callback(_navigation_tasks.discard)


def reset_extension_navigation(reason: str = "extension navigation reset") -> None:
    for _, future in list(_pending_open_completions.values()):
        if not future.done():
            _ = future.cancel(reason)
    _pending_open_completions.clear()
    for task in list(_navigation_tasks):
        _ = task.cancel()
    _navigation_tasks.clear()
