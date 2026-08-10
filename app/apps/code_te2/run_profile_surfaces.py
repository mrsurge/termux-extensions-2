# pyright: strict
from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import Mapping
from pathlib import Path
from typing import cast

import httpx

from .monaco_editor.editor_backend_services.contracts import JsonMap
from .runner_profile_shell_manager import runner_profile_shell_state
from .runner_profiles import (
    RunProfile,
    load_run_profiles,
    run_profile_matches_path,
)
from .ui_ipc.sidebar_window_state import get_sidebar_window_state
from .ui_ipc.sidebar_ws import (
    handle_ui_sidebar_window_close_request,
    handle_ui_sidebar_window_create_request,
)
from .worker_services.event_bus import (
    WorkerEvent,
    current_project_generation,
    event_payload_object,
    record_stale_drop,
    subscribe as subscribe_worker_event,
)

logger = logging.getLogger(__name__)

SURFACE_DTO = "RunProfileSurface"
SURFACE_VERSION = 1
READINESS_TIMEOUT_SECONDS = 15.0
READINESS_REQUEST_TIMEOUT_SECONDS = 2.0
READINESS_INITIAL_DELAY_SECONDS = 0.1
READINESS_MAX_DELAY_SECONDS = 0.8

_readiness_tasks: dict[str, asyncio.Task[object]] = {}
_event_handlers_registered = False


def run_profile_surface_id(project_root: str | Path, profile_id: str) -> str:
    root_hash = hashlib.sha256(_root_text(project_root).encode("utf-8")).hexdigest()[:12]
    profile_hash = hashlib.sha256(profile_id.encode("utf-8")).hexdigest()[:12]
    return f"run-profile:{root_hash}:{profile_hash}"


def run_profile_surface_host_id(project_root: str | Path, profile_id: str) -> str:
    return f"run-profile-surface:{run_profile_surface_id(project_root, profile_id)}"


def build_run_profile_surface(
    *,
    project_root: str | Path,
    profile: RunProfile,
    shell_id: str,
    shell_label: str,
    url: str,
    refresh_revision: int = 0,
) -> JsonMap:
    surface_id = run_profile_surface_id(project_root, profile.profile_id)
    return {
        "dto": SURFACE_DTO,
        "version": SURFACE_VERSION,
        "surfaceId": surface_id,
        "projectPath": _root_text(project_root),
        "profileId": profile.profile_id,
        "runner": profile.runner,
        "shellId": shell_id,
        "shellLabel": shell_label,
        "url": url,
        "devRuntime": profile.runner == "pagePreview" or profile.dev_runtime,
        "refreshRevision": max(0, refresh_revision),
    }


async def wait_for_run_profile_url(
    *,
    project_root: str | Path,
    profile_id: str,
    shell_id: str,
    url: str,
) -> None:
    surface_id = run_profile_surface_id(project_root, profile_id)
    current_task = asyncio.current_task()
    if current_task is None:
        raise RuntimeError("Run Profile readiness requires an asyncio task")
    task = cast(asyncio.Task[object], current_task)
    previous = _readiness_tasks.get(surface_id)
    if previous is not None and previous is not task and not previous.done():
        _ = previous.cancel()
    _readiness_tasks[surface_id] = task
    deadline = asyncio.get_running_loop().time() + READINESS_TIMEOUT_SECONDS
    delay = READINESS_INITIAL_DELAY_SECONDS
    last_error = "URL remained unavailable"
    try:
        timeout = httpx.Timeout(READINESS_REQUEST_TIMEOUT_SECONDS)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            while True:
                try:
                    async with client.stream("GET", url) as response:
                        if response.status_code != 404:
                            return
                        last_error = "HTTP 404"
                except httpx.RequestError as exc:
                    last_error = str(exc)
                if asyncio.get_running_loop().time() >= deadline:
                    raise TimeoutError(
                        f"Run profile '{profile_id}' URL was not ready: {last_error}"
                    )
                await asyncio.sleep(delay)
                delay = min(READINESS_MAX_DELAY_SECONDS, delay * 2)
    finally:
        if _readiness_tasks.get(surface_id) is task:
            _ = _readiness_tasks.pop(surface_id, None)


