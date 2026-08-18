# pyright: strict
from __future__ import annotations

import asyncio
import sys
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Protocol, cast

from .protocols import EditorLike

JsonMap = dict[str, object]


class HistoryStoreLike(Protocol):
    def get_cached_document(self, project_path: str, file_path: str) -> dict[str, object] | None: ...
    def clear_cached_document(self, project_path: str, file_path: str) -> bool: ...
    def get_active_project(self) -> str | None: ...
    def get_document_revision(self, project_path: str, file_path: str) -> int: ...


class PreferencesStoreLike(Protocol):
    def get_preferences(self) -> dict[str, object]: ...


class BroadcastCacheStateFn(Protocol):
    def __call__(
        self,
        project_path: str | None,
        file_path: str | None,
        *,
        state: str,
        unsaved: bool,
        cache_entry: dict[str, object] | None = None,
        reason: str = "update",
    ) -> None: ...


def build_cache_state_payload(
    project_path: str | None,
    file_path: str | None,
    *,
    state: str,
    unsaved: bool,
    cache_entry: dict[str, object] | None,
    reason: str,
    preferences_store: PreferencesStoreLike,
    normalize_rel_path: Callable[[Path, str], str],
) -> JsonMap:
    resolved_path = str(file_path) if file_path else ""
    project_path = str(project_path) if project_path else None
    file_label = Path(resolved_path).name if resolved_path else "Untitled"
    directory = str(Path(resolved_path).parent) if resolved_path else ""
    rel_path: str | None = None
    if project_path and resolved_path:
        try:
            rel_path = normalize_rel_path(Path(project_path).expanduser(), resolved_path)
        except Exception:
            rel_path = None

    auto_save_enabled: bool | None
    try:
        editor_prefs_obj = preferences_store.get_preferences().get("editor", {})
        editor_prefs = cast(dict[str, object], editor_prefs_obj if isinstance(editor_prefs_obj, dict) else {})
        auto_save_enabled = bool(editor_prefs.get("autoSave", False))
    except Exception:
        auto_save_enabled = None

    payload: JsonMap = {
        "path": resolved_path or None,
        "project_path": project_path,
        "relative_path": rel_path,
        "file_label": file_label,
        "directory_label": rel_path or directory or None,
        "absolute_directory": directory or None,
        "state": state,
        "unsaved": bool(unsaved),
        "auto_save": auto_save_enabled,
        "reason": reason,
        "updated_at": (cache_entry or {}).get("updated_at"),
        "timestamp": time.time(),
        "content_sha256": (cache_entry or {}).get("content_sha256"),
        "base_sha256": (cache_entry or {}).get("base_sha256"),
        "run_id": (cache_entry or {}).get("run_id"),
        "shell_id": (cache_entry or {}).get("shell_id"),
        "shell_run_id": (cache_entry or {}).get("shell_run_id"),
        "document_revision": (cache_entry or {}).get("document_revision"),
    }
    return {key: value for key, value in payload.items() if value is not None}


def broadcast_cache_state(
    project_path: str | None,
    file_path: str | None,
    *,
    state: str,
    unsaved: bool,
    cache_entry: dict[str, object] | None,
    reason: str,
    preferences_store: PreferencesStoreLike,
    normalize_rel_path: Callable[[Path, str], str],
    get_active_editors: Callable[[], list[EditorLike]],
) -> None:
    editors = get_active_editors()
    if not editors or not file_path:
        return
    payload = build_cache_state_payload(
        project_path,
        file_path,
        state=state,
        unsaved=unsaved,
        cache_entry=cache_entry,
        reason=reason,
        preferences_store=preferences_store,
        normalize_rel_path=normalize_rel_path,
    )
    for editor in editors:
        try:
            editor.run_method("emitCacheState", payload)
        except Exception as exc:
            print(f"[SESSION_CACHE] Failed to emit cache state: {exc}", file=sys.stderr)


