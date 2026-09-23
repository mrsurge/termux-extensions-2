# pyright: strict
from __future__ import annotations

from .worker_services.event_bus import WorkerEvent, subscribe as subscribe_worker_event

_registered = False


def register_textmate_projection_event_handlers() -> None:
    global _registered
    if _registered:
        return
    subscribe_worker_event("TextmateProjectionChanged", _project_textmate_revision)
    _registered = True


async def _project_textmate_revision(event: WorkerEvent) -> None:
    revision = event["payload"].get("revision")
    if not isinstance(revision, str) or not revision:
        return
    # One global extension registry is shared by every project/client. Publish
    # only its revision; each editor fetches one atomic catalog on its own lane.
    from .monaco_editor.editor_ws import editor_runtime_emit_room_event

    await editor_runtime_emit_room_event(
        "editor:textmate_projection_changed",
        {"revision": revision},
    )
