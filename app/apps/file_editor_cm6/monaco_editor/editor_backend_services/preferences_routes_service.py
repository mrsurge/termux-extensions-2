# pyright: strict
from __future__ import annotations

import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from fastapi import HTTPException

from .protocols import EditorLike

JsonMap = dict[str, object]

LSP_KEYS = {
    "enableLsp",
    "enableLspPyright",
    "enableLspTypescript",
    "enableLspClangd",
    "enableLspKotlin",
    "enableLspKotlinAndroid",
    "lspRootRelPyright",
    "lspRootRelTypescript",
    "lspRootRelClangd",
    "lspRootRelKotlin",
    "lspRootRelKotlinAndroid",
    "lspKotlinAndroidModule",
    "lspKotlinAndroidVariant",
    "lspPyrightConfigMode",
}


class PreferencesStoreLike(Protocol):
    def get_preferences(self, project_path: str | None = None) -> dict[str, object]: ...
    def update_preferences(self, *, editor: dict[str, object]) -> dict[str, object]: ...


class HistoryStoreLike(Protocol):
    def get_active_project(self) -> str | None: ...
    def clear_cached_document(self, project_path: str, file_path: str) -> bool: ...
    def set_lsp_enabled(self, project_path: str, enabled: bool) -> bool: ...
    def set_lsp_server_enabled(self, project_path: str, server_id: str, enabled: bool) -> bool: ...
    def set_lsp_pyright_config_mode(self, project_path: str, mode: str) -> bool: ...
    def set_lsp_server_root_rel(self, project_path: str, server_id: str, root_rel: str) -> bool: ...


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
    maybe_connect_lsp: Callable[[EditorLike | None, Path | None, Path | None], None],
    broadcast_cache_state: BroadcastCacheStateFn,
    refresh_active_diffs: Callable[[], None],
    build_view_state_dict: Callable[[], JsonMap],
    theme_map: Mapping[str, str],
    lsp_language_map: Mapping[str, str],
    emit_preferences_changed: Callable[[str, str, object, JsonMap, dict[str, object], str | None], None],
) -> JsonMap:
    key_obj = data.get("key")
    key = key_obj if isinstance(key_obj, str) else ""
    value = data.get("value")
    source_client_obj = data.get("nicegui_client_id")
    source_client = source_client_obj if isinstance(source_client_obj, str) else None

    if not key:
        raise HTTPException(status_code=400, detail="key is required")

    if key not in LSP_KEYS:
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
        elif key in LSP_KEYS:
            pass
        elif key == "showInlineDiffs":
            pass
        elif key == "showDraftDiffs":
            pass
        elif key == "autoSave":
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
        elif key == "trackAgentEdits":
            value = bool(value)
            from app.apps.file_editor_cm6 import change_ledger

            if value:
                change_ledger.clear()
                print("[editor_app] trackAgentEdits enabled — change_ledger ready", file=sys.stderr)
            else:
                change_ledger.clear()
                print("[editor_app] trackAgentEdits disabled — change_ledger cleared", file=sys.stderr)
        elif key == "trackAgentSidebarEdits":
            value = bool(value)
            print(f"[editor_app] trackAgentSidebarEdits set to {value}", file=sys.stderr)
        elif key in ["showLineNumbers", "showSyntax", "autoCloseBrackets", "autocompletion", "autoSave"]:
            pass

        for ed in editors:
            ed.update()

        if key in LSP_KEYS:
            project_path = history_store.get_active_project() or str(get_project_root())
            if not project_path:
                raise HTTPException(status_code=400, detail="No active project for LSP preference")
            if key == "enableLsp":
                if not history_store.set_lsp_enabled(project_path, bool(value)):
                    raise RuntimeError("Failed to persist LSP enablement")
            elif key in ("enableLspPyright", "enableLspTypescript", "enableLspClangd", "enableLspKotlin", "enableLspKotlinAndroid"):
                server_map = {
                    "enableLspPyright": "pyright",
                    "enableLspTypescript": "typescript",
                    "enableLspClangd": "clangd",
                    "enableLspKotlin": "kotlin",
                    "enableLspKotlinAndroid": "kotlin-android",
                }
                server_id = server_map.get(key)
                if server_id and not history_store.set_lsp_server_enabled(project_path, server_id, bool(value)):
                    raise RuntimeError("Failed to persist LSP server enablement")
            elif key in ("lspRootRelKotlinAndroid", "lspKotlinAndroidModule", "lspKotlinAndroidVariant"):
                try:
                    from app.apps.file_editor_cm6.android_lang.android_lsp_config import update_android_lsp_config

                    root_path = Path(project_path)
                    if key == "lspRootRelKotlinAndroid":
                        update_android_lsp_config(root_path, root_rel=str(value))
                    elif key == "lspKotlinAndroidModule":
                        update_android_lsp_config(root_path, module=str(value))
                    else:
                        update_android_lsp_config(root_path, variant=str(value))
                except Exception as exc:
                    raise HTTPException(status_code=400, detail=f"Failed to persist kotlin-android config: {exc}")
            elif key == "lspPyrightConfigMode":
                mode = str(value or "").strip().lower()
                if not history_store.set_lsp_pyright_config_mode(project_path, mode):
                    raise RuntimeError("Failed to persist Pyright config mode")
                from app.apps.file_editor_cm6.lsp_shell_manager import shutdown_lsp_shell

                try:
                    await shutdown_lsp_shell("python")
                except Exception:
                    pass
            else:
                root_map = {
                    "lspRootRelPyright": "pyright",
                    "lspRootRelTypescript": "typescript",
                    "lspRootRelClangd": "clangd",
                    "lspRootRelKotlin": "kotlin",
                }
                server_id = root_map.get(key)
                if not server_id:
                    raise RuntimeError("Unknown LSP root override key")
                try:
                    root_rel = str(value).strip() if value is not None else ""
                except Exception:
                    root_rel = ""

                if not history_store.set_lsp_server_root_rel(project_path, server_id, root_rel):
                    raise HTTPException(
                        status_code=400,
                        detail="Invalid LSP project root: must be a relative directory within the project",
                    )

                from app.apps.file_editor_cm6.lsp_shell_manager import shutdown_lsp_shell

                server_languages = {
                    "pyright": ["python"],
                    "typescript": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
                    "clangd": ["c", "cpp"],
                    "kotlin": ["kotlin"],
                }
                for lang in server_languages.get(server_id, []):
                    try:
                        await shutdown_lsp_shell(lang)
                    except Exception:
                        pass

                try:
                    current_file = get_current_file()
                    if current_file:
                        current_lang = lsp_language_map.get(Path(current_file).suffix)
                        if current_lang in server_languages.get(server_id, []):
                            for ed in editors:
                                ed.disconnect_lsp()
                except Exception:
                    pass

            try:
                if not key.startswith("lspRootRel"):
                    current_file = get_current_file()
                    if current_file:
                        for ed in editors:
                            maybe_connect_lsp(ed, Path(current_file), Path(project_path))
                    elif key == "enableLsp" and not bool(value):
                        for ed in editors:
                            ed.disconnect_lsp()
            except Exception as exc:
                print(f"[PREFERENCE] LSP reconnect after {key} failed: {exc}", file=sys.stderr)
        else:
            editor_updates: dict[str, object] = {key: value}
            if key == "trackAgentEdits" and bool(value):
                editor_updates["trackAgentSidebarEdits"] = False
            elif key == "trackAgentSidebarEdits" and bool(value):
                editor_updates["trackAgentEdits"] = False
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
