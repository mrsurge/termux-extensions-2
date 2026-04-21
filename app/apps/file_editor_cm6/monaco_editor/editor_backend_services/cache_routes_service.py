# pyright: strict
from __future__ import annotations

import asyncio
import hashlib
import sys
import time
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from .protocols import EditorLike

JsonMap = dict[str, object]


class HistoryStoreLike(Protocol):
    def get_active_project(self) -> str | None: ...
    def get_cached_document(self, project_path: str, file_path: str) -> dict[str, object] | None: ...
    def clear_cached_document(self, project_path: str, file_path: str) -> bool: ...


class PreferencesStoreLike(Protocol):
    def get_preferences(self) -> dict[str, object]: ...


class RuntimeMetaProvider(Protocol):
    def __call__(self) -> Mapping[str, object]: ...


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


class ScheduleDiffRefreshFn(Protocol):
    def __call__(
        self,
        project_root: Path,
        file_path: str,
        current_content: str,
        editor: EditorLike | None,
        reason: str,
    ) -> None: ...


class ApplyWatcherReplaceFn(Protocol):
    def __call__(
        self,
        *,
        path: str,
        content: str,
        sha256: str | None,
        project_path: str | None,
        reason: str = "watcher_replace",
    ) -> bool: ...


class CombinedDiffsAsyncFn(Protocol):
    def __call__(self, project_root: Path, file_path: str, current_content: str) -> Awaitable[list[object]]: ...


class CurrentDiffBaseFn(Protocol):
    def __call__(self, project_path: str | None) -> str: ...


class NormalizeRelPathFn(Protocol):
    def __call__(self, project_root: Path, raw_path: str) -> str: ...


class CollectDiffFn(Protocol):
    def __call__(self, project_root: Path, rel_path: str, base_ref: str) -> dict[str, object]: ...


def _dict_get_str(data: Mapping[str, object], key: str, default: str = "") -> str:
    value = data.get(key, default)
    return value if isinstance(value, str) else default


async def handle_discard_draft(
    data: Mapping[str, object],
    *,
    history_store: HistoryStoreLike,
    get_current_file: Callable[[], str | None],
    notify_draft_state_changed: Callable[[str], None],
    broadcast_cache_state: BroadcastCacheStateFn,
) -> JsonMap:
    path = _dict_get_str(data, "path", "")
    project_path = history_store.get_active_project()
    if not path or not project_path:
        return {"ok": False, "error": "No active document"}

    cleared = history_store.clear_cached_document(project_path, path)
    if cleared:
        try:
            notify_draft_state_changed(project_path)
        except Exception as exc:
            print(f"[DISCARD] Failed to notify explorer of draft change: {exc}", file=sys.stderr)

    if cleared and path == get_current_file():
        broadcast_cache_state(
            project_path,
            path,
            state="clean",
            unsaved=False,
            reason="discard",
        )
    return {"ok": True, "data": {"cleared": cleared}}


async def handle_refresh_cache_state(
    *,
    history_store: HistoryStoreLike,
    get_current_file: Callable[[], str | None],
    runtime_meta: RuntimeMetaProvider,
    get_active_editors: Callable[[], list[EditorLike]],
    broadcast_cache_state: BroadcastCacheStateFn,
) -> JsonMap:
    project_path = history_store.get_active_project()
    current_file = get_current_file()
    if not project_path or not current_file:
        return {"ok": True}

    cached_entry = history_store.get_cached_document(project_path, current_file)
    if not cached_entry:
        return {"ok": True}

    unsaved = bool(cached_entry.get("unsaved", False))
    if not unsaved:
        broadcast_cache_state(
            project_path,
            current_file,
            state="clean",
            unsaved=False,
            cache_entry=cached_entry,
            reason="restore_clean",
        )
        return {"ok": True}

    meta = runtime_meta()
    cached_run_obj = cached_entry.get("run_id", "unknown")
    current_run_obj = meta.get("run_id", "unknown")
    cached_run = cached_run_obj if isinstance(cached_run_obj, str) else "unknown"
    current_run = current_run_obj if isinstance(current_run_obj, str) else "unknown"
    state = "mid_session" if cached_run == current_run else "crashed"

    broadcast_cache_state(
        project_path,
        current_file,
        state=state,
        unsaved=True,
        cache_entry=cached_entry,
        reason="restore",
    )

    if state in ("crashed", "mid_session"):
        for editor in get_active_editors():
            try:
                editor.notify_parent(
                    "draft_state",
                    {
                        "has_draft": True,
                        "path": current_file,
                    },
                )
            except Exception:
                pass
    return {"ok": True}


