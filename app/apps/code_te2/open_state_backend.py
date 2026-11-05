# pyright: strict
from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Literal, NotRequired, TypeAlias, TypedDict

from .client_presentation import (
    ClientRole,
    normalize_client_instance_id,
    normalize_client_role,
)
from .project_sidecar import ProjectSidecar
from .editor_open_state import EditorOpenState
from .editor_renderer_bindings import editor_renderer_binding, registered_editor_renderer_binding

_OPEN_STATE_LOCK = threading.RLock()
OpaqueValue: TypeAlias = object

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
    projectGeneration: NotRequired[int]
    editorPlacement: NotRequired[EditorPlacementPayload]


class RecentFilePayload(TypedDict):
    path: str
    label: str
    opened_at: OpaqueValue
    exists: bool
    scroll_line: OpaqueValue


class ClientForegroundPayload(TypedDict):
    projectPath: str
    clientInstanceId: str
    path: str | None
    rel: str | None
    exists: bool
    revision: int
    seededFromLegacy: bool
    clientRole: ClientRole
    reason: str
    ts: int
    editorPlacement: NotRequired[EditorPlacementPayload]


class EditorPlacementPayload(TypedDict):
    mainPageClientInstanceId: str
    area: ClientRole
    revision: int
    paths: list[str]


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
    entries = {str(entry.get("path")): entry for entry in sidecar.list_recent_files()}
    documents = sidecar.read_editor_open_state().documents
    ordered = [path for path in entries if path in documents]
    ordered.extend(path for path in documents if path not in entries)
    for document in ordered:
        entry = entries.get(document, {"path": document})
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
    return recents


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
    payload: ClientForegroundPayload = {
        "projectPath": project_path,
        "clientInstanceId": client_instance_id,
        "path": path if exists else None,
        "rel": _rel_to_project(project_path, path) if exists and path else None,
        "exists": exists,
        "revision": revision,
        "seededFromLegacy": entry.get("seeded_from_legacy") is True,
        "clientRole": normalize_client_role(entry.get("client_role")),
        "reason": reason,
        "ts": int(time.time() * 1000),
    }
    binding = editor_renderer_binding(client_instance_id)
    state = sidecar.read_editor_open_state()
    for client in state.clients:
        if client.client_id == binding.main_page_id:
            payload["editorPlacement"] = {
                "mainPageClientInstanceId": binding.main_page_id,
                "area": binding.area, "revision": state.revision,
                "paths": list(client.paths(binding.area)),
            }
            break
    return payload


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

    from .worker_services.event_bus import current_project_generation
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
        "projectGeneration": current_project_generation(project_path) or 0,
    }


def read_client_open_state(project_path: str, client_id: str, *, reason: str) -> SidecarOpenStatePayload:
    """Project only this renderer's placement; never broadcast all client tabs."""
    return read_client_open_states(project_path, (client_id,), reason=reason)[client_id]


def read_client_open_states(
    project_path: str, client_ids: tuple[str, ...], *, reason: str,
) -> dict[str, SidecarOpenStatePayload]:
    """One disk read and document projection for a complete client fan-out."""
    normalized = _normalize_path(project_path)
    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized)
        sidecar.reload()
        common = _payload_from_sidecar(project_path=normalized, sidecar=sidecar, reason=reason)
        state = sidecar.read_editor_open_state()
        clients = {client.client_id: client for client in state.clients}
        results: dict[str, SidecarOpenStatePayload] = {}
        for client_id in client_ids:
            payload = common.copy()
            binding = registered_editor_renderer_binding(client_id)
            if binding is not None:
                client = clients.get(binding.main_page_id)
                paths = (client.paths(binding.area) if client else state.documents if binding.area == "primary" else ())
                payload["editorPlacement"] = {
                    "mainPageClientInstanceId": binding.main_page_id, "area": binding.area,
                    "revision": state.revision, "paths": list(paths),
                }
            results[client_id] = payload
        return results


class ClientCloseResult(TypedDict):
    kind: Literal["presentation", "document"]
    openState: SidecarOpenStatePayload
    affectedForegrounds: list[ClientForegroundPayload]
    clientForeground: ClientForegroundPayload
    successor: str | None


class ClientAreaCloseResult(TypedDict):
    closedDocuments: list[str]
    openState: SidecarOpenStatePayload
    affectedForegrounds: list[ClientForegroundPayload]
    clientForeground: ClientForegroundPayload


class SecondaryRestoreRecovery(TypedDict):
    openState: SidecarOpenStatePayload
    affectedForegrounds: list[ClientForegroundPayload]


