# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
import hashlib
from pathlib import Path

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..page_preview_shell_manager import (
    ensure_page_preview_shell,
    stop_page_preview_shell,
)
from ..runner_profile_shell_manager import (
    ensure_runner_profile_shell,
    stop_runner_profile_shell,
)
from ..runner_profiles import (
    DEFAULT_PAGE_PREVIEW_URL,
    RunProfileConflictError,
    RunProfileMatch,
)
from ..run_profile_state import (
    build_run_profile_state_projection,
    resolve_run_profile_match,
)
from ..ui_ipc.sidebar_ws import handle_ui_sidebar_window_create_request
from .run_target_service import register_run_target_routes, release_run_target_route


def resolve_runner_profile_run_request(
    data: Mapping[str, object] | None,
) -> RunProfileMatch | None:
    return resolve_run_profile_match(data)


async def build_run_profile_selection_response(
    data: Mapping[str, object] | None,
    *,
    include_all_profiles: bool = False,
) -> JsonMap:
    request = dict(data) if isinstance(data, Mapping) else {}
    if include_all_profiles:
        request["includeAllProfiles"] = True
    projection = await build_run_profile_state_projection(request)
    candidates = projection.get("candidates")
    candidate_list = candidates if isinstance(candidates, list) else []
    return {
        "ok": True,
        "data": {
            "action": "selectRunProfile",
            "path": projection.get("path", ""),
            "candidates": candidate_list,
            "includeRunCurrentFile": include_all_profiles,
            "message": (
                "Choose a Run Profile or run the active file"
                if include_all_profiles
                else "Choose which Run Profile owns this file"
            ),
        },
    }


# Play dispatch is backend-owned: the UI sends intent, then this hook chooses
# the runner implementation for an already-resolved profile.
async def handle_runner_profile_run_request(
    match: RunProfileMatch,
    *,
    source_name: str,
) -> JsonMap:
    profile = match.profile
    if profile.runner == "pagePreview":
        shell = await ensure_page_preview_shell(
            project_root=str(match.project_root),
            profile_id=profile.profile_id,
            entry=profile.entry,
        )
        url = profile.sidebar_url or shell.url or DEFAULT_PAGE_PREVIEW_URL
        sidebar_result = await _open_sidebar_url(
            url=url,
            profile_id=profile.profile_id,
            title="Page Preview",
            label="Page Preview",
            host_prefix="page-preview",
            source_name=source_name,
            project_root=match.project_root,
            dev_tools=profile.dev_tools,
        )
        await _publish_run_profile_state_best_effort(
            path=str(match.active_file),
            source=f"{source_name}:page_preview_started",
        )
        return {
            "ok": True,
            "data": {
                "action": "pagePreview",
                "matched": True,
                "running": True,
                "profileId": profile.profile_id,
                "runner": profile.runner,
                "shell_id": shell.shell_id,
                "url": url,
                "reused": shell.reused,
                "entry": profile.entry,
                "path": str(match.active_file),
                "matchedPath": match.relative_path,
                "sidebar": sidebar_result,
                "command_preview": f"Page Preview {profile.entry}",
            },
        }

    try:
        shell = await ensure_runner_profile_shell(
            project_root=str(match.project_root),
            profile=profile,
            matched_path=match.relative_path,
        )
    except ValueError as exc:
        return {
            "ok": False,
            "error": str(exc),
            "data": {"profileId": profile.profile_id, "runner": profile.runner},
        }
    run_target_route: JsonMap | None = None
    if profile.port is not None:
        try:
            run_target_route = await register_run_target_routes(
                owner_id=shell.label,
                shell_id=shell.shell_id,
                primary_port=profile.port,
                additional_ports=profile.additional_ports,
            )
            primary = _json_object(run_target_route.get("primary"))
            primary["originalUrl"] = profile.sidebar_url
            run_target_route["primary"] = primary
            additional_routes = run_target_route.get("additional")
            if isinstance(additional_routes, list):
                for item in additional_routes:
                    route = _json_object(item)
                    preferred_port = route.get("preferredPort")
                    if isinstance(preferred_port, int):
                        route["originalUrl"] = f"http://127.0.0.1:{preferred_port}/"
                    if isinstance(item, dict):
                        item.clear()
                        item.update(route)
        except Exception as exc:
            stopped_suffix = ""
            if not shell.reused:
                _ = await stop_runner_profile_shell(
                    project_root=str(match.project_root),
                    profile_id=profile.profile_id,
                )
                stopped_suffix = "; profile stopped"
                await _publish_run_profile_state_best_effort(
                    path=str(match.active_file),
                    source=f"{source_name}:route_setup_failed",
                )
            return {
                "ok": False,
                "error": f"Run target route setup failed{stopped_suffix}: {exc}",
                "data": {"profileId": profile.profile_id, "runner": profile.runner},
            }
    sidebar_result: JsonMap | None = None
    if profile.sidebar_url:
        sidebar_result = await _open_sidebar_url(
            url=profile.sidebar_url,
            profile_id=profile.profile_id,
            title=f"Run {profile.profile_id}",
            label=f"Run {profile.profile_id}",
            host_prefix="runner-profile",
            source_name=source_name,
            project_root=match.project_root,
            dev_tools=profile.dev_tools,
            run_target_route=run_target_route,
        )

    message = (
        f"Run profile '{profile.profile_id}' already running"
        if shell.reused
        else f"Run profile '{profile.profile_id}' started"
    )
    if profile.sidebar_url:
        message = f"{message}; opened {profile.sidebar_url}"

    await _publish_run_profile_state_best_effort(
        path=str(match.active_file),
        source=f"{source_name}:run_profile_started",
    )

    return {
        "ok": True,
        "data": {
            "action": "runProfile",
            "matched": True,
            "running": True,
            "profileId": profile.profile_id,
            "runner": profile.runner,
            "shell_id": shell.shell_id,
            "reused": shell.reused,
            "exec": profile.exec_command,
            "cwd": profile.cwd,
            "matchedPath": match.relative_path,
            "path": str(match.active_file),
            "sidebar": sidebar_result,
            "command_preview": shell.command_preview,
            "message": message,
        },
    }


