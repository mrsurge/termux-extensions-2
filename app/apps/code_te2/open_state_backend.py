# pyright: strict
from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Literal, TypedDict

from .client_presentation import normalize_client_instance_id
from .project_sidecar import ProjectSidecar

_OPEN_STATE_LOCK = threading.RLock()

OpenStateReason = Literal[
    "file_open",
    "project_open",
    "project_open_with_file",
    "reconnect",
    "sidecar_replay",
    "no_file",
    "recent_file_closed",
    "tracked_edit",
]


class SidecarOpenStatePayload(TypedDict):
    projectPath: str
    sidecarPath: str
    openFile: str | None
    openFileRel: str | None
    openFileExists: bool
    invalidOpenFile: str | None
    revision: int
    reason: str
    ts: int
    recents: list[RecentFilePayload]


class RecentFilePayload(TypedDict):
    path: str
    label: str
    opened_at: object
    exists: bool
    scroll_line: object


class ClientForegroundPayload(TypedDict):
    projectPath: str
    clientInstanceId: str
    path: str | None
    rel: str | None
    exists: bool
    revision: int
    seededFromLegacy: bool
    reason: str
    ts: int


def _normalize_path(path: str) -> str:
    try:
        return str(Path(path).expanduser().resolve(strict=False))
    except Exception:
        return str(path or "").strip()


def _is_under_project(project_path: str, abs_path: str) -> bool:
    try:
        root = Path(project_path).expanduser().resolve(strict=False)
        candidate = Path(abs_path).expanduser().resolve(strict=False)
        if candidate == root:
            return True
        return str(candidate).startswith(str(root) + os.sep)
    except Exception:
        return False


def _rel_to_project(project_path: str, abs_path: str) -> str | None:
    try:
        root = Path(project_path).expanduser().resolve(strict=False)
        candidate = Path(abs_path).expanduser().resolve(strict=False)
        rel = candidate.relative_to(root).as_posix()
        return rel or "."
    except Exception:
        return None


def _recent_files_from_sidecar(sidecar: ProjectSidecar) -> list[RecentFilePayload]:
    recents: list[RecentFilePayload] = []
    for entry in sidecar.list_recent_files():
        raw_path = entry.get("path")
        if not isinstance(raw_path, str) or not raw_path.strip():
            continue
        path = _normalize_path(raw_path)
        raw_label = entry.get("label")
        label = (
            raw_label
            if isinstance(raw_label, str) and raw_label
            else Path(path).name or path
        )
        recents.append(
            {
                "path": path,
                "label": label,
                "opened_at": entry.get("opened_at"),
                "exists": Path(path).is_file(),
                "scroll_line": entry.get("scroll_line"),
            }
        )
    return recents[:12]


def _valid_member_paths(
    project_path: str,
    sidecar: ProjectSidecar,
) -> list[str]:
    paths: list[str] = []
    for entry in _recent_files_from_sidecar(sidecar):
        path = entry["path"]
        if entry["exists"] and _is_under_project(project_path, path):
            paths.append(path)
    return paths


def _client_foreground_payload(
    *,
    project_path: str,
    sidecar: ProjectSidecar,
    client_instance_id: str,
    reason: str,
) -> ClientForegroundPayload:
    entry = sidecar.get_client_foreground_entry(client_instance_id) or {}
    raw_path = entry.get("path")
    path = _normalize_path(raw_path) if isinstance(raw_path, str) and raw_path else None
    exists = bool(
        path
        and _is_under_project(project_path, path)
        and Path(path).is_file()
    )
    raw_revision = entry.get("revision")
    revision = raw_revision if isinstance(raw_revision, int) else 0
    return {
        "projectPath": project_path,
        "clientInstanceId": client_instance_id,
        "path": path if exists else None,
        "rel": _rel_to_project(project_path, path) if exists and path else None,
        "exists": exists,
        "revision": revision,
        "seededFromLegacy": entry.get("seeded_from_legacy") is True,
        "reason": reason,
        "ts": int(time.time() * 1000),
    }


def _require_client_instance_id(value: str) -> str:
    normalized = normalize_client_instance_id(value)
    if normalized is None:
        raise ValueError("invalid_client_instance_id")
    return normalized


