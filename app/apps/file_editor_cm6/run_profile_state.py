# pyright: strict
from __future__ import annotations

import asyncio
from collections.abc import Mapping
from pathlib import Path

from .host.run_target_service import release_run_target_route
from .monaco_editor.editor_backend_services.contracts import JsonMap
from .page_preview_shell_manager import page_preview_shell_state
from .runner_profile_shell_manager import runner_profile_shell_state
from .runner_profiles import (
    RunProfileMatch,
    list_run_profile_candidates,
    match_run_profile,
    resolve_run_profile_by_id,
    run_profile_matches_path,
)
from .stores import get_history_store


def resolve_run_profile_match(
    data: Mapping[str, object] | None,
) -> RunProfileMatch | None:
    project_root, current_file = run_profile_request_context(data)
    if not project_root or not current_file:
        return None
    if _request_run_current_file(data):
        return None
    profile_id = _request_profile_id(data)
    if profile_id:
        return resolve_run_profile_by_id(project_root, current_file, profile_id)
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
    if not project_root or not current_file:
        return {
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
        }

    include_all = _request_include_all_profiles(data)
    if include_all:
        candidates = list_run_profile_candidates(
            project_root,
            current_file,
            include_all=True,
        )
        owners = [
            match
            for match in candidates
            if run_profile_matches_path(
                match.profile,
                match.relative_path,
                project_root=match.project_root,
            )
        ]
    else:
        owners = list_run_profile_candidates(project_root, current_file)
        candidates = owners
    owner_ids = {match.profile.profile_id for match in owners}
    projected = await asyncio.gather(
        *(
            _build_candidate_projection(
                match,
                owns_active_file=match.profile.profile_id in owner_ids,
                reconcile_stale_route=reconcile_stale_route,
            )
            for match in candidates
        )
    )
    relevant_running = [
        item
        for item in projected
        if item.get("ownsActiveFile") is True and item.get("running") is True
    ]
    primary: JsonMap | None = None
    if len(relevant_running) == 1:
        primary = relevant_running[0]
    elif len(owners) == 1:
        owner_id = owners[0].profile.profile_id
        primary = next(
            (item for item in projected if item.get("profileId") == owner_id),
            None,
        )
    return {
        "projectPath": str(Path(project_root).expanduser().resolve(strict=False)),
        "path": str(Path(current_file).expanduser().resolve(strict=False)),
        "matched": bool(owners),
        "running": bool(relevant_running),
        "profileId": _text(primary.get("profileId")) if primary else "",
        "runner": _text(primary.get("runner")) if primary else "",
        "shellId": _text(primary.get("shellId")) if primary else "",
        "label": _text(primary.get("shellLabel")) if primary else "",
        "selectionRequired": len(owners) > 1 or len(relevant_running) > 1,
        "candidateScope": "all" if include_all else "owners",
        "candidates": projected,
    }


async def _build_candidate_projection(
    match: RunProfileMatch,
    *,
    owns_active_file: bool,
    reconcile_stale_route: bool,
) -> JsonMap:
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
        "profileId": profile.profile_id,
        "runner": profile.runner,
        "entry": profile.entry,
        "ownsActiveFile": owns_active_file,
        "running": state.running,
        "shellId": state.shell_id,
        "shellLabel": state.label,
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


def _request_profile_id(data: Mapping[str, object] | None) -> str | None:
    value = data.get("profileId") if isinstance(data, Mapping) else None
    return value.strip() if isinstance(value, str) and value.strip() else None


def _request_run_current_file(data: Mapping[str, object] | None) -> bool:
    return isinstance(data, Mapping) and data.get("runCurrentFile") is True


def _request_include_all_profiles(data: Mapping[str, object] | None) -> bool:
    return isinstance(data, Mapping) and data.get("includeAllProfiles") is True


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""