def recover_orphaned_secondary(
    project_path: str, client_id: str, *, expected_generation: int,
) -> SecondaryRestoreRecovery | None:
    """Caller excludes active/pending content on the event loop before this transaction."""
    from .worker_services.event_bus import current_project_generation
    project = _normalize_path(project_path)
    with _OPEN_STATE_LOCK:
        if (current_project_generation(project) or 0) != expected_generation:
            raise ValueError("editor_project_generation_stale")
        binding = registered_editor_renderer_binding(client_id)
        if binding is None or binding.area != "secondary":
            return None
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.reload()
        if sidecar.get_client_foreground(client_id) is not None:
            return None
        state = sidecar.read_editor_open_state()
        if not any(client.client_id == binding.main_page_id for client in state.clients):
            return None
        repaired = state.recover_secondary_to_primary(binding.main_page_id)
        if repaired is state:
            return None
        sidecar.set_editor_open_state(repaired, expected_revision=state.revision)
        changed: list[str] = []
        if sidecar.get_client_foreground(binding.main_page_id) is None:
            selected = next((path for path in repaired.placement(binding.main_page_id).primary
                             if Path(path).is_file()), None)
            if selected is not None:
                sidecar.set_client_foreground(binding.main_page_id, selected, client_role="primary")
                changed.append(binding.main_page_id)
        sidecar.save()
        return {
            "openState": _payload_from_sidecar(project_path=project, sidecar=sidecar, reason="secondary_restore_recovered"),
            "affectedForegrounds": [_client_foreground_payload(
                project_path=project, sidecar=sidecar, client_instance_id=renderer,
                reason="secondary_restore_recovered",
            ) for renderer in changed],
        }


def close_client_area(
    project_path: str, client_id: str, *, expected_revision: int, expected_generation: int,
) -> ClientAreaCloseResult:
    """Close an area's presentations in one transaction, not merely its foreground."""
    from .worker_services.event_bus import current_project_generation
    project = _normalize_path(project_path)
    with _OPEN_STATE_LOCK:
        if (current_project_generation(project) or 0) != expected_generation:
            raise ValueError("editor_project_generation_stale")
        binding = registered_editor_renderer_binding(client_id)
        if binding is None or binding.area != "secondary":
            raise ValueError("secondary_renderer_association_required")
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.reload()
        state = sidecar.read_editor_open_state()
        state.require_revision(expected_revision)
        previous_foregrounds = sidecar.list_client_foreground_entries()
        closed: list[str] = []
        for path in state.placement(binding.main_page_id).secondary:
            transition = state.close_presentation(binding.main_page_id, path, "secondary",
                                                  expected_revision=state.revision)
            if transition.kind == "document":
                sidecar.remove_recent_file(path)
                closed.append(path)
            else:
                sidecar.set_editor_open_state(transition.state, expected_revision=state.revision)
            state = sidecar.read_editor_open_state()
        sidecar.set_client_foreground(client_id, None, client_role="secondary")
        sidecar.save()
        changed = [renderer for renderer, entry in sidecar.list_client_foreground_entries().items()
                   if previous_foregrounds.get(renderer) != entry]
        return {
            "closedDocuments": closed,
            "openState": _payload_from_sidecar(project_path=project, sidecar=sidecar, reason="secondary_editor_closed"),
            "affectedForegrounds": [_client_foreground_payload(
                project_path=project, sidecar=sidecar, client_instance_id=renderer,
                reason="secondary_editor_closed",
            ) for renderer in changed],
            "clientForeground": _client_foreground_payload(
                project_path=project, sidecar=sidecar, client_instance_id=client_id,
                reason="secondary_editor_closed",
            ),
        }