def _payload_from_sidecar(
    *,
    project_path: str,
    sidecar: ProjectSidecar,
    reason: str,
) -> SidecarOpenStatePayload:
    normalized_project = _normalize_path(project_path)
    open_file: str | None = None
    open_file_rel: str | None = None
    open_file_exists = False
    invalid_open_file: str | None = None

    return {
        "projectPath": normalized_project,
        "sidecarPath": str(ProjectSidecar.get_sidecar_path(normalized_project)),
        "openFile": open_file,
        "openFileRel": open_file_rel,
        "openFileExists": open_file_exists,
        "invalidOpenFile": invalid_open_file,
        "revision": sidecar.get_open_state_revision(),
        "reason": reason,
        "ts": int(time.time() * 1000),
        "recents": _recent_files_from_sidecar(sidecar),
    }


def read_sidecar_open_state(
    project_path: str,
    *,
    reason: OpenStateReason | str,
    reload_from_disk: bool = True,
    require_existing_sidecar: bool = False,
) -> SidecarOpenStatePayload:
    normalized_project = _normalize_path(project_path)
    if require_existing_sidecar and not ProjectSidecar.sidecar_exists(normalized_project):
        raise FileNotFoundError("project_sidecar_missing")
    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        if reload_from_disk:
            sidecar.reload()
        return _payload_from_sidecar(
            project_path=normalized_project,
            sidecar=sidecar,
            reason=str(reason),
        )


def write_sidecar_open_file(
    project_path: str,
    file_path: str,
    *,
    reason: OpenStateReason | str = "file_open",
    require_existing_sidecar: bool = True,
) -> SidecarOpenStatePayload:
    normalized_project = _normalize_path(project_path)
    normalized_file = _normalize_path(file_path)
    if require_existing_sidecar and not ProjectSidecar.sidecar_exists(normalized_project):
        raise FileNotFoundError("project_sidecar_missing")
    if not _is_under_project(normalized_project, normalized_file):
        raise PermissionError("outside_project")
    if not Path(normalized_file).is_file():
        raise FileNotFoundError("file_missing")

    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        sidecar.reload()
        sidecar.record_document_activity(normalized_file)
        sidecar.bump_open_state_revision()
        sidecar.save()
        return _payload_from_sidecar(
            project_path=normalized_project,
            sidecar=sidecar,
            reason=str(reason),
        )


def read_client_foreground(
    project_path: str,
    client_instance_id: str,
    *,
    reason: str = "reconnect",
    seed_if_missing: bool = True,
) -> ClientForegroundPayload:
    normalized_project = _normalize_path(project_path)
    normalized_client = _require_client_instance_id(client_instance_id)
    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        sidecar.reload()
        entry = sidecar.get_client_foreground_entry(normalized_client)
        valid_members = _valid_member_paths(normalized_project, sidecar)
        current = sidecar.get_client_foreground(normalized_client)
        if entry is None and seed_if_missing:
            legacy = sidecar.get_last_file()
            legacy_valid = legacy in valid_members if legacy else False
            selected = legacy if legacy_valid else (valid_members[0] if valid_members else None)
            sidecar.set_client_foreground(
                normalized_client,
                selected,
                seeded_from_legacy=legacy_valid,
            )
            if legacy is not None:
                sidecar.set_last_file(None)
            sidecar.save()
        elif entry is not None and current not in valid_members and current is not None:
            sidecar.set_client_foreground(
                normalized_client,
                valid_members[0] if valid_members else None,
            )
            sidecar.save()
        return _client_foreground_payload(
            project_path=normalized_project,
            sidecar=sidecar,
            client_instance_id=normalized_client,
            reason=reason,
        )


def write_client_document_open(
    project_path: str,
    file_path: str,
    client_instance_id: str,
    *,
    reason: str = "file_open",
    require_existing_sidecar: bool = True,
) -> tuple[SidecarOpenStatePayload, ClientForegroundPayload]:
    normalized_project = _normalize_path(project_path)
    normalized_file = _normalize_path(file_path)
    normalized_client = _require_client_instance_id(client_instance_id)
    if require_existing_sidecar and not ProjectSidecar.sidecar_exists(normalized_project):
        raise FileNotFoundError("project_sidecar_missing")
    if not _is_under_project(normalized_project, normalized_file):
        raise PermissionError("outside_project")
    if not Path(normalized_file).is_file():
        raise FileNotFoundError("file_missing")

    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        sidecar.reload()
        sidecar.record_document_activity(normalized_file)
        sidecar.bump_open_state_revision()
        sidecar.set_client_foreground(normalized_client, normalized_file)
        sidecar.set_last_file(None)
        sidecar.save()
        return (
            _payload_from_sidecar(
                project_path=normalized_project,
                sidecar=sidecar,
                reason=reason,
            ),
            _client_foreground_payload(
                project_path=normalized_project,
                sidecar=sidecar,
                client_instance_id=normalized_client,
                reason=reason,
            ),
        )


