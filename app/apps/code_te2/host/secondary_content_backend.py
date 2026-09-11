# pyright: strict
"""Host-owned historical content, outside working-document membership.

Only trusted backend orchestration supplies a validated immutable History pair.
No arbitrary client text, save, draft discard or membership mutation lives here.
The activation caller publishes the returned foreground fact after this commit.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..client_presentation import normalize_client_instance_id
from ..open_state_backend import (
    ClientForegroundPayload, SidecarOpenStatePayload,
    read_sidecar_open_state, write_client_foreground,
)
from ..stores import get_history_store
from ..worker_services import event_bus
from ..worker_services.history_service import HistoryBlobSide
from .secondary_content_state import (
    ContentTransition, HistoricalContent, SecondaryContentState,
)

HISTORICAL_REASON = "secondary_historical_content"
_state = SecondaryContentState()
_foreground_revisions: dict[str, int] = {}
_subscribed = False


@dataclass(frozen=True)
class HistoricalActivation:
    open_state: SidecarOpenStatePayload
    foreground: ClientForegroundPayload
    project_generation: int


async def _on_project_switch(_event: event_bus.WorkerEvent) -> None:
    # ProjectSwitchStarted names the NEW root, so clear every prior partition.
    _state.clear()
    _foreground_revisions.clear()


def _ensure_subscription() -> None:
    global _subscribed
    if not _subscribed:
        event_bus.subscribe("ProjectSwitchStarted", _on_project_switch)
        _subscribed = True


def begin_historical_content(client_id: str, client_role: str) -> ContentTransition:
    if normalize_client_instance_id(client_id) != client_id:
        raise ValueError("client_identity_required")
    project = get_history_store().get_active_project()
    if not project:
        raise RuntimeError("active_project_missing")
    generation = event_bus.current_project_generation(project)
    if generation is None:
        raise RuntimeError("project_generation_missing")
    _ensure_subscription()
    return _state.begin(client_id, client_role, project, generation)


def abort_historical_content(token: ContentTransition) -> None:
    _state.abort(token)


def commit_historical_content(
    token: ContentTransition, content: HistoricalContent,
) -> HistoricalActivation | None:
    if (
        not _state.is_current(token)
        or get_history_store().get_active_project() != token.project_path
        or event_bus.current_project_generation(token.project_path) != token.project_generation
    ):
        return None
    # No await between the foreground mutation and descriptor commit. Edits are
    # already persisted by their ordinary path; do not save or discard them here.
    foreground = write_client_foreground(
        token.project_path, None, token.client_id,
        reason=HISTORICAL_REASON, client_role="secondary",
    )
    committed = _state.commit(token, content)
    assert committed
    _foreground_revisions[token.client_id] = foreground["revision"]
    return HistoricalActivation(
        read_sidecar_open_state(token.project_path, reason=HISTORICAL_REASON),
        foreground, token.project_generation,
    )


def close_secondary_content(client_id: str) -> None:
    _state.close(client_id)
    _ = _foreground_revisions.pop(client_id, None)


def reconcile_secondary_foreground(foreground: ClientForegroundPayload) -> None:
    # Queued working-file facts may precede the historical commit. They must not
    # erase the newly committed content when the event bus catches up.
    retained_revision = _foreground_revisions.get(foreground["clientInstanceId"])
    if retained_revision is not None and foreground["revision"] <= retained_revision:
        return
    if foreground["reason"] != HISTORICAL_REASON:
        close_secondary_content(foreground["clientInstanceId"])


def _side_payload(side: HistoryBlobSide) -> dict[str, object]:
    return {"state": side.state, "path": side.path, "id": side.identity, "text": side.text}


def secondary_content_projection(
    client_id: str, client_role: str, project: str, working_path: str | None,
) -> dict[str, object] | None:
    """Called on the event loop after off-loop boot snapshot construction."""
    if client_role != "secondary":
        return None
    if working_path:
        # A working open may have committed before its queued fact is projected;
        # rendering a snapshot must not mutate ownership from an off-loop read.
        return None
    generation = event_bus.current_project_generation(project)
    if generation is None:
        return None
    snapshot = _state.snapshot(client_id, project, generation)
    if snapshot is None or not isinstance(snapshot.content, HistoricalContent):
        return None
    content = snapshot.content
    pair = content.pair
    return {
        "kind": "historicalDiff", "revision": snapshot.revision,
        "projectPath": snapshot.project_path, "projectGeneration": snapshot.project_generation,
        "snapshotId": content.snapshot_id, "commitId": pair.commit_id,
        "parentId": pair.parent_id, "fileIndex": pair.index,
        "original": _side_payload(pair.original), "modified": _side_payload(pair.modified),
    }
