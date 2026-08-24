# pyright: strict
from __future__ import annotations

from ..open_state_backend import (
    read_sidecar_open_state,
    remove_sidecar_recent_file,
    write_client_foreground,
)
from ..open_state_events import (
    publish_client_foreground_changed,
    publish_document_closed,
)
from ..stores import get_history_store
from ..worker_services.event_bus import current_project_generation

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
    removed, open_state, affected_foregrounds = remove_sidecar_recent_file(
        project_root,
        path,
    )
    if removed:
        _ = history.remove_file(project_root, path)
        source = f"{source_name}:recent_file_close"
        await publish_document_closed(
            open_state,
            closed_path=path,
            affected_foregrounds=affected_foregrounds,
            source=source,
            project_generation=current_project_generation(
                open_state["projectPath"]
            ),
        )
    return {
        "removed": removed,
        "openState": dict(open_state),
    }


async def handle_host_client_foreground_clear_request(
    params: JsonObject,
    *,
    source_name: str,
) -> JsonObject:
    """Clear only the authenticated secondary editor presentation."""
    client_id = params.get("clientInstanceId")
    client_role = params.get("clientRole")
    if not isinstance(client_id, str) or not client_id:
        raise ValueError("client_identity_required")
    if client_role != "secondary":
        raise PermissionError("secondary_client_required")
    project_root = get_history_store().get_active_project()
    if not project_root:
        raise RuntimeError("active_project_missing")
    foreground = write_client_foreground(
        project_root,
        None,
        client_id,
        reason="secondary_editor_closed",
        client_role="secondary",
    )
    open_state = read_sidecar_open_state(
        project_root,
        reason="secondary_editor_closed",
    )
    source = f"{source_name}:secondary_editor_close"
    await publish_client_foreground_changed(
        open_state,
        foreground,
        source=source,
        project_generation=current_project_generation(project_root),
        project_editor_snapshot=True,
    )
    return {
        "ok": True,
        "clientForeground": dict(foreground),
    }