async def maybe_handle_runner_profile_run_request(
    data: Mapping[str, object] | None,
    *,
    source_name: str,
) -> JsonMap | None:
    try:
        match = resolve_runner_profile_run_request(data)
    except RunProfileConflictError:
        return await build_run_profile_selection_response(data)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    if match is None:
        return None
    return await handle_runner_profile_run_request(match, source_name=source_name)


async def handle_run_profile_state_get_request(
    data: Mapping[str, object] | None,
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    try:
        projection = await build_run_profile_state_projection(
            data,
            reconcile_stale_route=True,
        )
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "data": projection}


async def handle_run_profile_stop_request(
    data: Mapping[str, object] | None,
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    try:
        match = resolve_runner_profile_run_request(data)
    except (RunProfileConflictError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}
    if match is None:
        return {"ok": False, "error": "Active file has no matching run profile"}

    profile = match.profile
    state = (
        await stop_page_preview_shell(
            project_root=str(match.project_root), profile_id=profile.profile_id
        )
        if profile.runner == "pagePreview"
        else await stop_runner_profile_shell(
            project_root=str(match.project_root), profile_id=profile.profile_id
        )
    )
    if profile.port is not None:
        await _release_route_best_effort(
            owner_id=state.label,
            shell_id=state.shell_id or None,
        )
    await _publish_run_profile_state_best_effort(
        path=str(match.active_file),
        source="run_profile_stopped",
    )
    return {
        "ok": True,
        "data": {
            "matched": True,
            "running": False,
            "stopped": bool(state.shell_id),
            "profileId": profile.profile_id,
            "runner": profile.runner,
            "shellId": state.shell_id,
            "path": str(match.active_file),
            "message": (
                f"Run profile '{profile.profile_id}' stopped"
                if state.shell_id
                else f"Run profile '{profile.profile_id}' is not running"
            ),
        },
    }


async def _release_route_best_effort(
    *, owner_id: str, shell_id: str | None = None
) -> None:
    try:
        _ = await release_run_target_route(owner_id=owner_id, shell_id=shell_id)
    except Exception:
        pass


async def _publish_run_profile_state_best_effort(*, path: str, source: str) -> None:
    try:
        from ..run_profile_events import refresh_run_profile_state

        _ = await refresh_run_profile_state({"path": path}, source=source)
    except Exception:
        pass


async def _open_sidebar_url(
    *,
    url: str,
    profile_id: str,
    title: str,
    label: str,
    host_prefix: str,
    source_name: str,
    project_root: Path,
    dev_tools: bool,
    run_target_route: JsonMap | None = None,
) -> JsonMap:
    target_id = _devtools_target_id(project_root, profile_id) if dev_tools else ""
    payload: JsonMap = {
        "kind": "url",
        "host_id": f"{host_prefix}:{profile_id}",
        "title": title,
        "label": label,
        "url": url,
        "restore_url": url,
        "load": "eager",
        "activate": True,
        "client_id": "main_page",
        "source": f"{source_name}:runner_profile",
        "devTools": dev_tools,
        "devToolsTargetId": target_id,
        "devToolsTargetLabel": label,
    }
    if run_target_route:
        payload["runTargetRoute"] = dict(run_target_route)
    result = await handle_ui_sidebar_window_create_request(payload)
    return dict(result)


def _devtools_target_id(project_root: Path, profile_id: str) -> str:
    project_hash = hashlib.sha256(str(project_root).encode("utf-8")).hexdigest()[:12]
    return f"run-profile:{project_hash}:{profile_id}"


def _json_object(value: object) -> JsonMap:
    if not isinstance(value, Mapping):
        return {}
    return {str(key): item for key, item in value.items()}
