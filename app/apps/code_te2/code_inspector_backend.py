# pyright: strict
from __future__ import annotations

import logging
from typing import cast

from .code_inspector_projection import (
    CodeInspectorMode,
    CodeInspectorProjection,
    CodeInspectorStatus,
    clear_code_inspector_projection_state,
    copy_code_inspector_projection,
    get_code_inspector_projection,
    peek_code_inspector_projection,
    replace_code_inspector_projection,
)
from .monaco_editor.editor_rpc_contract import EDITOR_RPC_NOTIFICATION_CODE_INSPECTOR_COMMAND
from .monaco_editor.editor_rpc_emit import emit_editor_rpc_notification
from .stores import get_history_store
from .worker_services.event_bus import (
    build_event,
    current_project_generation,
    publish as publish_worker_event,
)

JsonObject = dict[str, object]
logger = logging.getLogger(__name__)


async def publish_code_inspector_projection(
    params: dict[str, object],
    *,
    source_client: str,
) -> JsonObject:
    projection = _coerce_projection(params.get("projection"))
    if not _accept_projection(projection):
        return {
            "ok": False,
            "accepted": False,
            "reason": "stale_projection",
            "current": get_code_inspector_projection(),
        }

    current = peek_code_inspector_projection()
    project_root = _active_project()
    generation = current_project_generation(project_root)
    if current and current["requestId"] == projection["requestId"] and (
        current.get("originRenderer", source_client) != source_client
        or current.get("originProject", project_root) != project_root
        or current.get("originGeneration", generation) != generation
    ):
        return {"ok": False, "accepted": False, "reason": "stale_projection"}
    projection["originRenderer"] = source_client
    projection["originProject"] = project_root
    projection["originGeneration"] = generation
    previous = replace_code_inspector_projection(projection)
    if (
        previous is not None
        and previous["mode"] == "callHierarchy"
        and previous["requestId"] != projection["requestId"]
    ):
        await _release_projection(previous, reason="replaced")
    await publish_worker_event(
        build_event(
            "CodeInspectorChanged",
            project_root=project_root,
            project_generation=current_project_generation(project_root),
            source="editor.codeInspector.publish",
            correlation_id=projection["requestId"],
            payload={
                "projection": cast(
                    JsonObject,
                    cast(object, copy_code_inspector_projection(projection)),
                ),
                "sourceClient": source_client,
            },
        )
    )
    return {
        "ok": True,
        "accepted": True,
        "revision": projection["revision"],
        "requestId": projection["requestId"],
    }


async def clear_code_inspector_projection(
    *,
    reason: str,
    source: str,
) -> None:
    previous = clear_code_inspector_projection_state()
    if previous is None:
        return
    await _release_projection(previous, reason=reason)
    project_root = _active_project()
    await publish_worker_event(
        build_event(
            "CodeInspectorChanged",
            project_root=project_root,
            project_generation=current_project_generation(project_root),
            source=source,
            payload={"projection": None, "reason": reason},
        )
    )


async def handle_code_inspector_command(
    params: dict[str, object],
    *,
    source_name: str,
) -> JsonObject:
    action = str(params.get("action") or "")
    if action not in {"navigate", "direction", "expand", "release", "clearHighlights"}:
        raise ValueError("unsupported_code_inspector_action")
    if action == "direction" and params.get("direction") not in {
        "incoming",
        "outgoing",
    }:
        raise ValueError("invalid_code_inspector_direction")

    projection = peek_code_inspector_projection()
    request_id = str(params.get("requestId") or "")
    if projection is None or not request_id:
        raise ValueError("code_inspector_projection_missing")
    if request_id != projection["requestId"]:
        raise ValueError("stale_code_inspector_request")

    if action == "navigate":
        from .host.file_ops_backend import handle_host_open_request
        from .host.editor_menu_target import select_editor_menu_renderer
        from .editor_renderer_bindings import registered_editor_renderer_binding
        from .monaco_editor.editor_client_registry import connected_editor_client_instance_ids
        project = _active_project()
        if (not project or projection.get("originProject") != project
                or projection.get("originGeneration") != current_project_generation(project)):
            raise ValueError("Inspector project changed; inspect again")
        target = select_editor_menu_renderer(source_name)
        origin = registered_editor_renderer_binding(projection.get("originRenderer", ""))
        if origin and origin.main_page_id == target.main_page_id:
            if origin.renderer_id not in connected_editor_client_instance_ids():
                raise ValueError("Inspector editor disconnected; inspect again")
            target = origin
        node_id = _required_text(params.get("nodeId"), "nodeId")
        pending = list(projection["tree"])
        while pending:
            node = _json_object(pending.pop())
            if node.get("id") == node_id:
                path = _required_text(node.get("path"), "path")
                position = _json_object(node.get("selectionRange")) or _json_object(node.get("range"))
                nav: JsonObject = {"path": path, "line": position.get("startLineNumber", 1),
                    "column": position.get("startColumn", 1), "focus": False, "scroll_y": "center", "place_cursor": True}
                if node.get("type") == "symbol":
                    nav["symbol_range"] = node.get("range")
                await handle_host_open_request(nav, source_name=target.renderer_id, request_prefix="inspector")
                return {"ok": True, "requestId": request_id}
            children = node.get("children")
            if isinstance(children, list):
                pending.extend(cast(list[object], children))
        raise ValueError("Inspector result is no longer present")

    payload: JsonObject = dict(params)
    payload["source"] = source_name
    payload["projection"] = cast(
        JsonObject,
        cast(object, copy_code_inspector_projection(projection)),
    )
    await _emit_editor_command(payload, projection.get("originRenderer"))
    return {"ok": True, "requestId": request_id, "action": action}


