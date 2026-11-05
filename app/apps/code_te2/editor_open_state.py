"""Immutable S2 state foundation; not yet connected to live open/close RPCs.

Callers own project/path admission, authenticated logical-client binding and the
existing project transaction lock. A disconnect is deliberately not a mutation.
Foreground and focus remain in their existing presentation owners.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, cast

from .client_presentation import ClientRole, normalize_client_instance_id

MAX_EDITOR_PRESENTATIONS = 32


class StaleEditorOpenState(ValueError):
    pass


def _unique_paths(paths: tuple[str, ...]) -> None:
    if any(not path for path in paths) or len(set(paths)) != len(paths):
        raise ValueError("invalid_or_duplicate_document_path")


@dataclass(frozen=True)
class EditorPlacement:
    client_id: str
    primary: tuple[str, ...] = ()
    secondary: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if normalize_client_instance_id(self.client_id) != self.client_id:
            raise ValueError("invalid_client_instance_id")
        _unique_paths(self.primary)
        _unique_paths(self.secondary)

    def paths(self, area: ClientRole) -> tuple[str, ...]:
        if area == "primary":
            return self.primary
        if area == "secondary":
            return self.secondary
        raise ValueError("invalid_editor_area")

    def with_paths(self, area: ClientRole, paths: tuple[str, ...]) -> EditorPlacement:
        self.paths(area)  # Validate rather than treating unknown areas as secondary.
        return EditorPlacement(self.client_id,
                               paths if area == "primary" else self.primary,
                               paths if area == "secondary" else self.secondary)

    def without(self, path: str) -> EditorPlacement:
        return EditorPlacement(self.client_id,
                               tuple(item for item in self.primary if item != path),
                               tuple(item for item in self.secondary if item != path))


@dataclass(frozen=True)
class EditorOpenState:
    revision: int = 0
    documents: tuple[str, ...] = ()
    clients: tuple[EditorPlacement, ...] = ()

    def __post_init__(self) -> None:
        if isinstance(self.revision, bool) or self.revision < 0:
            raise ValueError("invalid_editor_open_revision")
        _unique_paths(self.documents)
        if len(self.clients) > MAX_EDITOR_PRESENTATIONS:
            raise ValueError("editor_presentation_capacity_reached")
        if len({client.client_id for client in self.clients}) != len(self.clients):
            raise ValueError("duplicate_editor_client")
        documents = set(self.documents)
        for client in self.clients:
            if set(client.primary) | set(client.secondary) != documents:
                raise ValueError("client_placement_must_cover_shared_documents")

    def placement(self, client_id: str) -> EditorPlacement:
        for client in self.clients:
            if client.client_id == client_id:
                return client
        raise ValueError("editor_client_not_attached")

    def connect(self, client_id: str) -> EditorOpenState:
        """Restore known placement; default unknown placement to primary."""
        if any(client.client_id == client_id for client in self.clients):
            return self
        return EditorOpenState(self.revision + 1, self.documents,
                               (*self.clients, EditorPlacement(client_id, self.documents)))

    def open_document(self, client_id: str, path: str, area: ClientRole) -> EditorOpenState:
        """An explicit secondary open never invents a local primary tab."""
        _unique_paths((path,))
        initiating = self.placement(client_id)
        paths = initiating.paths(area)
        if path in paths:
            return self
        admitted = path in self.documents
        clients: list[EditorPlacement] = []
        for client in self.clients:
            if client.client_id == client_id:
                clients.append(client.with_paths(area, (*paths, path)))
            elif not admitted:
                clients.append(client.with_paths("primary", (*client.primary, path)))
            else:
                clients.append(client)
        return EditorOpenState(self.revision + 1,
                               self.documents if admitted else (*self.documents, path),
                               tuple(clients))

    def admit_document(self, path: str) -> EditorOpenState:
        """Backend project-open admission without an initiating presentation."""
        _unique_paths((path,))
        if path in self.documents:
            return self
        return EditorOpenState(self.revision + 1, (*self.documents, path), tuple(
            client.with_paths("primary", (*client.primary, path)) for client in self.clients
        ))

    def recover_secondary_to_primary(self, client_id: str) -> EditorOpenState:
        """Rehome orphaned presentations without reopening or closing documents."""
        client = self.placement(client_id)
        if not client.secondary:
            return self
        primary = (*client.primary, *(path for path in client.secondary if path not in client.primary))
        repaired = EditorPlacement(client_id, primary, ())
        return EditorOpenState(self.revision + 1, self.documents,
            tuple(repaired if item.client_id == client_id else item for item in self.clients))

    def close_presentation(
        self, client_id: str, path: str, area: ClientRole, *, expected_revision: int,
    ) -> EditorCloseResult:
        """Last-local close is global, irrespective of other clients' counts."""
        self.require_revision(expected_revision)
        initiating = self.placement(client_id)
        if path not in initiating.paths(area):
            raise ValueError("editor_presentation_not_open")
        updated = initiating.with_paths(area, tuple(item for item in initiating.paths(area) if item != path))
        if path in updated.primary or path in updated.secondary:
            clients = tuple(updated if client.client_id == client_id else client for client in self.clients)
            return EditorCloseResult("presentation", EditorOpenState(self.revision + 1, self.documents, clients))
        return EditorCloseResult("document", self.close_document(path, expected_revision=expected_revision))

    def close_document(self, path: str, *, expected_revision: int) -> EditorOpenState:
        """Pure state transition, not save consent or a WBA disposal operation."""
        self.require_revision(expected_revision)
        if path not in self.documents:
            raise ValueError("editor_document_not_open")
        return EditorOpenState(self.revision + 1,
                               tuple(item for item in self.documents if item != path),
                               tuple(client.without(path) for client in self.clients))

    def require_revision(self, revision: int) -> None:
        if isinstance(revision, bool) or revision != self.revision:
            raise StaleEditorOpenState("editor_open_state_stale")

    def to_data(self) -> dict[str, object]:
        clients: list[dict[str, object]] = [
            {"clientId": client.client_id, "primary": list(client.primary), "secondary": list(client.secondary)}
            for client in self.clients
        ]
        return {"schemaVersion": 1, "revision": self.revision,
                "documents": list(self.documents), "clients": clients}

    @classmethod
    def from_data(cls, raw: object) -> EditorOpenState:
        """Validate persisted JSON without accepting arbitrary Python objects."""
        record = _record(raw)
        if set(record) != {"schemaVersion", "revision", "documents", "clients"}:
            raise ValueError("invalid_editor_open_fields")
        schema, revision = record["schemaVersion"], record["revision"]
        if type(schema) is not int or schema != 1:
            raise ValueError("unsupported_editor_open_schema")
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise ValueError("invalid_editor_open_revision")
        clients: list[EditorPlacement] = []
        for value in _items(record["clients"]):
            client = _record(value)
            if set(client) != {"clientId", "primary", "secondary"}:
                raise ValueError("invalid_editor_placement_fields")
            client_id = client["clientId"]
            if not isinstance(client_id, str):
                raise ValueError("invalid_client_instance_id")
            clients.append(EditorPlacement(client_id, _paths(client["primary"]), _paths(client["secondary"])))
        return cls(revision, _paths(record["documents"]), tuple(clients))


@dataclass(frozen=True)
class EditorCloseResult:
    kind: Literal["presentation", "document"]
    state: EditorOpenState


def _record(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        raise ValueError("editor_open_object_required")
    record: dict[str, object] = {}
    for key, value in cast(dict[object, object], raw).items():
        if not isinstance(key, str):
            raise ValueError("editor_open_string_key_required")
        record[key] = value
    return record


def _items(raw: object) -> list[object]:
    if not isinstance(raw, list):
        raise ValueError("editor_open_array_required")
    return cast(list[object], raw)


def _paths(raw: object) -> tuple[str, ...]:
    paths: list[str] = []
    for value in _items(raw):
        if not isinstance(value, str):
            raise ValueError("editor_open_path_required")
        paths.append(value)
    return tuple(paths)
