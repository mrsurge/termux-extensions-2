# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
import hashlib
from pathlib import Path

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..page_preview_shell_manager import ensure_page_preview_shell
from ..runner_profile_shell_manager import ensure_runner_profile_shell
from ..runner_profiles import (
    DEFAULT_PAGE_PREVIEW_URL,
    RunProfileConflictError,
    RunProfileMatch,
    match_run_profile,
)
from ..stores import get_history_store
from ..ui_ipc.sidebar_ws import handle_ui_sidebar_window_create_request


def resolve_runner_profile_run_request(
    data: Mapping[str, object] | None,
) -> RunProfileMatch | None:
    project_root = _active_project()
    if not project_root:
        return None
    current_file = _request_path(data) or _last_file(project_root)
    if not current_file:
        return None
    return match_run_profile(project_root, current_file)


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
        return {
            "ok": True,
            "data": {
                "action": "pagePreview",
                "profileId": profile.profile_id,
                "runner": profile.runner,
                "shell_id": shell.shell_id,
                "url": url,
                "reused": shell.reused,
                "entry": profile.entry,
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
        )

    message = (
        f"Run profile '{profile.profile_id}' already running"
        if shell.reused
        else f"Run profile '{profile.profile_id}' started"
    )
    if profile.sidebar_url:
        message = f"{message}; opened {profile.sidebar_url}"

    return {
        "ok": True,
        "data": {
            "action": "runProfile",
            "profileId": profile.profile_id,
            "runner": profile.runner,
            "shell_id": shell.shell_id,
            "reused": shell.reused,
            "exec": profile.exec_command,
            "cwd": profile.cwd,
            "matchedPath": match.relative_path,
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
    return await handle_runner_profile_run_request(match, source_name=source_name)


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
) -> JsonMap:
    target_id = _devtools_target_id(project_root, profile_id) if dev_tools else ""
    result = await handle_ui_sidebar_window_create_request(
        {
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
    )
    return dict(result)


def _devtools_target_id(project_root: Path, profile_id: str) -> str:
    project_hash = hashlib.sha256(str(project_root).encode("utf-8")).hexdigest()[:12]
    return f"run-profile:{project_hash}:{profile_id}"


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
