# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from .host.run_target_service import release_run_target_route
from .monaco_editor.editor_backend_services.contracts import JsonMap
from .page_preview_shell_manager import page_preview_shell_state
from .runner_profile_shell_manager import runner_profile_shell_state
from .runner_profiles import RunProfileMatch, match_run_profile
from .stores import get_history_store


def resolve_run_profile_match(
    data: Mapping[str, object] | None,
) -> RunProfileMatch | None:
    project_root, current_file = run_profile_request_context(data)
    if not project_root or not current_file:
        return None
    return match_run_profile(project_root, current_file)


def run_profile_request_context(
    data: Mapping[str, object] | None,
) -> tuple[str | None, str | None]:
    project_root = _active_project()
    if not project_root:
        return None, _request_path(data)
    return project_root, _request_path(data) or _last_file(project_root)


async def build_run_profile_state_projection(
    data: Mapping[str, object] | None = None,
    *,
    reconcile_stale_route: bool = False,
) -> JsonMap:
    project_root, current_file = run_profile_request_context(data)
    match = resolve_run_profile_match(data)
    if match is None:
        return {
            "projectPath": project_root or "",
            "path": current_file or "",
            "matched": False,
            "running": False,
            "profileId": "",
            "runner": "",
            "shellId": "",
            "label": "",
        }

    profile = match.profile
    state = (
        await page_preview_shell_state(
            project_root=str(match.project_root),
            profile_id=profile.profile_id,
        )
        if profile.runner == "pagePreview"
        else await runner_profile_shell_state(
            project_root=str(match.project_root),
            profile_id=profile.profile_id,
        )
    )
    if reconcile_stale_route and not state.running and profile.port is not None:
        await _release_route_best_effort(owner_id=state.label)
    return {
        "projectPath": str(match.project_root),
        "path": str(match.active_file),
        "matched": True,
        "running": state.running,
        "profileId": profile.profile_id,
        "runner": profile.runner,
        "shellId": state.shell_id,
        "label": state.label,
    }


async def _release_route_best_effort(*, owner_id: str) -> None:
    try:
        _ = await release_run_target_route(owner_id=owner_id)
    except Exception:
        pass


def _active_project() -> str | None:
    value = get_history_store().get_active_project()
    if not isinstance(value, str) or not value.strip():
        return None
    return str(Path(value).expanduser().resolve(strict=False))


def _last_file(project_root: str) -> str | None:
    value = get_history_store().get_last_file(project_root)
    return value if isinstance(value, str) and value.strip() else None


def _request_path(data: Mapping[str, object] | None) -> str | None:
    value = data.get("path") if isinstance(data, Mapping) else None
    return value if isinstance(value, str) and value.strip() else None