def apply_watcher_replace(
    *,
    path: str,
    content: str,
    sha256: str | None,
    project_path: str | None,
    reason: str,
    get_active_editors: Callable[[], list[EditorLike]],
    get_active_editor: Callable[[], EditorLike | None],
    get_cached_editor_content: Callable[[EditorLike | None], str],
    set_current_file: Callable[[str, str | None], None],
    history_store: HistoryStoreLike,
    notify_draft_state_changed: Callable[[str], None],
    broadcast_cache_state_fn: BroadcastCacheStateFn,
) -> bool:
    editors = get_active_editors()
    if not editors or not path:
        return False

    cache_entry: dict[str, object] | None = None
    external_change = False
    if project_path:
        cache_entry = history_store.get_cached_document(project_path, path)
        if cache_entry and cache_entry.get("unsaved"):
            base_sha_obj = cache_entry.get("base_sha256")
            base_sha = base_sha_obj if isinstance(base_sha_obj, str) else None
            if base_sha and sha256 and base_sha == sha256:
                print(f"[SESSION_CACHE] Ignoring watcher event for {path}; disk matches draft base", file=sys.stderr)
                return False
            if base_sha and sha256 and base_sha != sha256:
                print(
                    f"[SESSION_CACHE] External edit detected for {path} (base={base_sha} disk={sha256}); clearing cached draft",
                    file=sys.stderr,
                )
                history_store.clear_cached_document(project_path, path)
                cache_entry = None
                external_change = True
                try:
                    notify_draft_state_changed(project_path)
                except Exception as exc:
                    print(f"[WATCHER] Failed to notify explorer of draft change: {exc}", file=sys.stderr)

    try:
        same = get_cached_editor_content(get_active_editor()) == content
        if same:
            return False
    except Exception:
        pass

    for editor in editors:
        try:
            editor.set_value(content)
            setattr(editor, "_cached_content", content)
        except Exception as exc:
            print(f"[WATCHER] Failed to apply content to editor: {exc}", file=sys.stderr)
    set_current_file(path, sha256)

    broadcast_cache_state_fn(
        project_path,
        path,
        state="clean",
        unsaved=False,
        cache_entry=cache_entry,
        reason="watcher_external" if external_change else reason,
    )
    if external_change:
        for editor in editors:
            try:
                editor.set_diff_decorations([])
            except Exception as exc:
                print(f"[DIFF] Failed to clear decorations after external edit: {exc}", file=sys.stderr)
    return True


def get_combined_diffs(
    project_root: Path,
    file_path: str,
    current_content: str,
    *,
    preferences_store: PreferencesStoreLike,
    normalize_rel_path: Callable[[Path, str], str],
    current_diff_base: Callable[[str | None], str],
    collect_diff: Callable[[Path, str, str], dict[str, object]],
    compute_draft_diff: Callable[[str, str, str], dict[str, object]],
) -> list[object]:
    hunks: list[object] = []
    editor_prefs_obj = preferences_store.get_preferences().get("editor", {})
    prefs = cast(dict[str, object], editor_prefs_obj if isinstance(editor_prefs_obj, dict) else {})

    show_draft_diffs = not bool(prefs.get("autoSave", False)) and bool(prefs.get("showDraftDiffs", True))
    show_commit_diffs = bool(prefs.get("showInlineDiffs", False)) and not show_draft_diffs

    if show_commit_diffs:
        try:
            rel = normalize_rel_path(project_root, file_path)
            diff_data = collect_diff(project_root, rel, current_diff_base(str(project_root)))
            diff_hunks = diff_data.get("hunks", [])
            if isinstance(diff_hunks, list):
                hunks.extend(cast(list[object], diff_hunks))
        except Exception as exc:
            print(f"[DIFF_HELPER] Failed to collect git diffs: {exc}", file=sys.stderr)

    if show_draft_diffs:
        try:
            if Path(file_path).exists():
                disk_content = Path(file_path).read_text(encoding="utf-8", errors="replace")
                diff_data = compute_draft_diff(file_path, current_content, disk_content)
                diff_hunks = diff_data.get("hunks", [])
                if isinstance(diff_hunks, list):
                    hunks.extend(cast(list[object], diff_hunks))
        except Exception as exc:
            print(f"[DIFF_HELPER] Failed to compute draft diffs: {exc}", file=sys.stderr)
    return hunks


async def get_combined_diffs_async(
    project_root: Path,
    file_path: str,
    current_content: str,
    *,
    preferences_store: PreferencesStoreLike,
    normalize_rel_path: Callable[[Path, str], str],
    current_diff_base: Callable[[str | None], str],
    collect_diff: Callable[[Path, str, str], dict[str, object]],
    compute_draft_diff: Callable[[str, str, str], dict[str, object]],
) -> list[object]:
    return await asyncio.to_thread(
        lambda: get_combined_diffs(
            project_root,
            file_path,
            current_content,
            preferences_store=preferences_store,
            normalize_rel_path=normalize_rel_path,
            current_diff_base=current_diff_base,
            collect_diff=collect_diff,
            compute_draft_diff=compute_draft_diff,
        )
    )


def schedule_diff_refresh(
    project_root: Path,
    file_path: str,
    current_content: str,
    editor: EditorLike | None,
    reason: str,
    *,
    get_running_loop: Callable[[], asyncio.AbstractEventLoop],
    get_active_editors: Callable[[], list[EditorLike]],
    get_combined_diffs_async_fn: Callable[[Path, str, str], Awaitable[list[object]]],
) -> None:
    async def _run() -> None:
        try:
            hunks = await get_combined_diffs_async_fn(project_root, file_path, current_content)
            for ed in get_active_editors():
                try:
                    ed.set_diff_decorations(hunks)
                except Exception:
                    pass
        except Exception as exc:
            print(f"[DIFF_REFRESH][{reason}] Failed: {exc}", file=sys.stderr)

    try:
        loop = get_running_loop()
    except RuntimeError:
        loop = None
    if loop and loop.is_running():
        loop.create_task(_run())
        return
    print(f"[DIFF_REFRESH][{reason}] Schedule skipped: no running event loop", file=sys.stderr)