async def handle_check_cache(
    data: Mapping[str, object],
    *,
    history_store: HistoryStoreLike,
) -> JsonMap:
    path = _dict_get_str(data, "path", "")
    if not path:
        return {"ok": False, "error": "No path provided"}

    project_path = history_store.get_active_project()
    if not project_path:
        return {"ok": True, "has_draft": False}

    cache_entry = history_store.get_cached_document(project_path, path)
    print(
        f"[CHECK_CACHE] Checking {path} -> Found: {bool(cache_entry)}, Unsaved: {cache_entry.get('unsaved') if cache_entry else 'N/A'}",
        file=sys.stderr,
    )
    if cache_entry and cache_entry.get("unsaved"):
        return {
            "ok": True,
            "has_draft": True,
            "content": cache_entry.get("content", ""),
            "base_sha256": cache_entry.get("base_sha256"),
        }
    return {"ok": True, "has_draft": False}


async def handle_set_editor_content(
    data: Mapping[str, object],
    *,
    history_store: HistoryStoreLike,
    preferences_store: PreferencesStoreLike,
    get_active_editor: Callable[[], EditorLike | None],
    get_active_editors: Callable[[], list[EditorLike]],
    get_current_file: Callable[[], str | None],
    set_current_file: Callable[[str, str | None], None],
    persist_active_draft_immediately: Callable[[str], bool],
    cancel_cache_persist_timer: Callable[[], None],
    get_cached_editor_content: Callable[[EditorLike | None], str],
    set_suppress_on_change_until: Callable[[float], None],
    broadcast_cache_state: BroadcastCacheStateFn,
    schedule_diff_refresh: ScheduleDiffRefreshFn,
    apply_watcher_replace: ApplyWatcherReplaceFn,
    current_diff_base: CurrentDiffBaseFn,
    normalize_rel_path: NormalizeRelPathFn,
    collect_diff: CollectDiffFn,
    get_combined_diffs_async: CombinedDiffsAsyncFn,
    resolve_font_scale: Callable[[object | None], float],
    get_project_root: Callable[[], Path],
    init_watcher: Callable[[Path], object],
    subscribe: Callable[[str, str, Callable[[dict[str, object]], None]], object],
    unsubscribe: Callable[[object], None],
    get_watcher_token: Callable[[], object | None],
    set_watcher_token: Callable[[object | None], None],
) -> JsonMap:
    editors = get_active_editors()
    editor = get_active_editor()
    if not editors or not editor:
        return {"ok": False, "error": "Editor not ready"}

    new_path = _dict_get_str(data, "path", "")
    old_path_obj = get_current_file()
    old_path = old_path_obj if isinstance(old_path_obj, str) else ""
    project_path = history_store.get_active_project()
    has_draft = bool(data.get("has_draft", False))

    print(f"[SET_CONTENT] path={new_path!r} old={old_path!r}", file=sys.stderr)
    if old_path and old_path != new_path:
        persist_active_draft_immediately("switch")
    cancel_cache_persist_timer()

    content_obj = data.get("content")
    content = content_obj if isinstance(content_obj, str) else ""
    language_obj = data.get("language", "python")
    language = language_obj if isinstance(language_obj, str) else "python"
    content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()

    cache_entry: dict[str, object] | None = None
    if project_path and new_path:
        cache_entry = history_store.get_cached_document(project_path, new_path)

    if cache_entry and cache_entry.get("unsaved"):
        cached_base_obj = cache_entry.get("base_sha256")
        cached_base = cached_base_obj if isinstance(cached_base_obj, str) else None
        if cached_base and content_sha256 == cached_base:
            print(f"[SET_CONTENT] SAFEGUARD: Overriding disk content with cached draft for {new_path}", file=sys.stderr)
            cached_content_obj = cache_entry.get("content", "")
            content = cached_content_obj if isinstance(cached_content_obj, str) else ""
            content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
            has_draft = True

    provided_base_obj = data.get("sha256")
    provided_base = provided_base_obj if isinstance(provided_base_obj, str) else None
    cached_base_obj = cache_entry.get("base_sha256") if cache_entry else None
    cached_base = cached_base_obj if isinstance(cached_base_obj, str) else None

    print(
        f"[SET_CONTENT] SHAs: provided={provided_base} cached_base={cached_base} content_sha={content_sha256}",
        file=sys.stderr,
    )
    base_sha256: str | None = provided_base or cached_base or content_sha256
    set_current_file(new_path, base_sha256)

    if bool(data.get("remote_apply")):
        set_suppress_on_change_until(time.time() + 1.0)

    for ed in editors:
        try:
            try:
                ed.run_method("setCurrentFilePath", new_path)
            except Exception:
                pass
            ed.set_value(content)
            setattr(ed, "_cached_content", content)
            ed.set_language(language)
            ed.update()
            try:
                ed.run_method("nudgeLanguageParse", language, 5000)
            except Exception:
                pass
        except Exception as exc:
            print(f"[SET_CONTENT] Failed to update editor: {exc}", file=sys.stderr)

    broadcast_cache_state(
        project_path,
        new_path,
        state="mid_session" if (cache_entry and cache_entry.get("unsaved")) else "clean",
        unsaved=bool(cache_entry and cache_entry.get("unsaved")),
        cache_entry=cache_entry,
        reason="restore" if has_draft else "set_content",
    )

    project_root = get_project_root()
    init_watcher(project_root)

    def on_file_change(event: dict[str, object]) -> None:
        if event.get("type") != "replace_full":
            return
        new_content_obj = event.get("content", "")
        new_content = new_content_obj if isinstance(new_content_obj, str) else ""
        sha_obj = event.get("sha256")
        new_sha = sha_obj if isinstance(sha_obj, str) else None
        print(f"[SET_CONTENT][WATCHER] replace_full path={new_path!r} sha={new_sha}", file=sys.stderr)
        apply_watcher_replace(
            path=new_path,
            content=new_content,
            sha256=new_sha,
            project_path=project_path,
        )
        try:
            current_content = editor.value or ""
            schedule_diff_refresh(project_root, new_path, current_content, editor, "set_content_watcher")
        except Exception as exc:
            print(f"[FILE_WATCH] Failed to recalculate diffs: {exc}", file=sys.stderr)

    existing_token = get_watcher_token()
    if existing_token is not None:
        try:
            unsubscribe(existing_token)
        except Exception as exc:
            print(f"[SET_CONTENT] Failed to unsubscribe old token: {exc}", file=sys.stderr)

    new_token = subscribe(new_path, "nicegui_backend_set_content", on_file_change)
    set_watcher_token(new_token)

    editor_prefs_obj = preferences_store.get_preferences().get("editor", {})
    editor_prefs = cast(dict[str, object], editor_prefs_obj if isinstance(editor_prefs_obj, dict) else {})
    font_scale_pref = resolve_font_scale(editor_prefs.get("fontScale"))

    editor.set_zebra_stripes(editor_prefs.get("showShading"))
    editor.set_font_scale(font_scale_pref)
    editor.set_indent_guides(editor_prefs.get("showIndentGuides"))
    editor.toggle_color_picker(editor_prefs.get("colorPicker"))
    editor.set_read_only(editor_prefs.get("readOnly", False))
    editor.set_sticky_scroll(editor_prefs.get("stickyScroll", False))
    editor.update()
    print("[SET_CONTENT] Applied all preferences from disk", file=sys.stderr)

    if new_path:
        try:
            active_project = history_store.get_active_project() or str(get_project_root())
            hunks = await get_combined_diffs_async(Path(active_project).expanduser(), new_path, str(content))
            editor.set_diff_decorations(hunks)
        except Exception as exc:
            print(f"[SET_CONTENT] Failed to load diffs: {exc}", file=sys.stderr)
            editor.set_diff_decorations([])
    else:
        editor.set_diff_decorations([])

    return {"ok": True, "sha256": content_sha256}


