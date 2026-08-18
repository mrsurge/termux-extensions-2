# pyright: strict
from __future__ import annotations

from ..open_state_backend import list_client_foregrounds, remove_sidecar_recent_file
from ..open_state_events import publish_client_foreground_changed
from ..stores import get_history_store
from ..worker_services.event_bus import (
    build_event,
    current_project_generation,
    publish as publish_worker_event,
)

JsonObject = dict[str, object]


def _required_path(params: JsonObject) -> str:
    value = params.get("path")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("path_required")
    return value.strip()


async def handle_host_recent_file_close_request(
    params: JsonObject,
    *,
    source_name: str,
) -> JsonObject:
    """Remove one project-sidecar recent entry and publish its new state."""
    history = get_history_store()
    project_root = history.get_active_project()
    if not project_root:
        raise RuntimeError("active_project_missing")

    path = _required_path(params)
    removed, open_state = remove_sidecar_recent_file(
        project_root,
        path,
    )
    if removed:
        _ = history.remove_file(project_root, path)
        source = f"{source_name}:recent_file_close"
        await publish_worker_event(
            build_event(
                "OpenStateChanged",
                project_root=open_state["projectPath"],
                project_generation=current_project_generation(
                    open_state["projectPath"]
                ),
                source=source,
                payload={
                    "openState": dict(open_state),
                    "source": source,
                },
            )
        )
        for foreground in list_client_foregrounds(
            project_root,
            reason="recent_file_closed",
        ):
            await publish_client_foreground_changed(
                open_state,
                foreground,
                source=source,
            )
    return {
        "removed": removed,
        "openState": dict(open_state),
    }