def cancel_run_profile_url_readiness(
    project_root: str | Path,
    profile_id: str,
) -> None:
    task = _readiness_tasks.pop(run_profile_surface_id(project_root, profile_id), None)
    if task is not None and not task.done():
        _ = task.cancel()


def cancel_all_run_profile_url_readiness() -> None:
    tasks = list(_readiness_tasks.values())
    _readiness_tasks.clear()
    for task in tasks:
        if not task.done():
            _ = task.cancel()


async def open_run_profile_surface(
    *,
    project_root: str | Path,
    profile: RunProfile,
    shell_id: str,
    shell_label: str,
    url: str,
    title: str,
    label: str,
    source_name: str,
    run_target_route: JsonMap | None = None,
) -> JsonMap:
    surface = build_run_profile_surface(
        project_root=project_root,
        profile=profile,
        shell_id=shell_id,
        shell_label=shell_label,
        url=url,
    )
    payload = _surface_slot_payload(
        surface=surface,
        profile=profile,
        title=title,
        label=label,
        source_name=source_name,
        run_target_route=run_target_route,
        activate=True,
    )
    return dict(await handle_ui_sidebar_window_create_request(payload))


async def close_run_profile_surface(
    *,
    project_root: str | Path,
    profile_id: str,
    source: str,
) -> bool:
    cancel_run_profile_url_readiness(project_root, profile_id)
    host_id = run_profile_surface_host_id(project_root, profile_id)
    if host_id not in _sidebar_slots():
        return False
    _ = await handle_ui_sidebar_window_close_request(
        {
            "host_id": host_id,
            "hostId": host_id,
            "client_id": "main_page",
            "source": source,
        }
    )
    return True


async def close_run_profile_surface_for_shell(
    *,
    shell_id: str,
    shell_label: str,
    source: str,
) -> int:
    closed = 0
    for host_id, slot in _sidebar_slots().items():
        surface = _surface_from_slot(slot)
        if not surface:
            continue
        surface_shell_id = _text(surface.get("shellId"))
        surface_shell_label = _text(surface.get("shellLabel"))
        if not (
            (shell_id and surface_shell_id == shell_id)
            or (shell_label and surface_shell_label == shell_label)
        ):
            continue
        project_root = _text(surface.get("projectPath"))
        profile_id = _text(surface.get("profileId"))
        if project_root and profile_id:
            cancel_run_profile_url_readiness(project_root, profile_id)
        _ = await handle_ui_sidebar_window_close_request(
            {
                "host_id": host_id,
                "hostId": host_id,
                "client_id": "main_page",
                "source": source,
            }
        )
        closed += 1
    return closed


async def reconcile_run_profile_surfaces(live_shell_ids: set[str]) -> int:
    closed = 0
    for host_id, slot in _sidebar_slots().items():
        surface = _surface_from_slot(slot)
        shell_id = _text(surface.get("shellId")) if surface else ""
        if not shell_id or shell_id in live_shell_ids:
            continue
        _ = await handle_ui_sidebar_window_close_request(
            {
                "host_id": host_id,
                "hostId": host_id,
                "client_id": "main_page",
                "source": "run_profile_surface_reconcile",
            }
        )
        closed += 1
    return closed


def register_run_profile_surface_event_handlers() -> None:
    global _event_handlers_registered
    if _event_handlers_registered:
        return
    subscribe_worker_event("FileSaved", _handle_file_saved)
    _event_handlers_registered = True