def _accept_projection(projection: CodeInspectorProjection) -> bool:
    current = peek_code_inspector_projection()
    if current is None:
        return True
    incoming_sequence = projection["requestSequence"]
    current_sequence = current["requestSequence"]
    if incoming_sequence < current_sequence:
        return False
    if incoming_sequence > current_sequence:
        return True
    if projection["requestId"] != current["requestId"]:
        return False
    return projection["revision"] > current["revision"]


def _coerce_projection(value: object) -> CodeInspectorProjection:
    if not isinstance(value, dict):
        raise ValueError("code_inspector_projection_must_be_object")
    raw = cast(dict[object, object], value)
    request_id = _required_text(raw.get("requestId"), "requestId")
    request_sequence = _non_negative_int(raw.get("requestSequence"), "requestSequence")
    revision = _non_negative_int(raw.get("revision"), "revision")
    status = str(raw.get("status") or "")
    if status not in {"loading", "ready", "empty", "unsupported", "error"}:
        raise ValueError("invalid_code_inspector_status")
    mode = str(raw.get("mode") or "")
    if mode not in {"references", "implementations", "callHierarchy", "symbols"}:
        raise ValueError("invalid_code_inspector_mode")
    target = _json_object(raw.get("target"))
    summary = _json_object(raw.get("summary"))
    tree_value = raw.get("tree")
    tree = list(cast(list[object], tree_value)) if isinstance(tree_value, list) else []
    return {
        "revision": revision,
        "requestId": request_id,
        "requestSequence": request_sequence,
        "status": cast(CodeInspectorStatus, status),
        "mode": cast(CodeInspectorMode, mode),
        "target": target,
        "summary": summary,
        "tree": tree,
        "error": raw.get("error"),
    }


def _required_text(value: object, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"missing_{field}")
    return text


def _non_negative_int(value: object, field: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"invalid_{field}")
    try:
        parsed = int(cast(int | str, value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid_{field}") from exc
    if parsed < 0:
        raise ValueError(f"invalid_{field}")
    return parsed


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    return {
        key: item
        for key, item in cast(dict[object, object], value).items()
        if isinstance(key, str)
    }


def _active_project() -> str | None:
    project = get_history_store().get_active_project()
    return project if isinstance(project, str) and project else None


async def _emit_editor_command(payload: JsonObject, renderer_id: str | None) -> None:
    from .client_presentation import client_presentation_room
    from .monaco_editor.editor_socketio import EDITOR_SIO
    if not renderer_id:
        raise ValueError("Inspector editor unavailable; inspect again")

    async def _emit(event_name: str, notification_payload: object) -> None:
        await EDITOR_SIO.emit(  # pyright: ignore[reportUnknownMemberType]
            event_name,
            notification_payload,
            room=client_presentation_room(renderer_id),
            namespace="/rpc/editor",
        )

    await emit_editor_rpc_notification(
        _emit,
        EDITOR_RPC_NOTIFICATION_CODE_INSPECTOR_COMMAND,
        payload,
    )


async def _release_projection(
    projection: CodeInspectorProjection,
    *,
    reason: str,
) -> None:
    if projection["mode"] != "callHierarchy":
        return
    try:
        await _emit_editor_command(
            {
                "action": "release",
                "requestId": projection["requestId"],
                "reason": reason,
                "projection": cast(
                    JsonObject,
                    cast(object, copy_code_inspector_projection(projection)),
                ),
            }, projection.get("originRenderer")
        )
    except Exception as exc:
        logger.debug("[code_inspector] hierarchy release failed: %s", exc)
