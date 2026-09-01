# pyright: strict
from __future__ import annotations

from pathlib import Path
from typing import TypedDict

from ...worker_services.event_bus import (
    EventType,
    build_event,
    current_project_generation,
    publish as publish_worker_event,
)

JsonObject = dict[str, object]

# Explorer fact publishers. Handlers call these after mutating backend state;
# render-state is the only Explorer lane projector for these state transitions.


class DraftStatePayload(TypedDict):
    drafts: JsonObject


class ExplorerRenderDirectoriesPayload(TypedDict):
    reason: str
    directories: list[str]


class ExplorerOpenDirectoriesPayload(TypedDict):
    reason: str
    directories: list[str]
    open_directories: list[str]
    open_directories_changed: bool


class GitDiffBasePayload(TypedDict):
    ref: str
    refresh: bool


class GitPathRestoredPayload(TypedDict):
    path: str


class PreferencesChangedPayload(TypedDict):
    ui: JsonObject


class ReviewStatePayload(TypedDict):
    entries: list[JsonObject]


class SearchHighlightPayload(TypedDict):
    clientInstanceId: str
    active: bool
    query: str
    isRegex: bool
    isCaseSensitive: bool
    isWholeWords: bool
    reason: str
    source: str


class WatcherConfigChangedPayload(TypedDict, total=False):
    config: JsonObject
    mode: str
    mode_status: JsonObject


async def publish_draft_state_changed(
    project_root: str | Path,
    payload: DraftStatePayload,
    *,
    source: str,
) -> None:
    await _publish_project_fact(
        "DraftStateChanged",
        project_root,
        source=source,
        payload=dict(payload),
    )


async def publish_explorer_directories_changed(
    project_root: str | Path,
    directories: list[str],
    *,
    reason: str,
    source: str,
) -> None:
    payload: ExplorerRenderDirectoriesPayload = {
        "reason": reason,
        "directories": _dedupe_nonempty(directories),
    }
    await _publish_project_fact(
        "ExplorerRenderStateChanged",
        project_root,
        source=source,
        payload=dict(payload),
    )


async def publish_explorer_open_directories_changed(
    project_root: str | Path,
    open_directories: list[str],
    *,
    reason: str,
    source: str,
) -> None:
    directories = _dedupe_nonempty(open_directories)
    payload: ExplorerOpenDirectoriesPayload = {
        "reason": reason,
        "directories": directories,
        "open_directories": directories,
        "open_directories_changed": True,
    }
    await _publish_project_fact(
        "ExplorerRenderStateChanged",
        project_root,
        source=source,
        payload=dict(payload),
    )


async def publish_git_diff_base_changed(
    project_root: str | Path,
    *,
    ref: str,
    refresh: bool,
    source: str,
) -> None:
    payload: GitDiffBasePayload = {"ref": ref, "refresh": refresh}
    await _publish_project_fact(
        "GitDiffBaseChanged",
        project_root,
        source=source,
        payload=dict(payload),
    )


async def publish_git_path_restored(
    project_root: str | Path,
    *,
    path: str,
    source: str,
) -> None:
    payload: GitPathRestoredPayload = {"path": path}
    await _publish_project_fact(
        "GitPathRestored",
        project_root,
        source=source,
        payload=dict(payload),
    )


async def publish_preferences_changed(
    *,
    ui: JsonObject,
    source: str,
) -> None:
    payload: PreferencesChangedPayload = {"ui": dict(ui)}
    await publish_worker_event(
        build_event(
            "PreferencesChanged",
            project_root=None,
            source=source,
            payload=dict(payload),
        )
    )


async def publish_review_state_changed(
    project_root: str | Path,
    payload: ReviewStatePayload,
    *,
    source: str,
) -> None:
    await _publish_project_fact(
        "ReviewStateChanged",
        project_root,
        source=source,
        payload=dict(payload),
    )


async def publish_search_highlight_changed(
    project_root: str | Path,
    payload: SearchHighlightPayload,
    *,
    source: str,
) -> None:
    await _publish_project_fact(
        "SearchHighlightChanged",
        project_root,
        source=source,
        payload=dict(payload),
    )


async def publish_watcher_config_changed(
    project_root: str | Path,
    payload: WatcherConfigChangedPayload,
    *,
    source: str,
) -> None:
    await _publish_project_fact(
        "WatcherConfigChanged",
        project_root,
        source=source,
        payload=dict(payload),
    )


async def publish_watcher_error_raised(
    project_root: str | Path,
    payload: JsonObject,
    *,
    source: str,
) -> None:
    await _publish_project_fact(
        "WatcherErrorRaised",
        project_root,
        source=source,
        payload={"error": dict(payload)},
    )


async def _publish_project_fact(
    event_type: EventType,
    project_root: str | Path,
    *,
    source: str,
    payload: JsonObject,
) -> None:
    normalized_project = _normalize_project_path(project_root)
    await publish_worker_event(
        build_event(
            event_type,
            project_root=normalized_project,
            project_generation=current_project_generation(normalized_project),
            source=source,
            payload=payload,
        )
    )


def _normalize_project_path(project_root: str | Path) -> str:
    return str(Path(project_root).expanduser().resolve(strict=False))


def _dedupe_nonempty(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result
