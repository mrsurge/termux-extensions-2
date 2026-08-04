# pyright: strict
from __future__ import annotations

import asyncio
from collections.abc import Awaitable
import hashlib
import importlib
import json
from pathlib import Path
from typing import Callable, cast

from fastapi import HTTPException

from ..explorer.review import save_reviews
from ..explorer.services.file_ops import mark_draft_cache_dirty
from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..monaco_editor.editor_ws import editor_runtime_notify_draft_state_changed
from ..runner_profiles import (
    DraftSaveMode,
    RunProfileConflictError,
    RunProfileMatch,
    fallback_show_save_warning,
    run_profile_matches_path,
    set_run_save_warning,
)
from ..stores import get_history_store
from ..ui_ipc.rpc_contract import UI_IPC_RPC_NOTIFICATION_TERMINAL_OPEN

RunActiveFileHook = Callable[[dict[str, object] | None], Awaitable[dict[str, object]]]

_LEGACY_UNSUPPORTED_RUNNER_MESSAGE = (
    "Only Python, shell, JS/TS, and C/C++ source files can be executed"
)
_run_locks: dict[str, asyncio.Lock] = {}


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""


def _json_object(value: object) -> JsonMap:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


async def _save_active_before_play(
    payload: JsonMap,
    *,
    active_file: Path,
    source_name: str,
) -> JsonMap | None:
    from .file_ops_backend import handle_host_save_request

    save_payload: JsonMap = dict(payload)
    save_payload["reason"] = "play"
    save_payload["expected_path"] = str(active_file)
    try:
        save_result = await handle_host_save_request(save_payload, source_name=source_name)
    except Exception as exc:
        return {"ok": False, "error": f"Save failed; not running file: {exc}"}
    if save_result.get("ok") is False:
        error = _text(save_result.get("error")) or "Save failed; not running file"
        if error == "active_file_changed":
            error = (
                "Active file changed while confirming Run; nothing was launched. "
                "Run the current file again."
            )
        return {"ok": False, "error": error, "data": {"save": save_result}}
    return None


async def _save_background_drafts_before_play(
    *,
    project_root: Path,
    active_file: Path,
    match: RunProfileMatch | None,
    save_mode: DraftSaveMode | str,
    source_name: str,
) -> JsonMap | None:
    relative_paths = _background_draft_paths(
        project_root=project_root,
        active_file=active_file,
        match=match,
        save_mode=save_mode,
    )
    if not relative_paths:
        return None
    result = await save_reviews(
        project_root,
        relative_paths,
        client_id=source_name,
        op_prefix="run_profile_save",
    )
    errors_obj = result.get("errors")
    errors = (
        [item for item in cast(list[object], errors_obj) if isinstance(item, str)]
        if isinstance(errors_obj, list)
        else []
    )
    if errors:
        return {
            "ok": False,
            "error": "Draft save failed; run was not launched",
            "data": {
                "save": result,
                "failedPaths": errors,
            },
        }
    mark_draft_cache_dirty(project_root)
    editor_runtime_notify_draft_state_changed(str(project_root))
    return None


async def _save_before_play(
    payload: JsonMap,
    *,
    project_root: Path,
    active_file: Path,
    match: RunProfileMatch | None,
    save_mode: DraftSaveMode | str,
    source_name: str,
) -> JsonMap | None:
    if save_mode == "none":
        return None

    active_failure = await _save_active_before_play(
        payload,
        active_file=active_file,
        source_name=source_name,
    )
    if active_failure is not None:
        return active_failure

    return await _save_background_drafts_before_play(
        project_root=project_root,
        active_file=active_file,
        match=match,
        save_mode=save_mode,
        source_name=source_name,
    )


async def _emit_terminal_open(payload: JsonMap) -> None:
    from ..ui_ipc.ui_ipc_ws import emit_ui_ipc_rpc_notification

    await emit_ui_ipc_rpc_notification(UI_IPC_RPC_NOTIFICATION_TERMINAL_OPEN, payload)


async def handle_host_run_active_file_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    payload: JsonMap = dict(data)
    if "source_client" not in payload:
        payload["source_client"] = source_name
    project_root = _active_project()
    if project_root is None:
        return {"ok": False, "error": "No active project selected"}
    lock = _run_locks.setdefault(str(project_root), asyncio.Lock())
    async with lock:
        return await _handle_host_run_active_file_request(
            payload,
            project_root=project_root,
            source_name=source_name,
            enforce_current_context=True,
        )


