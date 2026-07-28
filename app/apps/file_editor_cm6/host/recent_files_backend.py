# pyright: strict
from __future__ import annotations

from ..open_state_backend import remove_sidecar_recent_file
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
    project_root = get_history_store().get_active_project()
    if not project_root:
        raise RuntimeError("active_project_missing")

    removed, open_state = remove_sidecar_recent_file(
        project_root,
        _required_path(params),
    )
    if removed:
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
    return {
        "removed": removed,
        "openState": dict(open_state),
    }
