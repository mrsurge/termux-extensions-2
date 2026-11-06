"""Worker-owned push completion intake, independent of Explorer connections."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from app.libs import pipe_runtime
from app.libs.pipe_protocol import PipeEnvelope
from .event_bus import current_project_generation
from .git_service import mark_status_cache_dirty
from ..explorer.services.runtime_notifications import schedule_git_status_update


@dataclass(frozen=True)
class PushCompletion:
    repository: str
    project: str
    generation: int | None


def parse_push_completion(envelope: PipeEnvelope) -> PushCompletion | None:
    if envelope.kind != "notification" or envelope.method != "git.job.progress":
        return None
    if not isinstance(envelope.params, dict):
        return None
    params = cast(dict[object, object], envelope.params)
    version = params.get("version")
    if (params.get("dto") != "GitJobProgress" or not isinstance(version, int) or isinstance(version, bool) or version != 1
            or params.get("type") != "git_push" or params.get("operation") != "push"
            or params.get("status") != "succeeded"):
        return None
    root = params.get("root")
    generation = params.get("projectGeneration")
    if not isinstance(root, str) or not root or not Path(root).is_absolute():
        return None
    if generation is not None and (not isinstance(generation, int) or isinstance(generation, bool) or generation < 0):
        return None
    if (envelope.project_generation is not None and generation is not None
            and envelope.project_generation != generation):
        return None
    project = envelope.workspace_root or root
    if not Path(project).is_absolute():
        return None
    repository = str(Path(root).resolve(strict=False))
    project = str(Path(project).resolve(strict=False))
    if not Path(project).is_relative_to(repository):
        return None
    return PushCompletion(repository, project,
                          generation if isinstance(generation, int) else envelope.project_generation)


def refresh_after_push(completion: PushCompletion) -> bool:
    # Even an inactive project's next snapshot must not reuse pre-push status.
    mark_status_cache_dirty(Path(completion.repository))
    if completion.project != completion.repository:
        mark_status_cache_dirty(Path(completion.project))
    if completion.generation is None or current_project_generation(completion.project) != completion.generation:
        return False
    schedule_git_status_update(completion.project, project_generation=completion.generation,
        source="git_push:completed", delay=0.0, require_connection=False)
    return True


class PushCompletionBridge:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.closed = False
        self.listener = pipe_runtime.add_notification_listener(self, methods={"git.job.progress"})

    def put_nowait(self, envelope: PipeEnvelope) -> None:
        # Runs on the pipe reader. Progress chatter never queues loop callbacks.
        completion = parse_push_completion(envelope)
        if completion is not None and not self.closed:
            self.loop.call_soon_threadsafe(self.deliver, completion)

    def deliver(self, completion: PushCompletion) -> None:
        if not self.closed:
            refresh_after_push(completion)

    def stop(self) -> None:
        self.closed = True
        pipe_runtime.remove_notification_listener(self.listener)


_bridge: PushCompletionBridge | None = None


def start_git_push_completion_bridge(loop: asyncio.AbstractEventLoop) -> None:
    global _bridge
    if _bridge is not None and not _bridge.closed and _bridge.loop is loop:
        return
    stop_git_push_completion_bridge()
    _bridge = PushCompletionBridge(loop)


def stop_git_push_completion_bridge() -> None:
    global _bridge
    if _bridge is not None:
        _bridge.stop()
        _bridge = None