async def _handle_file_saved(event: WorkerEvent) -> None:
    project_root = event.get("project_root")
    generation = event.get("project_generation")
    if (
        project_root
        and generation is not None
        and current_project_generation(project_root) != generation
    ):
        record_stale_drop("run_profile_surfaces:file_saved", event["type"])
        return
    saved = event_payload_object(event, "fileSaved")
    relative_path = _text(saved.get("relativePath"))
    if not project_root or not relative_path:
        return
    try:
        profiles = load_run_profiles(project_root)
    except Exception as exc:
        logger.debug("[run_profile] save refresh profile load failed: %s", exc)
        return
    for profile in profiles:
        if (
            profile.runner == "pagePreview"
            or not profile.dev_runtime
            or not profile.sidebar_url
            or not run_profile_matches_path(
                profile,
                relative_path,
                project_root=project_root,
            )
        ):
            continue
        state = await runner_profile_shell_state(
            project_root=project_root,
            profile_id=profile.profile_id,
        )
        if not state.running:
            continue
        await _refresh_surface_slot(
            project_root=project_root,
            profile=profile,
            shell_id=state.shell_id,
        )


async def _refresh_surface_slot(
    *,
    project_root: str | Path,
    profile: RunProfile,
    shell_id: str,
) -> bool:
    host_id = run_profile_surface_host_id(project_root, profile.profile_id)
    slot = _sidebar_slots().get(host_id)
    surface = _surface_from_slot(slot)
    if not surface or _text(surface.get("shellId")) != shell_id:
        return False
    revision = _integer(surface.get("refreshRevision")) + 1
    surface["refreshRevision"] = revision
    payload = _surface_slot_payload(
        surface=surface,
        profile=profile,
        title=_text(slot.get("title")) or f"Run {profile.profile_id}",
        label=_text(slot.get("label")) or f"Run {profile.profile_id}",
        source_name="run_profile_file_saved",
        run_target_route=_json_object(
            slot.get("runTargetRoute") or slot.get("run_target_route")
        )
        or None,
        activate=False,
    )
    _ = await handle_ui_sidebar_window_create_request(payload)
    return True


def _surface_slot_payload(
    *,
    surface: JsonMap,
    profile: RunProfile,
    title: str,
    label: str,
    source_name: str,
    run_target_route: JsonMap | None,
    activate: bool,
) -> JsonMap:
    project_root = _text(surface.get("projectPath"))
    profile_id = _text(surface.get("profileId"))
    revision = _integer(surface.get("refreshRevision"))
    target_id = run_profile_surface_id(project_root, profile_id) if profile.dev_tools else ""
    payload: JsonMap = {
        "kind": "url",
        "host_id": run_profile_surface_host_id(project_root, profile_id),
        "title": title,
        "label": label,
        "url": _text(surface.get("url")),
        "restore_url": _text(surface.get("url")),
        "load": "eager",
        "activate": activate,
        "client_id": "main_page",
        "source": f"{source_name}:runner_profile",
        "version": str(revision),
        "devTools": profile.dev_tools,
        "devToolsTargetId": target_id,
        "devToolsTargetLabel": label,
        "runProfileSurface": dict(surface),
    }
    if run_target_route:
        payload["runTargetRoute"] = dict(run_target_route)
    return payload


def _sidebar_slots() -> dict[str, JsonMap]:
    slots_obj = get_sidebar_window_state().get("slots")
    if not isinstance(slots_obj, Mapping):
        return {}
    slots: dict[str, JsonMap] = {}
    for key, value in cast(Mapping[object, object], slots_obj).items():
        if isinstance(key, str) and isinstance(value, Mapping):
            slots[key] = {str(item_key): item for item_key, item in value.items()}
    return slots


def _surface_from_slot(slot: JsonMap | None) -> JsonMap:
    if not slot:
        return {}
    return _json_object(slot.get("runProfileSurface") or slot.get("run_profile_surface"))


def _root_text(project_root: str | Path) -> str:
    return str(Path(project_root).expanduser().resolve(strict=False))


def _json_object(value: object) -> JsonMap:
    if not isinstance(value, Mapping):
        return {}
    return {str(key): item for key, item in cast(Mapping[object, object], value).items()}


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _integer(value: object) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value)) if isinstance(value, (int, str)) else 0
    except ValueError:
        return 0