async def _handle_host_run_active_file_request(
    payload: JsonMap,
    *,
    project_root: Path,
    source_name: str,
    enforce_current_context: bool = False,
) -> JsonMap:
    from .runner_profiles_backend import (
        build_run_profile_selection_response,
        handle_runner_profile_run_request,
        resolve_runner_profile_run_request,
    )

    try:
        match = resolve_runner_profile_run_request(payload)
    except RunProfileConflictError:
        return await build_run_profile_selection_response(payload)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    active_file = match.active_file if match is not None else _active_file(payload, project_root)
    if active_file is None:
        return {"ok": False, "error": "No active file selected"}
    if enforce_current_context and not _run_context_is_current(
        project_root=project_root,
        active_file=active_file,
    ):
        return {
            "ok": False,
            "error": "Active project or file changed before Run could continue",
            "data": {"action": "none", "staleRunIntent": True},
        }

    save_mode: DraftSaveMode | str = (
        match.profile.save_drafts if match is not None else "active"
    )
    confirmation_key = _draft_save_confirmation_key(
        active_file=active_file,
        match=match,
        save_mode=save_mode,
    )
    try:
        show_warning = (
            match.profile.show_save_warning
            if match is not None
            else fallback_show_save_warning(project_root)
        )
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    confirmed = (
        payload.get("confirmDraftSave") is True
        and _text(payload.get("draftSaveConfirmationKey")) == confirmation_key
    )
    if save_mode != "none" and show_warning and not confirmed:
        return _draft_save_confirmation(
            active_file=active_file,
            match=match,
            save_mode=save_mode,
            confirmation_key=confirmation_key,
        )

    if confirmed and payload.get("suppressSaveWarning") is True:
        try:
            _ = set_run_save_warning(
                project_root,
                profile_id=match.profile.profile_id if match is not None else None,
                enabled=False,
            )
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}

    save_failure = await _save_before_play(
        payload,
        project_root=project_root,
        active_file=active_file,
        match=match,
        save_mode=save_mode,
        source_name=source_name,
    )
    if save_failure is not None:
        return save_failure
    if enforce_current_context and not _run_context_is_current(
        project_root=project_root,
        active_file=active_file,
    ):
        return {
            "ok": False,
            "error": "Active project or file changed while drafts were being saved",
            "data": {"action": "none", "staleRunIntent": True},
        }

    if match is not None:
        return await handle_runner_profile_run_request(match, source_name=source_name)

    terminal_backend = importlib.import_module("app.apps.file_editor_cm6.terminal_backend")
    hook = cast(RunActiveFileHook, getattr(terminal_backend, "handle_run_active_file_request"))
    try:
        result = dict(await hook(payload))
    except HTTPException as exc:
        if exc.status_code == 400 and str(exc.detail) == _LEGACY_UNSUPPORTED_RUNNER_MESSAGE:
            return {
                "ok": False,
                "error": "No run profile or default runner for this file",
                "data": {"action": "none"},
            }
        raise

    if result.get("ok") is True:
        data_obj = _json_object(cast(object, result.get("data")))
        _ = data_obj.setdefault("action", "terminal")
        _ = data_obj.setdefault("message", "Running active file in terminal")
        result["data"] = data_obj
        await _emit_terminal_open(data_obj)
    return result


def _active_project() -> Path | None:
    value = get_history_store().get_active_project()
    if not isinstance(value, str) or not value.strip():
        return None
    return Path(value).expanduser().resolve(strict=False)


def _active_file(payload: JsonMap, project_root: Path) -> Path | None:
    value = payload.get("path")
    if not isinstance(value, str) or not value.strip():
        value = get_history_store().get_last_file(str(project_root))
    if not isinstance(value, str) or not value.strip():
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = project_root / path
    resolved = path.resolve(strict=False)
    try:
        _ = resolved.relative_to(project_root)
    except ValueError:
        return None
    return resolved


def _run_context_is_current(*, project_root: Path, active_file: Path) -> bool:
    current_project = _active_project()
    if current_project != project_root:
        return False
    current_file = get_history_store().get_last_file(str(project_root))
    if not isinstance(current_file, str) or not current_file.strip():
        return False
    return Path(current_file).expanduser().resolve(strict=False) == active_file


def _background_draft_paths(
    *,
    project_root: Path,
    active_file: Path,
    match: RunProfileMatch | None,
    save_mode: DraftSaveMode | str,
) -> list[str]:
    if save_mode in {"none", "active"}:
        return []

    history = get_history_store()
    open_paths = {
        str(Path(path).expanduser().resolve(strict=False))
        for entry in history.list_files(str(project_root))
        if isinstance((path := entry.get("path")), str) and path
    }
    selected: list[str] = []
    for draft in history.list_project_drafts(str(project_root)):
        path_obj = draft.get("file_path")
        if not isinstance(path_obj, str) or not path_obj:
            continue
        draft_path = Path(path_obj).expanduser().resolve(strict=False)
        if draft_path == active_file:
            continue
        try:
            relative_path = draft_path.relative_to(project_root).as_posix()
        except ValueError:
            continue
        if save_mode == "opened" and str(draft_path) not in open_paths:
            continue
        if save_mode == "included":
            if match is None or not run_profile_matches_path(
                match.profile,
                relative_path,
                project_root=project_root,
            ):
                continue
        selected.append(relative_path)
    return sorted(set(selected))


def _draft_save_confirmation(
    *,
    active_file: Path,
    match: RunProfileMatch | None,
    save_mode: DraftSaveMode | str,
    confirmation_key: str,
) -> JsonMap:
    profile_id = match.profile.profile_id if match is not None else None
    if save_mode == "included":
        detail = (
            "The active file and every unsaved draft matching this profile's "
            "Included Files patterns will be written to disk before launch."
        )
    elif save_mode == "opened":
        detail = (
            "The active file and unsaved drafts in the canonical open-file set "
            "will be written to disk before launch."
        )
    elif save_mode == "all":
        detail = (
            "The active file and every unsaved draft in this project will be "
            "written to disk before launch."
        )
    else:
        detail = "The active file will be written to disk before launch."
    return {
        "ok": True,
        "data": {
            "action": "confirmDraftSave",
            "profileId": profile_id,
            "saveDrafts": save_mode,
            "path": str(active_file),
            "confirmationKey": confirmation_key,
            "message": "Save drafts before running?",
            "detail": detail,
        },
    }


def _draft_save_confirmation_key(
    *,
    active_file: Path,
    match: RunProfileMatch | None,
    save_mode: DraftSaveMode | str,
) -> str:
    profile = match.profile if match is not None else None
    state = {
        "path": str(active_file),
        "profileId": profile.profile_id if profile is not None else None,
        "saveDrafts": save_mode,
        "include": list(profile.include) if profile is not None else [],
    }
    encoded = json.dumps(state, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
