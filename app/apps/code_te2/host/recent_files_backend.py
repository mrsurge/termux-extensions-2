# pyright: strict
from __future__ import annotations

from ..open_state_backend import (
    read_sidecar_open_state,
    remove_sidecar_recent_file,
    write_client_foreground,
    close_client_presentation,
    close_client_area,
)
from ..open_state_events import (
    publish_client_foreground_changed,
    publish_document_closed,
    publish_open_state_changed,
)
from ..stores import get_history_store
from ..worker_services.event_bus import current_project_generation
from .secondary_content_backend import close_secondary_content
from ..editor_renderer_bindings import registered_editor_renderer_binding

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
    if registered_editor_renderer_binding(source_name) is not None:
        revision, generation = params.get("revision"), params.get("projectGeneration")
        requested_project = params.get("projectPath")
        if requested_project != project_root:
            raise ValueError("editor_project_changed")
        if (not isinstance(revision, int) or isinstance(revision, bool)
                or not isinstance(generation, int) or isinstance(generation, bool)):
            raise ValueError("updated_editor_assets_required_for_tab_close")
        result = close_client_presentation(project_root, path, source_name,
                                           expected_revision=revision, expected_generation=generation)
        source = f"{source_name}:presentation_close"
        if result["kind"] == "document":
            _ = history.remove_file(project_root, path)
            await publish_document_closed(result["openState"], closed_path=path,
                                          affected_foregrounds=result["affectedForegrounds"], source=source,
                                          project_generation=generation)
        else:
            await publish_open_state_changed(result["openState"], source=source, project_generation=generation)
            for foreground in result["affectedForegrounds"]:
                await publish_client_foreground_changed(result["openState"], foreground, source=source,
                                                        project_generation=generation, project_editor_snapshot=True)
        return {"removed": True, "kind": result["kind"], "openState": dict(result["openState"]),
                "successor": result["successor"], "clientForeground": dict(result["clientForeground"])}
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
    if registered_editor_renderer_binding(source_name) is not None and client_id != source_name:
        raise PermissionError("client_identity_mismatch")
    project_root = get_history_store().get_active_project()
    if not project_root:
        raise RuntimeError("active_project_missing")
    if registered_editor_renderer_binding(source_name) is not None:
        revision, generation = params.get("revision"), params.get("projectGeneration")
        if params.get("projectPath") != project_root:
            raise ValueError("editor_project_changed")
        if (not isinstance(revision, int) or isinstance(revision, bool)
                or not isinstance(generation, int) or isinstance(generation, bool)):
            raise ValueError("updated_editor_assets_required_for_area_close")
        result = close_client_area(project_root, source_name, expected_revision=revision,
                                   expected_generation=generation)
        close_secondary_content(client_id)
        source = f"{source_name}:secondary_area_close"
        for path in result["closedDocuments"]:
            get_history_store().remove_file(project_root, path)
            await publish_document_closed(result["openState"], closed_path=path,
                affected_foregrounds=result["affectedForegrounds"], source=source,
                project_generation=generation)
        if not result["closedDocuments"]:
            await publish_open_state_changed(result["openState"], source=source, project_generation=generation)
            for foreground in result["affectedForegrounds"]:
                await publish_client_foreground_changed(result["openState"], foreground,
                    source=source, project_generation=generation, project_editor_snapshot=True)
        return {"ok": True, "openState": dict(result["openState"]),
                "clientForeground": dict(result["clientForeground"])}
    foreground = write_client_foreground(
        project_root,
        None,
        client_id,
        reason="secondary_editor_closed",
        client_role="secondary",
    )
    close_secondary_content(client_id)
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
