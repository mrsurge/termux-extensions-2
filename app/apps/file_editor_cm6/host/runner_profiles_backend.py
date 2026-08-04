# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..page_preview_shell_manager import (
    DEFAULT_PORT as PAGE_PREVIEW_PORT,
    ensure_page_preview_shell,
    page_preview_shell_state,
    stop_page_preview_shell,
)
from ..runner_profile_shell_manager import (
    ensure_runner_profile_shell,
    runner_profile_shell_state,
    stop_runner_profile_shell,
)
from ..runner_profiles import (
    DEFAULT_PAGE_PREVIEW_URL,
    RunProfileAdditionalPort,
    RunProfileConflictError,
    RunProfileMatch,
    load_run_profiles,
)
from ..run_profile_state import (
    build_run_profile_state_projection,
    resolve_run_profile_match,
    run_profile_request_context,
)
from ..run_profile_surfaces import (
    cancel_run_profile_url_readiness,
    close_run_profile_surface,
    open_run_profile_surface,
    run_profile_surface_id,
    wait_for_run_profile_url,
)
from .run_target_service import register_run_target_routes, release_run_target_route

PAGE_PREVIEW_HMR_PORT = 24678


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
    candidate_list = (
        [
            item
            for item in candidates
            if isinstance(item, Mapping) and item.get("running") is not True
        ]
        if isinstance(candidates, list)
        else []
    )
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
        try:
            run_target_route = await register_run_target_routes(
                owner_id=shell.label,
                shell_id=shell.shell_id,
                primary_port=PAGE_PREVIEW_PORT,
                additional_ports=(
                    RunProfileAdditionalPort(PAGE_PREVIEW_HMR_PORT, "Vite / HMR"),
                ),
            )
            _decorate_route_urls(run_target_route, primary_url=url)
            await wait_for_run_profile_url(
                project_root=match.project_root,
                profile_id=profile.profile_id,
                shell_id=shell.shell_id,
                url=url,
            )
            sidebar_result = await open_run_profile_surface(
                project_root=match.project_root,
                profile=profile,
                shell_id=shell.shell_id,
                shell_label=shell.label,
                url=url,
                title="Page Preview",
                label="Page Preview",
                source_name=source_name,
                run_target_route=run_target_route,
            )
        except Exception as exc:
            await _cleanup_failed_launch(
                match=match,
                shell_id=shell.shell_id,
                shell_label=shell.label,
                reused=shell.reused,
            )
            return {
                "ok": False,
                "error": f"Page Preview URL setup failed: {exc}",
                "data": {"profileId": profile.profile_id, "runner": profile.runner},
            }
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
            _decorate_route_urls(
                run_target_route,
                primary_url=profile.sidebar_url,
            )
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
        try:
            await wait_for_run_profile_url(
                project_root=match.project_root,
                profile_id=profile.profile_id,
                shell_id=shell.shell_id,
                url=profile.sidebar_url,
            )
            sidebar_result = await open_run_profile_surface(
                project_root=match.project_root,
                profile=profile,
                shell_id=shell.shell_id,
                shell_label=shell.label,
                url=profile.sidebar_url,
                title=f"Run {profile.profile_id}",
                label=f"Run {profile.profile_id}",
                source_name=source_name,
                run_target_route=run_target_route,
            )
        except Exception as exc:
            await _cleanup_failed_launch(
                match=match,
                shell_id=shell.shell_id,
                shell_label=shell.label,
                reused=shell.reused,
            )
            return {
                "ok": False,
                "error": f"Run profile URL setup failed: {exc}",
                "data": {"profileId": profile.profile_id, "runner": profile.runner},
            }

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
    request = dict(data) if isinstance(data, Mapping) else {}
    requested_project = _text(request.get("projectPath") or request.get("project_path"))
    active_project, current_file = run_profile_request_context(request)
    if not active_project:
        return {"ok": False, "error": "No active project selected"}
    active_root = Path(active_project).expanduser().resolve(strict=False)
    if requested_project and Path(requested_project).expanduser().resolve(strict=False) != active_root:
        return {"ok": False, "error": "Run profile project changed before Stop"}
    requested_profile_id = _text(request.get("profileId") or request.get("profile_id"))
    try:
        if requested_profile_id:
            profile = next(
                (
                    item
                    for item in load_run_profiles(active_root)
                    if item.profile_id == requested_profile_id
                ),
                None,
            )
            if profile is None:
                raise ValueError(f"Run profile '{requested_profile_id}' no longer exists")
            match = None
        else:
            match = resolve_runner_profile_run_request(request)
            profile = match.profile if match is not None else None
    except (RunProfileConflictError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}
    if profile is None:
        return {"ok": False, "error": "Active file has no matching run profile"}

    state_before = (
        await page_preview_shell_state(
            project_root=str(active_root), profile_id=profile.profile_id
        )
        if profile.runner == "pagePreview"
        else await runner_profile_shell_state(
            project_root=str(active_root), profile_id=profile.profile_id
        )
    )
    requested_shell_id = _text(request.get("shellId") or request.get("shell_id"))
    if requested_shell_id and state_before.shell_id and requested_shell_id != state_before.shell_id:
        return {"ok": False, "error": "Run profile shell changed before Stop"}

    cancel_run_profile_url_readiness(active_root, profile.profile_id)
    state = (
        await stop_page_preview_shell(
            project_root=str(active_root), profile_id=profile.profile_id
        )
        if profile.runner == "pagePreview"
        else await stop_runner_profile_shell(
            project_root=str(active_root), profile_id=profile.profile_id
        )
    )
    if profile.runner == "pagePreview" or profile.port is not None:
        await _release_route_best_effort(
            owner_id=state.label or state_before.label,
            shell_id=state.shell_id or state_before.shell_id or None,
        )
    _ = await close_run_profile_surface(
        project_root=active_root,
        profile_id=profile.profile_id,
        source=f"{source_name}:run_profile_stopped",
    )
    projection = await _publish_run_profile_state_best_effort(
        path=current_file or (str(match.active_file) if match is not None else ""),
        source="run_profile_stopped",
    )
    shell_id = state.shell_id or state_before.shell_id
    response_data = dict(projection)
    response_data.update(
        {
            "stopped": bool(shell_id),
            "stoppedProfileId": profile.profile_id,
            "stoppedRunner": profile.runner,
            "stoppedShellId": shell_id,
            "message": (
                f"Run profile '{profile.profile_id}' stopped"
                if shell_id
                else f"Run profile '{profile.profile_id}' is not running"
            ),
        }
    )
    return {
        "ok": True,
        "data": response_data,
    }


