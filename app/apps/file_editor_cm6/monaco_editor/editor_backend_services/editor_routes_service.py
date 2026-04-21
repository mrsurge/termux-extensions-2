# pyright: strict
from __future__ import annotations

import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from .protocols import EditorLike

JsonMap = dict[str, object]


class PreferencesStoreLike(Protocol):
    def get_preferences(self) -> dict[str, object]: ...


def handle_toggle_edit_tracking(
    data: Mapping[str, object],
    *,
    update_editor_preferences: Callable[[dict[str, object]], object],
) -> JsonMap:
    enabled = bool(data.get("enabled", False))
    from app.apps.file_editor_cm6 import change_ledger

    if enabled:
        change_ledger.clear()
        print("[editor_app] trackAgentEdits enabled via API — change_ledger ready", file=sys.stderr)
    else:
        change_ledger.clear()
        print("[editor_app] trackAgentEdits disabled via API — change_ledger cleared", file=sys.stderr)

    updates: dict[str, object] = {"trackAgentEdits": enabled}
    if enabled:
        updates["trackAgentSidebarEdits"] = False
    update_editor_preferences(updates)
    return {"ok": True, "enabled": enabled}


def handle_jump_to_line(
    data: Mapping[str, object],
    *,
    editors: list[EditorLike],
    primary: EditorLike | None,
) -> JsonMap:
    if not editors or not primary:
        return {"ok": False, "error": "Editor not ready"}

    line_obj = data.get("line", 1)
    try:
        target_line = int(line_obj) if isinstance(line_obj, (int, str)) else 1
    except (TypeError, ValueError):
        return {"ok": False, "error": "Invalid line number"}

    focus_flag = data.get("focus")
    should_focus = True if focus_flag is None else bool(focus_flag)
    scroll_to_top = bool(data.get("scroll_to_top") or data.get("scrollToTop"))

    scroll_y_obj = data.get("scroll_y") or data.get("scrollY")
    scroll_y: str | None
    if isinstance(scroll_y_obj, str):
        scroll_y = scroll_y_obj.strip()
    else:
        scroll_y = None
    if scroll_to_top:
        scroll_y = None

    print(
        f"[JUMP_TO_LINE] Scrolling to line {target_line}, scroll_to_top={scroll_to_top}, scroll_y={scroll_y}",
        file=sys.stderr,
    )

    for editor in editors:
        try:
            focus_this = should_focus if editor is primary else False
            editor.jump_to_line(target_line, focus=focus_this, scroll_to_top=scroll_to_top, scroll_y=scroll_y)
        except Exception as exc:
            print(f"[JUMP_TO_LINE] Failed: {exc}", file=sys.stderr)

    return {
        "ok": True,
        "line": target_line,
        "focus": should_focus,
        "scroll_to_top": scroll_to_top,
        "scroll_y": scroll_y,
    }


def handle_search_open(editor: EditorLike) -> JsonMap:
    editor.open_search_panel()
    return {"ok": True}


def handle_toggle_color_picker(editor: EditorLike, data: Mapping[str, object]) -> JsonMap:
    enabled_obj = data.get("enabled", False)
    editor.toggle_color_picker(enabled_obj)
    return {"ok": True, "enabled": enabled_obj}


def handle_set_read_only(editor: EditorLike, data: Mapping[str, object]) -> JsonMap:
    readonly_obj = data.get("readonly", False)
    editor.set_read_only(readonly_obj)
    return {"ok": True, "readonly": readonly_obj}


def handle_set_minimap_mode(editor: EditorLike, data: Mapping[str, object]) -> JsonMap:
    mode_obj = data.get("mode", "off")
    mode = mode_obj if isinstance(mode_obj, str) else "off"
    editor.set_minimap_mode(mode)
    return {"ok": True, "mode": mode}


def build_view_state_dict(
    *,
    preferences_store: PreferencesStoreLike,
    active_project: Callable[[], str | None],
    project_root: Callable[[], Path],
    get_lsp_state_payload: Callable[[str], Mapping[str, object]],
) -> JsonMap:
    prefs = preferences_store.get_preferences()
    editor_obj = prefs.get("editor")
    if isinstance(editor_obj, Mapping):
        editor_prefs = cast(Mapping[str, object], editor_obj)
    else:
        editor_prefs = cast(Mapping[str, object], {})
    lsp_state: JsonMap = {
        "enableLsp": False,
        "enableLspPyright": False,
        "enableLspTypescript": False,
        "enableLspClangd": False,
        "enableLspKotlin": False,
        "enableLspKotlinAndroid": False,
        "lspPyrightConfigMode": "root",
    }
    try:
        project_path = active_project() or str(project_root())
        if project_path:
            lsp_state_raw = get_lsp_state_payload(project_path)
            lsp_state = {str(k): v for k, v in lsp_state_raw.items()}
    except Exception:
        pass
    return {
        "showLineNumbers": editor_prefs.get("showLineNumbers"),
        "showSyntax": editor_prefs.get("showSyntax"),
        "showShading": editor_prefs.get("showShading"),
        "wordWrap": editor_prefs.get("wordWrap"),
        "autoCloseBrackets": editor_prefs.get("autoCloseBrackets"),
        "autocompletion": editor_prefs.get("autocompletion"),
        "theme": editor_prefs.get("theme"),
        "autoSave": editor_prefs.get("autoSave"),
        "showInlineDiffs": editor_prefs.get("showInlineDiffs"),
        "trackAgentEdits": editor_prefs.get("trackAgentEdits"),
        "trackAgentSidebarEdits": editor_prefs.get("trackAgentSidebarEdits"),
        "fontScale": editor_prefs.get("fontScale"),
        "showIndentGuides": editor_prefs.get("showIndentGuides"),
        "colorPicker": editor_prefs.get("colorPicker"),
        "readOnly": editor_prefs.get("readOnly"),
        "showMinimap": editor_prefs.get("showMinimap"),
        "showDraftDiffs": editor_prefs.get("showDraftDiffs"),
        "stickyScroll": editor_prefs.get("stickyScroll"),
        **lsp_state,
    }


def handle_set_active_project(
    payload: Mapping[str, object],
    *,
    set_active_project: Callable[[str], str | None],
    set_project_root: Callable[[str], Path],
    init_watcher: Callable[[Path], object],
) -> JsonMap:
    project_obj = payload.get("projectPath")
    project_path = project_obj if isinstance(project_obj, str) else ""
    if not project_path:
        raise ValueError("projectPath required")

    normalized = set_active_project(project_path)
    if not normalized:
        raise ValueError("invalid project path")
    root = set_project_root(normalized)
    init_watcher(root)
    return {"ok": True, "projectRoot": str(root)}
