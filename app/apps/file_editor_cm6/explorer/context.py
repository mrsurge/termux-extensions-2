# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

EmitPersonal = Callable[[str, dict[str, object], str | None], Awaitable[None]]
AsyncNoArg = Callable[[], Awaitable[None]]
NotifyDraftCleared = Callable[[list[str]], Awaitable[None]]
MarkProjectDirty = Callable[[Path], None]


@dataclass(frozen=True)
class ExplorerSearchReviewHandlerContext:
    project_root: Path
    emit_personal: EmitPersonal
    broadcast_git_status: AsyncNoArg
    broadcast_review_state: AsyncNoArg
    notify_editor_draft_cleared: NotifyDraftCleared
    mark_draft_cache_dirty: MarkProjectDirty
    mark_git_cache_dirty: MarkProjectDirty

