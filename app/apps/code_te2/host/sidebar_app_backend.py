"""Backend-owned app launch followed by exact-client Sidebar presentation."""
from __future__ import annotations

from pathlib import Path
from typing import cast

from app.libs import pipe_runtime


def _object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("app launch response must be an object")
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


async def open_sidebar_app(
    *, app_id: str, params: dict[str, object], client_id: str, operation_id: str,
    expected_project_root: Path | None = None,
    source_context: dict[str, object] | None = None, requester_app_id: str | None = None,
) -> dict[str, object]:
    from ..ui_ipc import sidebar_ws
    from ..ui_ipc.sidebar_window_state import list_launcher_apps
    from ..explorer.services import file_ops
    from ..worker_services.event_bus import current_project_generation

    if not operation_id.strip():
        raise ValueError("app open requires operation identity")
    if not any(app.get("id") == app_id for app in list_launcher_apps()):
        raise ValueError("unknown Sidebar app")
    project = (expected_project_root or file_ops.get_project_root()).resolve()
    generation = current_project_generation(project)

    def validate() -> None:
        sidebar_ws.require_live_sidebar_host(client_id)
        if source_context is not None:
            resolved = sidebar_ws.resolve_sidebar_request_client(
                {"target": source_context}, requester_app_id=requester_app_id or "",
                require_presentation=True,
            )[0]
            if resolved != client_id:
                raise ValueError("Sidebar app caller does not match target client")
        if file_ops.get_project_root().resolve() != project or current_project_generation(project) != generation:
            raise ValueError("project changed during app launch")

    validate()
    # App lifecycle remains framework-owned. No HTTP launch/discovery round trip.
    launched = _object(await pipe_runtime.call_async(
        "app.open", {"appId": app_id, "params": dict(params)},
        target_name="framework.rust", target_nid=1, op_id=operation_id,
        timeout_seconds=30,
    ))
    url = launched.get("url")
    if not isinstance(url, str) or not url:
        raise ValueError("app launch did not return a URL")
    # Launch can outlive a client disconnect/project switch. Do not commit a
    # stale presentation; starting the app itself is not rolled back or retried.
    validate()
    return await sidebar_ws.handle_ui_sidebar_window_create_request({
        "app_id": app_id, "url": url, "client_id": client_id,
        "activate": True, "source": "app_intent", "load": "eager",
        "reveal_sidebar": True,
    })