def close_client_presentation(
    project_path: str, file_path: str, client_id: str, *,
    expected_revision: int, expected_generation: int,
) -> ClientCloseResult:
    """One locked mutation; consent/discard remain with their existing owners."""
    from .worker_services.event_bus import current_project_generation
    project, path = _normalize_path(project_path), _normalize_path(file_path)
    with _OPEN_STATE_LOCK:
        if (current_project_generation(project) or 0) != expected_generation:
            raise ValueError("editor_project_generation_stale")
        binding = registered_editor_renderer_binding(client_id)
        if binding is None:
            raise ValueError("editor_renderer_association_required")
        sidecar = ProjectSidecar.load_or_create(project)
        sidecar.reload()
        state = sidecar.read_editor_open_state()
        state.require_revision(expected_revision)
        transition = state.close_presentation(binding.main_page_id, path, binding.area,
                                              expected_revision=expected_revision)
        if transition.kind == "document":
            _, changed = sidecar.remove_recent_file(path)
        else:
            sidecar.set_editor_open_state(transition.state, expected_revision=state.revision)
            changed = []
            if sidecar.get_client_foreground(client_id) == path:
                remaining = transition.state.placement(binding.main_page_id).paths(binding.area)
                sidecar.set_client_foreground(client_id, remaining[0] if remaining else None,
                                              client_role=binding.area)
                changed.append(client_id)
        sidecar.save()
        foreground = _client_foreground_payload(project_path=project, sidecar=sidecar,
                                                client_instance_id=client_id, reason="presentation_closed")
        return {
            "kind": transition.kind,
            "openState": _payload_from_sidecar(project_path=project, sidecar=sidecar, reason="presentation_closed"),
            "affectedForegrounds": [_client_foreground_payload(
                project_path=project, sidecar=sidecar, client_instance_id=renderer_id,
                reason="presentation_closed",
            ) for renderer_id in changed],
            "clientForeground": foreground, "successor": foreground["path"],
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
        state = sidecar.read_editor_open_state()
        sidecar.set_editor_open_state(state.admit_document(normalized_file), expected_revision=state.revision)
        sidecar.record_document_activity(normalized_file)
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
    client_role: ClientRole | None = None,
) -> ClientForegroundPayload:
    normalized_project = _normalize_path(project_path)
    normalized_client = _require_client_instance_id(client_instance_id)
    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        sidecar.reload()
        state = sidecar.read_editor_open_state()
        binding = registered_editor_renderer_binding(normalized_client)
        connected = state.connect(binding.main_page_id) if binding is not None else state
        sidecar.set_editor_open_state(connected, expected_revision=state.revision)
        entry = sidecar.get_client_foreground_entry(normalized_client)
        role = normalize_client_role(client_role if client_role is not None else binding.area if binding else None)
        placement = connected.placement(binding.main_page_id) if binding else None
        current_path = sidecar.get_client_foreground(normalized_client)
        if binding and role == "secondary" and current_path is not None and current_path in connected.documents:
            restored = connected.open_document(binding.main_page_id, current_path, "secondary")
            sidecar.set_editor_open_state(restored, expected_revision=connected.revision)
            placement = restored.placement(binding.main_page_id)
        candidates = placement.paths(role) if placement else connected.documents
        valid_members = [path for path in candidates if Path(path).is_file()]
        current = sidecar.get_client_foreground(normalized_client)
        if entry is None and seed_if_missing:
            legacy = sidecar.get_last_file()
            legacy_valid = legacy in valid_members if legacy else False
            resolved_role = role
            selected = (
                None
                if resolved_role == "secondary"
                else (legacy if legacy_valid else (valid_members[0] if valid_members else None))
            )
            sidecar.set_client_foreground(
                normalized_client,
                selected,
                client_role=resolved_role,
                seeded_from_legacy=legacy_valid and resolved_role == "primary",
            )
            if legacy is not None and resolved_role == "primary":
                sidecar.set_last_file(None)
        elif entry is not None and current not in valid_members and (current is not None or valid_members):
            resolved_role = normalize_client_role(
                client_role if client_role is not None else entry.get("client_role")
            )
            sidecar.set_client_foreground(
                normalized_client,
                (
                    None
                    if resolved_role == "secondary"
                    else (valid_members[0] if valid_members else None)
                ),
                client_role=resolved_role,
            )
        elif entry is not None and client_role is not None:
            resolved_role = normalize_client_role(client_role)
            if entry.get("client_role") != resolved_role:
                sidecar.set_client_foreground(
                    normalized_client,
                    current,
                    client_role=resolved_role,
                    seeded_from_legacy=entry.get("seeded_from_legacy") is True,
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
        state = sidecar.read_editor_open_state()
        binding = registered_editor_renderer_binding(normalized_client)
        updated = (state.connect(binding.main_page_id).open_document(binding.main_page_id, normalized_file, binding.area)
                   if binding else state.admit_document(normalized_file))
        sidecar.set_editor_open_state(updated, expected_revision=state.revision)
        sidecar.record_document_activity(normalized_file)
        sidecar.set_client_foreground(normalized_client, normalized_file, client_role=binding.area if binding else None)
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
    client_role: ClientRole | None = None,
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
        sidecar.set_client_foreground(
            normalized_client,
            normalized_file,
            client_role=client_role,
        )
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
) -> tuple[bool, SidecarOpenStatePayload, list[ClientForegroundPayload]]:
    """Remove one shared document and return every affected client projection."""
    normalized_project = _normalize_path(project_path)
    normalized_file = _normalize_path(file_path)
    if require_existing_sidecar and not ProjectSidecar.sidecar_exists(normalized_project):
        raise FileNotFoundError("project_sidecar_missing")
    if not _is_under_project(normalized_project, normalized_file):
        raise PermissionError("outside_project")

    with _OPEN_STATE_LOCK:
        sidecar = ProjectSidecar.load_or_create(normalized_project)
        sidecar.reload()
        removed, changed_clients = sidecar.remove_recent_file(normalized_file)
        if removed:
            sidecar.save()
        open_state = _payload_from_sidecar(
            project_path=normalized_project,
            sidecar=sidecar,
            reason=str(reason),
        )
        affected = [
            _client_foreground_payload(
                project_path=normalized_project,
                sidecar=sidecar,
                client_instance_id=client_id,
                reason=str(reason),
            )
            for client_id in changed_clients
        ]
        return removed, open_state, affected


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
        sidecar.save()
        return _payload_from_sidecar(
            project_path=normalized_project,
            sidecar=sidecar,
            reason=str(reason),
        )
