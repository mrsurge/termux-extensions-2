# pyright: strict
from __future__ import annotations

from copy import deepcopy
import logging
from typing import Literal, TypedDict, cast

from .monaco_editor.editor_rpc_contract import EDITOR_RPC_NOTIFICATION_CODE_INSPECTOR_COMMAND
from .monaco_editor.editor_rpc_emit import emit_editor_rpc_notification
from .stores import get_history_store
from .worker_services.event_bus import (
    build_event,
    current_project_generation,
    publish as publish_worker_event,
)

CodeInspectorStatus = Literal["loading", "ready", "empty", "unsupported", "error"]
CodeInspectorMode = Literal["references", "implementations", "callHierarchy"]
JsonObject = dict[str, object]
logger = logging.getLogger(__name__)


class CodeInspectorProjection(TypedDict):
    revision: int
    requestId: str
    requestSequence: int
    status: CodeInspectorStatus
    mode: CodeInspectorMode
    target: JsonObject
    summary: JsonObject
    tree: list[object]
    error: object | None


_current_projection: CodeInspectorProjection | None = None


def get_code_inspector_projection() -> CodeInspectorProjection | None:
    projection = _current_projection
    return _copy_projection(projection) if projection is not None else None


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

    global _current_projection
    previous = _current_projection
    _current_projection = projection
    if (
        previous is not None
        and previous["mode"] == "callHierarchy"
        and previous["requestId"] != projection["requestId"]
    ):
        await _release_projection(previous, reason="replaced")
    project_root = _active_project()
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
                    cast(object, _copy_projection(projection)),
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
    global _current_projection
    if _current_projection is None:
        return
    previous = _current_projection
    _current_projection = None
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
    if action not in {"direction", "expand", "release"}:
        raise ValueError("unsupported_code_inspector_action")
    if action == "direction" and params.get("direction") not in {
        "incoming",
        "outgoing",
    }:
        raise ValueError("invalid_code_inspector_direction")

    projection = _current_projection
    request_id = str(params.get("requestId") or "")
    if projection is None or not request_id:
        raise ValueError("code_inspector_projection_missing")
    if request_id != projection["requestId"]:
        raise ValueError("stale_code_inspector_request")

    payload: JsonObject = dict(params)
    payload["source"] = source_name
    payload["projection"] = cast(
        JsonObject,
        cast(object, _copy_projection(projection)),
    )
    await _emit_editor_command(payload)
    return {"ok": True, "requestId": request_id, "action": action}


def _accept_projection(projection: CodeInspectorProjection) -> bool:
    current = _current_projection
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
    if mode not in {"references", "implementations", "callHierarchy"}:
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


def _copy_projection(projection: CodeInspectorProjection) -> CodeInspectorProjection:
    return deepcopy(projection)


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


async def _emit_editor_command(payload: JsonObject) -> None:
    from .monaco_editor.editor_socketio import EDITOR_SIO

    async def _emit(event_name: str, notification_payload: bytes) -> None:
        await EDITOR_SIO.emit(  # pyright: ignore[reportUnknownMemberType]
            event_name,
            notification_payload,
            room="file_editor_cm6",
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
                    cast(object, _copy_projection(projection)),
                ),
            }
        )
    except Exception as exc:
        logger.debug("[code_inspector] hierarchy release failed: %s", exc)
