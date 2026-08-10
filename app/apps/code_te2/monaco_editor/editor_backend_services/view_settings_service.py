# pyright: strict
from __future__ import annotations

import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import cast

from fastapi import HTTPException

from .protocols import EditorLike

JsonMap = dict[str, object]
GetActiveEditorFn = Callable[[], EditorLike | None]
UpdateEditorPrefsFn = Callable[[dict[str, object]], object]
ActiveProjectFn = Callable[[], str | None]
ProjectRootFn = Callable[[], Path]
NormalizeRelPathFn = Callable[[Path, str], str]
CurrentDiffBaseFn = Callable[[str | None], str]
ResolveThemePreferenceFn = Callable[[str], str]
ResolveFontScaleFn = Callable[[object | None], float]
CollectDiffFn = Callable[[Path, str, str], dict[str, object]]


def _diff_hunks_for_path(
    *,
    project_path: str,
    current_path: str,
    normalize_rel_path: NormalizeRelPathFn,
    collect_diff: CollectDiffFn,
    current_diff_base: CurrentDiffBaseFn,
) -> list[object]:
    project_root = Path(project_path).expanduser()
    rel = normalize_rel_path(project_root, current_path)
    diff_data = collect_diff(project_root, rel, current_diff_base(project_path))
    hunks_obj = diff_data.get("hunks", [])
    if isinstance(hunks_obj, list):
        return cast(list[object], hunks_obj)
    return []


def handle_set_view_settings(
    data: Mapping[str, object],
    *,
    get_active_editor: GetActiveEditorFn,
    update_editor_preferences: UpdateEditorPrefsFn,
    active_project: ActiveProjectFn,
    project_root: ProjectRootFn,
    normalize_rel_path: NormalizeRelPathFn,
    collect_diff: CollectDiffFn,
    current_diff_base: CurrentDiffBaseFn,
    resolve_theme_preference: ResolveThemePreferenceFn,
) -> JsonMap:
    editor = get_active_editor()
    editor_updates: dict[str, object] = {}

    if "word_wrap" in data:
        word_wrap = bool(data["word_wrap"])
        editor_updates["wordWrap"] = word_wrap
        if editor:
            editor.set_line_wrapping(word_wrap)
            editor.update()

    if "line_shading" in data:
        line_shading = bool(data["line_shading"])
        editor_updates["showShading"] = line_shading
        if editor:
            editor.set_zebra_stripes(line_shading)

    if "indent_guides" in data:
        show_guides = bool(data["indent_guides"])
        editor_updates["showIndentGuides"] = show_guides
        if editor:
            editor.set_indent_guides(show_guides)

    if "show_inline_diffs" in data:
        show_diffs = bool(data["show_inline_diffs"])
        editor_updates["showInlineDiffs"] = show_diffs
        if show_diffs:
            editor_updates["showDraftDiffs"] = False
        if show_diffs and editor and "current_path" in data:
            try:
                project_path = active_project() or str(project_root())
                current_path_obj = data["current_path"]
                if isinstance(current_path_obj, str):
                    hunks = _diff_hunks_for_path(
                        project_path=project_path,
                        current_path=current_path_obj,
                        normalize_rel_path=normalize_rel_path,
                        collect_diff=collect_diff,
                        current_diff_base=current_diff_base,
                    )
                    editor.set_diff_decorations(hunks)
            except Exception as exc:
                print(f"[DIFF] Failed to load diffs on toggle: {exc}", file=sys.stderr)
        elif not show_diffs and editor:
            editor.set_diff_decorations([])

    if "theme" in data:
        theme_name = str(data["theme"])
        editor_updates["theme"] = theme_name
        try:
            mapped_theme = resolve_theme_preference(theme_name)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if editor:
            editor.set_theme(mapped_theme)

    if editor_updates:
        update_editor_preferences(editor_updates)

    return {"ok": True}


def handle_set_font_scale(
    data: Mapping[str, object],
    *,
    get_active_editor: GetActiveEditorFn,
    resolve_font_scale: ResolveFontScaleFn,
    update_editor_preferences: UpdateEditorPrefsFn,
) -> JsonMap:
    """Set editor font scale from one of three presets: 0.70, 0.85, 1.0"""
    try:
        editor = get_active_editor()
        try:
            scale = resolve_font_scale(data.get("scale"))
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        if editor:
            try:
                editor.set_font_scale(scale)
                print(f"[EDITOR] Font scale changed to: {scale}", file=sys.stderr)
            except Exception as exc:
                print(f"[EDITOR] Failed to set font scale: {exc}", file=sys.stderr)
                raise HTTPException(status_code=500, detail=f"Failed to apply font scale: {exc}")

        try:
            update_editor_preferences({"fontScale": scale})
            print(f"[EDITOR] Persisted font scale: {scale} globally", file=sys.stderr)
        except Exception as exc:
            print(f"[EDITOR] Failed to persist font scale: {exc}", file=sys.stderr)
            raise HTTPException(status_code=500, detail=f"Failed to persist font scale: {exc}")

        return {"ok": True, "data": {"fontScale": scale}}
    except HTTPException:
        raise
    except Exception as exc:
        import traceback

        print(f"[EDITOR] Unexpected error in set_font_scale: {exc}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Internal error: {exc}")
