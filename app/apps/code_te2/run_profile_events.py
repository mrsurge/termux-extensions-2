# pyright: strict
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Mapping

from .monaco_editor.editor_backend_services.contracts import JsonMap
from .run_profile_state import (
    build_run_profile_state_projection,
    run_profile_request_context,
)
from .run_profile_surfaces import cancel_all_run_profile_url_readiness
from .ui_ipc.rpc_contract import UI_IPC_RPC_NOTIFICATION_RUN_PROFILE_STATE_CHANGED
from .worker_services.event_bus import (
    WorkerEvent,
    build_event,
    current_project_generation,
    event_payload_object,
    publish as publish_worker_event,
    record_stale_drop,
    subscribe as subscribe_worker_event,
)

logger = logging.getLogger(__name__)

_event_bus_handlers_registered = False
_projection_lock = asyncio.Lock()
_projection_revision = 0
_last_projection_signature: str | None = None


async def refresh_run_profile_state(
    data: Mapping[str, object] | None = None,
    *,
    source: str,
    force: bool = False,
    reconcile_stale_route: bool = False,
) -> JsonMap:
    """Resolve and publish the current Run Profile fact after a real state event."""
    global _last_projection_signature, _projection_revision

    async with _projection_lock:
        projection: JsonMap
        try:
            projection = await build_run_profile_state_projection(
                data,
                reconcile_stale_route=reconcile_stale_route,
            )
        except Exception as exc:
            project_root, current_file = run_profile_request_context(data)
            projection = {
                "projectPath": project_root or "",
                "path": current_file or "",
                "matched": False,
                "running": False,
                "profileId": "",
                "runner": "",
                "shellId": "",
                "label": "",
                "selectionRequired": False,
                "candidateScope": "owners",
                "candidates": [],
                "runningProfiles": [],
                "shellStateReady": False,
                "error": str(exc),
            }

        signature = _projection_signature(projection)
        if signature == _last_projection_signature and not force:
            return dict(projection)

        _last_projection_signature = signature
        _projection_revision += 1
        projection["revision"] = _projection_revision
        projection["source"] = source

        project_root = _text(projection.get("projectPath")) or None
        await publish_worker_event(
            build_event(
                "RunProfileStateChanged",
                project_root=project_root,
                project_generation=current_project_generation(project_root),
                source=source,
                payload={"runProfileState": dict(projection)},
            )
        )
        return dict(projection)


def register_run_profile_event_bus_handlers() -> None:
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    subscribe_worker_event("RunProfileStateChanged", _project_run_profile_state)
    subscribe_worker_event("OpenStateChanged", _refresh_after_open_state)
    subscribe_worker_event("ProjectSwitchFinished", _refresh_after_project_switch)
    _event_bus_handlers_registered = True


async def _project_run_profile_state(event: WorkerEvent) -> None:
    project_root = event.get("project_root")
    generation = event.get("project_generation")
    if (
        project_root
        and generation is not None
        and current_project_generation(project_root) != generation
    ):
        record_stale_drop("run_profile_events:projector", event["type"])
        return

    projection = event_payload_object(event, "runProfileState")
    if not projection:
        return
    try:
        from .ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

        await emit_ui_ipc_rpc_notification(
            UI_IPC_RPC_NOTIFICATION_RUN_PROFILE_STATE_CHANGED,
            projection,
        )
    except Exception as exc:
        logger.debug("[run_profile] projection emit failed: %s", exc)


async def _refresh_after_open_state(event: WorkerEvent) -> None:
    open_state = event_payload_object(event, "openState")
    path = _text(open_state.get("openFile"))
    data: JsonMap = {"path": path} if path else {}
    _ = await refresh_run_profile_state(data, source="open_state")


async def _refresh_after_project_switch(event: WorkerEvent) -> None:
    cancel_all_run_profile_url_readiness()
    open_state = event_payload_object(event, "openState")
    path = _text(open_state.get("openFile"))
    data: JsonMap = {"path": path} if path else {}
    _ = await refresh_run_profile_state(data, source="project_switch")


def _projection_signature(projection: JsonMap) -> str:
    stable = {
        key: projection.get(key)
        for key in (
            "projectPath",
            "path",
            "matched",
            "running",
            "profileId",
            "runner",
            "shellId",
            "label",
            "selectionRequired",
            "candidateScope",
            "candidates",
            "runningProfiles",
            "shellStateReady",
            "error",
        )
    }
    return json.dumps(
        stable,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""
