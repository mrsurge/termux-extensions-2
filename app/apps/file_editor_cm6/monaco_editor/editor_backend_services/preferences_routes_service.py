# pyright: strict
from __future__ import annotations

import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from fastapi import HTTPException

from .protocols import EditorLike

JsonMap = dict[str, object]


class PreferencesStoreLike(Protocol):
    def get_preferences(self, project_path: str | None = None) -> dict[str, object]: ...
    def update_preferences(self, *, editor: dict[str, object]) -> dict[str, object]: ...


class HistoryStoreLike(Protocol):
    def get_active_project(self) -> str | None: ...
    def clear_cached_document(self, project_path: str, file_path: str) -> bool: ...


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


def _as_editor_prefs(preferences_store: PreferencesStoreLike) -> dict[str, object]:
    prefs = preferences_store.get_preferences()
    editor_obj = prefs.get("editor", {})
    return cast(dict[str, object], editor_obj if isinstance(editor_obj, dict) else {})


async def handle_update_preference(
    data: Mapping[str, object],
    *,
    editors: list[EditorLike],
    preferences_store: PreferencesStoreLike,
    history_store: HistoryStoreLike,
    get_project_root: Callable[[], Path],
    get_current_file: Callable[[], str | None],
    resolve_font_scale: Callable[[object | None], float],
    normalize_rel_path: Callable[[Path, str], str],
    collect_diff: Callable[[Path, str, str], dict[str, object]],
    current_diff_base: Callable[[str | None], str],
    broadcast_cache_state: BroadcastCacheStateFn,
    refresh_active_diffs: Callable[[], None],
    build_view_state_dict: Callable[[], JsonMap],
    theme_map: Mapping[str, str],
    emit_preferences_changed: Callable[[str, str, object, JsonMap, dict[str, object], str | None], None],
) -> JsonMap:
    key_obj = data.get("key")
    key = key_obj if isinstance(key_obj, str) else ""
    value = data.get("value")
    source_client_obj = data.get("nicegui_client_id")
    source_client = source_client_obj if isinstance(source_client_obj, str) else None

    if not key:
        raise HTTPException(status_code=400, detail="key is required")

    from app.apps.file_editor_cm6.preferences_store import DEFAULT_EDITOR_PREFS

    if key not in DEFAULT_EDITOR_PREFS:
        raise HTTPException(status_code=400, detail=f"Invalid preference key: {key}")

    try:
        print(f"[PREFERENCE] Incoming update key={key} value={value}", file=sys.stderr)
        if key == "wordWrap":
            for ed in editors:
                ed.set_line_wrapping(bool(value))
            current_file = get_current_file()
            if value and current_file:
                current_prefs = _as_editor_prefs(preferences_store)
                if bool(current_prefs.get("showInlineDiffs", False)):
                    project_path = history_store.get_active_project() or str(get_project_root())
                    if project_path:
                        try:
                            rel = normalize_rel_path(Path(project_path).expanduser(), current_file)
                            diff_data = collect_diff(Path(project_path).expanduser(), rel, current_diff_base(project_path))
                            hunks_obj = diff_data.get("hunks", [])
                            hunks = cast(list[object], hunks_obj if isinstance(hunks_obj, list) else [])
                            for ed in editors:
                                ed.set_diff_decorations(hunks)
                            print("[PREFERENCE] Refreshed diffs after word wrap enabled", file=sys.stderr)
                        except Exception as exc:
                            print(f"[PREFERENCE] Failed to refresh diffs: {exc}", file=sys.stderr)
        elif key == "showShading":
            for ed in editors:
                ed.set_zebra_stripes(bool(value))
        elif key == "showIndentGuides":
            for ed in editors:
                ed.set_indent_guides(bool(value))
        elif key == "theme":
            theme_value = str(value)
            value = theme_value
            mapped_theme = theme_map.get(theme_value)
            if mapped_theme:
                for ed in editors:
                    ed.set_theme(mapped_theme)
        elif key == "fontScale":
            try:
                scale = resolve_font_scale(value)
            except RuntimeError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            value = scale
            for ed in editors:
                ed.set_font_scale(scale)
        elif key == "colorPicker":
            for ed in editors:
                ed.toggle_color_picker(bool(value))
        elif key == "readOnly":
            for ed in editors:
                ed.set_read_only(bool(value))
        elif key == "showMinimap":
            for ed in editors:
                ed.show_minimap = bool(value)
        elif key == "stickyScroll":
            for ed in editors:
                ed.set_sticky_scroll(bool(value))
        elif key == "showInlineDiffs":
            value = bool(value)
        elif key == "showDraftDiffs":
            value = bool(value)
        elif key == "autoSave":
            value = bool(value)
            project_path = history_store.get_active_project() or str(get_project_root())
            current_file = get_current_file()
            if value and project_path and current_file:
                try:
                    from app.apps.file_editor_cm6.explorer.services.runtime_notifications import (
                        notify_draft_state_changed,
                    )

                    history_store.clear_cached_document(project_path, current_file)
                    notify_draft_state_changed(project_path)
                except Exception as exc:
                    print(f"[PREFERENCE] Failed to clear cache on autosave enable: {exc}", file=sys.stderr)
                broadcast_cache_state(
                    project_path,
                    current_file,
                    state="clean",
                    unsaved=False,
                    cache_entry=None,
                    reason="autosave_on",
                )
        elif key == "trackAgentSidebarEdits":
            value = bool(value)
            print(f"[editor_app] trackAgentSidebarEdits set to {value}", file=sys.stderr)
        elif key in ["showLineNumbers", "showSyntax", "autoCloseBrackets", "autocompletion", "autoSave"]:
            pass

        for ed in editors:
            ed.update()

        editor_updates: dict[str, object] = {key: value}
        if key == "showInlineDiffs" and bool(value):
            editor_updates["showDraftDiffs"] = False
        elif key == "showDraftDiffs" and bool(value):
            editor_updates["showInlineDiffs"] = False
            editor_updates["autoSave"] = False
        elif key == "autoSave" and bool(value):
            editor_updates["showDraftDiffs"] = False
        if key == "trackAgentSidebarEdits" and bool(value):
            try:
                from app.apps.file_editor_cm6 import change_ledger

                change_ledger.clear()
            except Exception:
                pass
        preferences_store.update_preferences(editor=editor_updates)

        if key in ("showInlineDiffs", "showDraftDiffs", "autoSave"):
            refresh_active_diffs()

        print(f"[PREFERENCE] Updated {key}={value}", file=sys.stderr)

        view_state = build_view_state_dict()
        try:
            project_path = history_store.get_active_project() or str(get_project_root())
            proj_norm = str(Path(project_path).expanduser().resolve(strict=False)) if project_path else ""
            if proj_norm:
                preferences = preferences_store.get_preferences(proj_norm)
                emit_preferences_changed(proj_norm, key, value, view_state, preferences, source_client)
        except Exception:
            pass

        return {"ok": True, "data": view_state}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[PREFERENCE] Failed to apply {key}={value}: {exc}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Failed to apply preference: {exc}")
