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
    subscribe_worker_event("ClientForegroundChanged", _refresh_after_client_foreground)
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
        from .open_state_backend import read_client_foreground
        from .ui_ipc.ui_ipc_ws import (
            emit_ui_ipc_rpc_notification,
            list_ui_ipc_browser_clients,
        )

        for client_instance_id in list_ui_ipc_browser_clients():
            path: str | None = None
            if project_root:
                foreground = await asyncio.to_thread(
                    read_client_foreground,
                    project_root,
                    client_instance_id,
                    reason="run_profile_projection",
                )
                path = foreground["path"]
            client_projection = await build_run_profile_state_projection(
                {"path": path} if path else {"path": ""}
            )
            client_projection["revision"] = projection.get("revision", 0)
            client_projection["source"] = projection.get("source", event["source"])
            await emit_ui_ipc_rpc_notification(
                UI_IPC_RPC_NOTIFICATION_RUN_PROFILE_STATE_CHANGED,
                client_projection,
                client_instance_id=client_instance_id,
            )
    except Exception as exc:
        logger.debug("[run_profile] client projection emit failed: %s", exc)


async def _refresh_after_client_foreground(event: WorkerEvent) -> None:
    foreground = event_payload_object(event, "clientForeground")
    client_instance_id = _text(foreground.get("clientInstanceId"))
    if not client_instance_id:
        return
    path = _text(foreground.get("path"))
    try:
        from .ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

        projection = await build_run_profile_state_projection(
            {"path": path} if path else {"path": ""}
        )
        projection["source"] = "client_foreground"
        await emit_ui_ipc_rpc_notification(
            UI_IPC_RPC_NOTIFICATION_RUN_PROFILE_STATE_CHANGED,
            projection,
            client_instance_id=client_instance_id,
        )
    except Exception as exc:
        logger.debug("[run_profile] foreground projection failed: %s", exc)


async def _refresh_after_project_switch(event: WorkerEvent) -> None:
    cancel_all_run_profile_url_readiness()
    _ = await refresh_run_profile_state({"path": ""}, source="project_switch")


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
