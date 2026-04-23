# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from ..explorer_manager import ExplorerConnection


class EmitPersonal(Protocol):
    async def __call__(
        self,
        message_type: str,
        payload: dict[str, object],
        reply_to: str | None = None,
    ) -> None: ...


class AsyncNoArg(Protocol):
    async def __call__(self) -> None: ...


class Broadcast(Protocol):
    async def __call__(
        self,
        message_type: str,
        payload: dict[str, object],
    ) -> None: ...


class NotifyDraftCleared(Protocol):
    async def __call__(self, rel_files: list[str]) -> None: ...


class MarkProjectDirty(Protocol):
    def __call__(self, project_root: Path) -> None: ...


@dataclass(frozen=True)
class ExplorerSearchReviewHandlerContext:
    project_root: Path
    emit_personal: EmitPersonal
    broadcast_git_status: AsyncNoArg
    broadcast_review_state: AsyncNoArg
    notify_editor_draft_cleared: NotifyDraftCleared
    mark_draft_cache_dirty: MarkProjectDirty
    mark_git_cache_dirty: MarkProjectDirty


@dataclass(frozen=True)
class ExplorerWatcherHandlerContext:
    project_root: Path
    emit_personal: EmitPersonal
    broadcast: Broadcast


@dataclass(frozen=True)
class ExplorerFileTreeHandlerContext:
    project_root: Path
    broadcast: Broadcast
    broadcast_git_status: AsyncNoArg
    broadcast_git_decorations: AsyncNoArg


@dataclass(frozen=True)
class ExplorerGitHandlerContext:
    project_root: Path
    tracked_job_ids: set[str]
    emit_personal: EmitPersonal
    broadcast: Broadcast
    broadcast_git_status: AsyncNoArg
    broadcast_git_decorations: AsyncNoArg


@dataclass(frozen=True)
class ExplorerProjectHandlerContext:
    websocket: ExplorerConnection
    tracked_job_ids: set[str]
    emit_personal: EmitPersonal


@dataclass(frozen=True)
class ExplorerSessionHandlerContext:
    project_root: Path
    emit_personal: EmitPersonal
    broadcast: Broadcast
    broadcast_git_status: AsyncNoArg
    broadcast_review_state: AsyncNoArg


@dataclass(frozen=True)
class ExplorerIntegrationHandlerContext:
    emit_personal: EmitPersonal
    broadcast: Broadcast


@dataclass(frozen=True)
class ExplorerPrefsHandlerContext:
    emit_personal: EmitPersonal
    broadcast: Broadcast


@dataclass(frozen=True)
class ExplorerExtensionHandlerContext:
    project_root: Path
    emit_personal: EmitPersonal
