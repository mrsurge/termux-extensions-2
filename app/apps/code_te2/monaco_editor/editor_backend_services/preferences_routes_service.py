# pyright: strict
from __future__ import annotations

import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from .outcomes import EditorServiceError

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
    editor_obj = prefs.get("editor")
    editor: dict[str, object] = editor_obj if isinstance(editor_obj, dict) else {}
    return editor


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
        raise EditorServiceError(kind="invalid", detail="key is required")

    from app.apps.code_te2.preferences_store import DEFAULT_EDITOR_PREFS

    if key not in DEFAULT_EDITOR_PREFS and key != "comparisonMode":
        raise EditorServiceError(kind="invalid", detail=f"Invalid preference key: {key}")

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
                            hunks_obj = diff_data.get("hunks")
                            hunks: list[object] = hunks_obj if isinstance(hunks_obj, list) else []
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
                raise EditorServiceError(kind="invalid", detail=str(exc))
            value = scale
            for ed in editors:
                ed.set_font_scale(scale)
        elif key == "cursorStyle":
            from app.apps.code_te2.preferences_store import validate_cursor_style

            normalized_cursor_style = validate_cursor_style(value)
            if normalized_cursor_style != value:
                raise EditorServiceError(
                    kind="invalid",
                    detail=f"Unsupported cursor style: {value!r}",
                )
            value = normalized_cursor_style
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
            raise EditorServiceError(kind="invalid", detail="Use the project autosave transition")
        elif key == "trackAgentSidebarEdits":
            value = bool(value)
            print(f"[editor_app] trackAgentSidebarEdits set to {value}", file=sys.stderr)
        elif key == "relativeLineNumbers":
            if not isinstance(value, bool):
                raise EditorServiceError(kind="invalid", detail="relativeLineNumbers must be boolean")
        elif key in ["showLineNumbers", "showSyntax", "autoCloseBrackets", "autocompletion", "autoSave"]:
            pass

        for ed in editors:
            ed.update()

        editor_updates: dict[str, object] = {key: value}
        if key == "comparisonMode":
            if value not in ("plain", "commit", "disk"):
                raise EditorServiceError(kind="invalid", detail="Invalid comparison mode")
            editor_updates = {"showInlineDiffs": value == "commit", "showDraftDiffs": value == "disk"}
            if value == "disk":
                editor_updates["autoSave"] = False
        elif key == "showInlineDiffs" and bool(value):
            editor_updates["showDraftDiffs"] = False
        elif key == "showDraftDiffs" and bool(value):
            editor_updates["showInlineDiffs"] = False
            editor_updates["autoSave"] = False
        elif key == "autoSave" and bool(value):
            editor_updates["showDraftDiffs"] = False
        if "autoSave" in editor_updates:
            from ...project_sidecar import ProjectSidecar
            if editor_updates.pop("autoSave"):
                raise EditorServiceError(kind="invalid", detail="Use the project autosave transition")
            project = history_store.get_active_project()
            from ...project_autosave import require_project_idle
            if project:
                require_project_idle(project)
                sidecar = ProjectSidecar.load_or_create(project)
                sidecar.set_autosave_mode(False, sidecar.get_autosave_state()[1])
        _ = preferences_store.update_preferences(editor=editor_updates)

        if key in ("showInlineDiffs", "showDraftDiffs", "autoSave", "comparisonMode"):
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
    except EditorServiceError:
        raise
    except Exception as exc:
        print(f"[PREFERENCE] Failed to apply {key}={value}: {exc}", file=sys.stderr)
        raise EditorServiceError(kind="internal", detail=f"Failed to apply preference: {exc}")