def write_client_foreground(
    project_path: str,
    file_path: str | None,
    client_instance_id: str,
    *,
    reason: str = "foreground_change",
) -> ClientForegroundPayload:
    normalized_project = _normalize_path(project_path)
    normalized_client = _require_client_instance_id(client_instance_id)
    normalized_file = _normalize_path(file_path) if file_path else None
    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        sidecar.reload()
        if normalized_file is not None:
            if normalized_file not in _valid_member_paths(normalized_project, sidecar):
                raise ValueError("foreground_document_not_admitted")
        sidecar.set_client_foreground(normalized_client, normalized_file)
        sidecar.set_last_file(None)
        sidecar.save()
        return _client_foreground_payload(
            project_path=normalized_project,
            sidecar=sidecar,
            client_instance_id=normalized_client,
            reason=reason,
        )


def list_client_foregrounds(
    project_path: str,
    *,
    reason: str,
) -> list[ClientForegroundPayload]:
    normalized_project = _normalize_path(project_path)
    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        sidecar.reload()
        return [
            _client_foreground_payload(
                project_path=normalized_project,
                sidecar=sidecar,
                client_instance_id=client_instance_id,
                reason=reason,
            )
            for client_instance_id in sidecar.list_client_foreground_entries()
        ]


def clear_sidecar_open_file(
    project_path: str,
    *,
    reason: OpenStateReason | str = "no_file",
    require_existing_sidecar: bool = True,
) -> SidecarOpenStatePayload:
    normalized_project = _normalize_path(project_path)
    if require_existing_sidecar and not ProjectSidecar.sidecar_exists(normalized_project):
        raise FileNotFoundError("project_sidecar_missing")
    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        sidecar.reload()
        sidecar.set_last_file(None)
        sidecar.bump_open_state_revision()
        sidecar.save()
        return _payload_from_sidecar(
            project_path=normalized_project,
            sidecar=sidecar,
            reason=str(reason),
        )


def remove_sidecar_recent_file(
    project_path: str,
    file_path: str,
    *,
    reason: OpenStateReason | str = "recent_file_closed",
    require_existing_sidecar: bool = True,
) -> tuple[bool, SidecarOpenStatePayload]:
    """Remove one sidecar recent entry and return its new open-state projection."""
    normalized_project = _normalize_path(project_path)
    normalized_file = _normalize_path(file_path)
    if require_existing_sidecar and not ProjectSidecar.sidecar_exists(normalized_project):
        raise FileNotFoundError("project_sidecar_missing")
    if not _is_under_project(normalized_project, normalized_file):
        raise PermissionError("outside_project")

    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        sidecar.reload()
        removed = sidecar.remove_recent_file(normalized_file)
        if removed:
            sidecar.bump_open_state_revision()
            sidecar.save()
        return removed, _payload_from_sidecar(
            project_path=normalized_project,
            sidecar=sidecar,
            reason=str(reason),
        )


def clear_sidecar_recent_files(
    project_path: str,
    *,
    reason: OpenStateReason | str = "no_file",
    require_existing_sidecar: bool = True,
) -> SidecarOpenStatePayload:
    """Clear shared document membership and every client foreground atomically."""
    normalized_project = _normalize_path(project_path)
    if require_existing_sidecar and not ProjectSidecar.sidecar_exists(normalized_project):
        raise FileNotFoundError("project_sidecar_missing")
    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        sidecar.reload()
        sidecar.clear_recent_files()
        sidecar.bump_open_state_revision()
        sidecar.save()
        return _payload_from_sidecar(
            project_path=normalized_project,
            sidecar=sidecar,
            reason=str(reason),
        )