async def _release_route_best_effort(
    *, owner_id: str, shell_id: str | None = None
) -> None:
    try:
        _ = await release_run_target_route(owner_id=owner_id, shell_id=shell_id)
    except Exception:
        pass


async def _publish_run_profile_state_best_effort(*, path: str, source: str) -> JsonMap:
    try:
        from ..run_profile_events import refresh_run_profile_state

        return await refresh_run_profile_state(
            {"path": path} if path else {},
            source=source,
        )
    except Exception:
        return {}


def _devtools_target_id(project_root: Path, profile_id: str) -> str:
    return run_profile_surface_id(project_root, profile_id)


def _decorate_route_urls(route_set: JsonMap, *, primary_url: str) -> None:
    primary = _json_object(route_set.get("primary"))
    primary["originalUrl"] = primary_url
    route_set["primary"] = primary
    additional_routes = route_set.get("additional")
    if not isinstance(additional_routes, list):
        return
    for item in additional_routes:
        route = _json_object(item)
        preferred_port = route.get("preferredPort")
        if isinstance(preferred_port, int):
            route["originalUrl"] = f"http://127.0.0.1:{preferred_port}/"
        if isinstance(item, dict):
            item.clear()
            item.update(route)


async def _cleanup_failed_launch(
    *,
    match: RunProfileMatch,
    shell_id: str,
    shell_label: str,
    reused: bool,
) -> None:
    await _release_route_best_effort(owner_id=shell_label, shell_id=shell_id)
    if not reused:
        if match.profile.runner == "pagePreview":
            _ = await stop_page_preview_shell(
                project_root=str(match.project_root),
                profile_id=match.profile.profile_id,
            )
        else:
            _ = await stop_runner_profile_shell(
                project_root=str(match.project_root),
                profile_id=match.profile.profile_id,
            )
    _ = await close_run_profile_surface(
        project_root=match.project_root,
        profile_id=match.profile.profile_id,
        source="run_profile_launch_failed",
    )
    _ = await _publish_run_profile_state_best_effort(
        path=str(match.active_file),
        source="run_profile_launch_failed",
    )


def _json_object(value: object) -> JsonMap:
    if not isinstance(value, Mapping):
        return {}
    return {str(key): item for key, item in value.items()}


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""
