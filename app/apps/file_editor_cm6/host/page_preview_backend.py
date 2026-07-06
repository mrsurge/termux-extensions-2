# pyright: strict
from __future__ import annotations

from pathlib import Path
from typing import Mapping

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..page_preview_profiles import (
    DEFAULT_PAGE_PREVIEW_URL,
    RunProfileConflictError,
    install_default_page_preview_profile,
    match_run_profile,
)
from ..page_preview_shell_manager import ensure_page_preview_shell
from ..stores import get_history_store
from ..ui_ipc.sidebar_ws import handle_ui_sidebar_window_create_request


# This host hook bridges the existing play-button RPC into the run-profile
# subsystem. Non-profile files fall through to the legacy terminal runner.
async def maybe_handle_page_preview_run_request(
    data: Mapping[str, object] | None,
    *,
    source_name: str,
) -> JsonMap | None:
    project_root = _active_project()
    if not project_root:
        return None
    current_file = _request_path(data) or _last_file(project_root)
    if not current_file:
        return None

    try:
        match = match_run_profile(project_root, current_file)
    except RunProfileConflictError as exc:
        return {
            "ok": False,
            "error": str(exc),
            "data": {
                "conflict": True,
                "path": exc.relative_path,
                "profileIds": list(exc.profile_ids),
            },
        }
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    if match is None:
        return None

    profile = match.profile
    if profile.runner != "pagePreview":
        return {
            "ok": False,
            "error": f"Run profile '{profile.profile_id}' uses runner '{profile.runner}', which is not executable yet",
            "data": {"profileId": profile.profile_id, "runner": profile.runner},
        }

    shell = await ensure_page_preview_shell(
        project_root=str(match.project_root),
        profile_id=profile.profile_id,
        entry=profile.entry,
    )
    sidebar_result = await _open_preview_sidebar_url(
        url=profile.sidebar_url or shell.url or DEFAULT_PAGE_PREVIEW_URL,
        profile_id=profile.profile_id,
        source_name=source_name,
    )
    return {
        "ok": True,
        "data": {
            "action": "pagePreview",
            "profileId": profile.profile_id,
            "runner": profile.runner,
            "shell_id": shell.shell_id,
            "url": profile.sidebar_url or shell.url or DEFAULT_PAGE_PREVIEW_URL,
            "reused": shell.reused,
            "entry": profile.entry,
            "matchedPath": match.relative_path,
            "sidebar": sidebar_result,
            "command_preview": f"Page Preview {profile.entry}",
        },
    }


async def handle_host_page_preview_template_install_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    project_root = _active_project()
    if not project_root:
        return {"ok": False, "error": "No active project selected"}
    try:
        result = install_default_page_preview_profile(
            project_root,
            current_file=_request_path(data),
        )
    except Exception as exc:
        return {"ok": False, "error": f"Failed to install Page Preview profile: {exc}"}
    return {"ok": True, "data": result}


async def _open_preview_sidebar_url(
    *,
    url: str,
    profile_id: str,
    source_name: str,
) -> JsonMap:
    result = await handle_ui_sidebar_window_create_request(
        {
            "kind": "url",
            "host_id": f"page-preview:{profile_id}",
            "title": "Page Preview",
            "label": "Page Preview",
            "url": url,
            "restore_url": url,
            "load": "eager",
            "activate": True,
            "client_id": "main_page",
            "source": f"{source_name}:page_preview",
        }
    )
    return dict(result)


def _active_project() -> str | None:
    value = get_history_store().get_active_project()
    if not isinstance(value, str) or not value.strip():
        return None
    root = Path(value).expanduser().resolve(strict=False)
    return str(root)


def _last_file(project_root: str) -> str | None:
    value = get_history_store().get_last_file(project_root)
    return value if isinstance(value, str) and value.strip() else None


def _request_path(data: Mapping[str, object] | None) -> str | None:
    value = data.get("path") if isinstance(data, Mapping) else None
    return value if isinstance(value, str) and value.strip() else None
