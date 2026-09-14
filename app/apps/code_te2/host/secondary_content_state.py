# pyright: strict
"""Secondary content ownership, independent of dock/window presentation.

This module performs no I/O. Existing atomic edit persistence owns working edits;
the host transition coordinator releases only the secondary foreground.
Keeping preparation separate means a failed blob read never clears a live view.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..worker_services.history_service import HistoryBlobPair


@dataclass(frozen=True)
class WorkingContent:
    path: str
    kind: Literal["workingFile"] = "workingFile"


@dataclass(frozen=True)
class HistoricalContent:
    snapshot_id: str
    pair: HistoryBlobPair
    kind: Literal["historicalDiff"] = "historicalDiff"


SecondaryContent = WorkingContent | HistoricalContent


@dataclass(frozen=True)
class ContentTransition:
    client_id: str
    project_path: str
    project_generation: int
    revision: int


@dataclass(frozen=True)
class ContentSnapshot:
    project_path: str
    project_generation: int
    revision: int
    content: SecondaryContent | None


@dataclass
class _Slot:
    snapshot: ContentSnapshot
    pending: ContentTransition | None = None


class SecondaryContentState:
    """Worker-local, bounded exact-client state; callers authenticate identities.

    Call only on the worker event loop. Disconnect does not imply close: native
    presentation reconnects to its retained snapshot. Explicit close/project
    cleanup invalidates pending work. Tokens use a monotonic owner-wide revision
    so deleting/recreating a client cannot revive an earlier request.
    """

    def __init__(self, capacity: int = 64) -> None:
        if capacity < 1:
            raise ValueError("secondary_content_capacity_invalid")
        self._capacity: int = capacity
        self._revision: int = 0
        self._slots: dict[str, _Slot] = {}

    def begin(
        self, client_id: str, client_role: str, project_path: str,
        project_generation: int,
    ) -> ContentTransition:
        if not client_id or not project_path or project_generation < 0:
            raise ValueError("secondary_content_identity_required")
        if client_role != "secondary":
            raise PermissionError("secondary_client_required")
        slot = self._slots.get(client_id)
        if slot is None and len(self._slots) >= self._capacity:
            raise RuntimeError("secondary_content_capacity_reached")
        self._revision += 1
        token = ContentTransition(client_id, project_path, project_generation, self._revision)
        # A project change cannot retain the former project's display descriptor.
        if slot is None or (
            slot.snapshot.project_path, slot.snapshot.project_generation
        ) != (project_path, project_generation):
            slot = _Slot(ContentSnapshot(project_path, project_generation, token.revision, None))
            self._slots[client_id] = slot
        slot.pending = token
        return token

    def is_current(self, token: ContentTransition) -> bool:
        slot = self._slots.get(token.client_id)
        return slot is not None and slot.pending == token

    def commit(self, token: ContentTransition, content: SecondaryContent) -> bool:
        if not self.is_current(token):
            return False
        slot = self._slots[token.client_id]
        slot.snapshot = ContentSnapshot(
            token.project_path, token.project_generation, token.revision, content,
        )
        slot.pending = None
        return True

    def abort(self, token: ContentTransition) -> None:
        if self.is_current(token):
            self._slots[token.client_id].pending = None

    def snapshot(
        self, client_id: str, project_path: str, project_generation: int,
    ) -> ContentSnapshot | None:
        slot = self._slots.get(client_id)
        if slot is None or (
            slot.snapshot.project_path, slot.snapshot.project_generation
        ) != (project_path, project_generation):
            return None
        return slot.snapshot

    def close(self, client_id: str) -> None:
        _ = self._slots.pop(client_id, None)

    def clear_project(self, project_path: str) -> None:
        for client_id, slot in tuple(self._slots.items()):
            if slot.snapshot.project_path == project_path:
                del self._slots[client_id]

    def clear(self) -> None:
        self._slots.clear()
