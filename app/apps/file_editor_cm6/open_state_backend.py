# pyright: strict
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Literal, TypedDict

from .project_sidecar import ProjectSidecar

OpenStateReason = Literal[
    "file_open",
    "project_open",
    "project_open_with_file",
    "reconnect",
    "sidecar_replay",
    "no_file",
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


def _payload_from_sidecar(
    *,
    project_path: str,
    sidecar: ProjectSidecar,
    reason: str,
) -> SidecarOpenStatePayload:
    normalized_project = _normalize_path(project_path)
    raw_open_file = sidecar.get_last_file()
    open_file: str | None = None
    open_file_rel: str | None = None
    open_file_exists = False
    invalid_open_file: str | None = None

    if isinstance(raw_open_file, str) and raw_open_file.strip():
        normalized_file = _normalize_path(raw_open_file)
        if _is_under_project(normalized_project, normalized_file) and Path(normalized_file).is_file():
            open_file = normalized_file
            open_file_rel = _rel_to_project(normalized_project, normalized_file)
            open_file_exists = True
        else:
            invalid_open_file = normalized_file

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

    sidecar = ProjectSidecar.load_or_create(normalized_project)
    sidecar.reload()
    sidecar.record_file_activity(normalized_file)
    sidecar.bump_open_state_revision()
    sidecar.save()
    return _payload_from_sidecar(
        project_path=normalized_project,
        sidecar=sidecar,
        reason=str(reason),
    )


def clear_sidecar_open_file(
    project_path: str,
    *,
    reason: OpenStateReason | str = "no_file",
    require_existing_sidecar: bool = True,
) -> SidecarOpenStatePayload:
    normalized_project = _normalize_path(project_path)
    if require_existing_sidecar and not ProjectSidecar.sidecar_exists(normalized_project):
        raise FileNotFoundError("project_sidecar_missing")
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