async def handle_refresh_diffs(
    data: Mapping[str, object],
    *,
    history_store: HistoryStoreLike,
    get_active_editors: Callable[[], list[EditorLike]],
    get_project_root: Callable[[], Path],
    normalize_rel_path: NormalizeRelPathFn,
    collect_diff: CollectDiffFn,
    current_diff_base: CurrentDiffBaseFn,
) -> JsonMap:
    path = _dict_get_str(data, "path", "")
    if not path:
        return {"ok": False, "error": "No path provided"}
    editors = get_active_editors()
    if not editors:
        return {"ok": False, "error": "Editor not ready"}

    try:
        project_path = history_store.get_active_project() or str(get_project_root())
        if not project_path:
            return {"ok": False, "error": "No project selected"}
        project_root = Path(project_path).expanduser()
        rel = normalize_rel_path(project_root, path)
        diff_data = await asyncio.to_thread(
            lambda: collect_diff(project_root, rel, current_diff_base(project_path))
        )
        hunks_obj = diff_data.get("hunks", [])
        hunks = cast(list[object], hunks_obj if isinstance(hunks_obj, list) else [])
        for editor in editors:
            try:
                editor.set_diff_decorations(hunks)
            except Exception:
                pass
        return {"ok": True, "hunks_count": len(hunks)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def handle_get_cache_state(
    *,
    history_store: HistoryStoreLike,
    runtime_meta: RuntimeMetaProvider,
    get_current_file: Callable[[], str | None],
    project: str | None,
    path: str | None,
) -> JsonMap:
    project_path = project or history_store.get_active_project()
    current_file = path or get_current_file()
    if not project_path or not current_file:
        return {"ok": True, "data": None}

    cached = history_store.get_cached_document(project_path, current_file)
    if not cached:
        return {"ok": True, "data": {"state": "clean"}}

    runtime = runtime_meta()
    cached_run_obj = cached.get("run_id")
    runtime_run_obj = runtime.get("run_id")
    cached_run = cached_run_obj if isinstance(cached_run_obj, str) else ""
    runtime_run = runtime_run_obj if isinstance(runtime_run_obj, str) else ""
    state = "mid_session" if cached_run == runtime_run else "crashed"
    return {
        "ok": True,
        "data": {
            "state": state,
            "unsaved": cached.get("unsaved", False),
            "content_sha256": cached.get("content_sha256"),
            "base_sha256": cached.get("base_sha256"),
            "updated_at": cached.get("updated_at"),
            "run_id": cached.get("run_id"),
        },
    }


def handle_debug_editor_state(
    *,
    get_active_editor: Callable[[], EditorLike | None],
    get_current_file: Callable[[], str | None],
) -> JsonMap:
    editor = get_active_editor()
    if not editor:
        return {
            "ok": False,
            "error": "Editor not ready",
            "current_file": get_current_file(),
            "editor_exists": False,
        }
    content = editor.value or ""
    return {
        "ok": True,
        "editor_exists": True,
        "current_file": get_current_file(),
        "content_length": len(content),
        "content_hash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
    }
