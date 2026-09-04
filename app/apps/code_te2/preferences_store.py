from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from typing import TypeAlias, cast

from .code_te2_paths import code_te2_paths

JsonDict: TypeAlias = dict[str, object]


def _as_dict(value: object) -> JsonDict:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items() if isinstance(key, str)}


DEFAULT_EDITOR_PREFS: JsonDict = {
    "showLineNumbers": True,
    "showSyntax": True,
    "showShading": False,
    "wordWrap": False,
    "autoCloseBrackets": True,
    "autocompletion": True,
    "showInlayHints": True,
    "theme": "github-dark",
    "autoSave": False,
    "showInlineDiffs": False,
    "showDraftDiffs": False,
    "trackAgentSidebarEdits": False,
    "fontScale": 0.85,  # NEW: Default to Medium preset
    "showIndentGuides": True,
    "showLineShading": False,
    "colorPicker": True,
    "readOnly": False,
    "showMinimap": False,
    "stickyScroll": False,  # Added: 2025-12-03 by vectorArc - TE2 Team
    # Monaco DiffEditor inline rendering: if enabled, uses VS Code's "true inline view".
    # Default off for stability on mobile; can be toggled later.
    "useTrueInlineView": False,
    # Optional: path to JetBrains Kotlin LSP entrypoint (kotlin-lsp.sh)
    "kotlinLspPath": "",
    # Kotlin LSP run-mode knobs (useful on Termux/Android where file watching can be restricted)
    "kotlinLspIsolatedDocuments": True,
}

DEFAULT_UI_PREFS: JsonDict = {
    "assistantCollapsed": True,
    "gitIndicators": True,
    # Explorer drawer (Monaco-ish sticky scope headers)
    "explorerStickyHeaders": True,
    # Side-bar (iframe) shortcuts + toggle chrome (global).
    # Legacy compatibility:
    # - agentActiveShortcutId is ignored by the clientized sidebar tab/view model
    # - agentShortcuts[*].header is accepted on input but ignored by rendering
    "agentActiveShortcutId": "",
    "agentToggleDisplay": "icon",  # "icon" | "text" | "both"
    "agentHeaderDisplay": "text",  # "icon" | "text" | "both"
    # Shortcuts list:
    #   [{"id": "...", "kind": "url"|"framework_app", "app_id": "...", "label": "...", "url": "...", "version": "...", "icon": {...}, "load": "...", "header": bool, "last_used": int}]
    "agentShortcuts": [],
    # Stateful sidebar app-window ledger. Slots are keyed by host_id.
    # This is intentionally separate from user-authored shortcuts.
    "sidebarWindowState": {"version": 2, "slots": {}},
    # Monaco web workers (JSON, CSS, HTML, TS language services).
    # OFF by default — the workbench adapter extension host handles everything.
    "webWorkersEnabled": False,
}


# Font scale validation helper
ALLOWED_FONT_SCALES = {0.70, 0.85, 1.0}

def validate_font_scale(scale: float) -> float:
    """Validate and clamp font scale to allowed presets."""
    if scale not in ALLOWED_FONT_SCALES:
        # Find nearest preset
        return min(ALLOWED_FONT_SCALES, key=lambda x: abs(x - scale))
    return scale


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


class PreferencesStore:
    """Disk-backed store for Code OSS editor/UI preferences - always reads from disk."""

    def __init__(self, storage_path: Path | None = None) -> None:
        self._path = storage_path or code_te2_paths().preferences_path
        _ensure_dir(self._path)
        self._lock = threading.Lock()
        # NO in-memory cache - file is always authority
        self._initialize_if_missing()
        self._ensure_schema_compliance()

    @property
    def path(self) -> Path:
        """Absolute path to the backing preference file."""
        return self._path

    # ---------------------------------------------------------------------
    # internal helpers
    
    def _initialize_if_missing(self) -> None:
        """Create preference file with defaults if it doesn't exist."""
        if not self._path.exists():
            # File doesn't exist - write defaults to disk
            defaults = {
                "editor": dict(DEFAULT_EDITOR_PREFS),
                "ui": dict(DEFAULT_UI_PREFS),
                "projects": {},
            }
            # Write to disk - MUST succeed
            tmp_path = self._path.with_suffix(".tmp")
            try:
                payload = json.dumps(defaults, ensure_ascii=False, indent=2)
                tmp_path.write_text(payload, encoding="utf-8")
                tmp_path.replace(self._path)
                print(f"[PREFS] Created preference file with defaults: {self._path}", file=sys.stderr)
            except Exception as e:
                # FAIL HARD - cannot operate without preference file
                print(f"[PREFS] FATAL: Cannot create preference file: {e}", file=sys.stderr)
                raise RuntimeError(f"Cannot initialize preferences at {self._path}: {e}") from e
            finally:
                if tmp_path.exists():
                    tmp_path.unlink(missing_ok=True)

    def _ensure_schema_compliance(self) -> None:
        """Ensure all defined defaults exist in the store (migration)."""
        with self._lock:
            try:
                data = self._read_from_disk()
            except RuntimeError:
                # File might be corrupt or missing (handled by _initialize_if_missing)
                return

            modified = False
            editor_store = _as_dict(data.get("editor"))
            if "trackAgentEdits" in editor_store:
                editor_store.pop("trackAgentEdits", None)
                modified = True
            if editor_store.get("theme") == "cm6-dark":
                editor_store["theme"] = "github-dark"
                modified = True
            for key, default_val in DEFAULT_EDITOR_PREFS.items():
                if key not in editor_store:
                    editor_store[key] = default_val
                    modified = True
            data["editor"] = editor_store
            
            ui_store = _as_dict(data.get("ui"))
            for key, default_val in DEFAULT_UI_PREFS.items():
                if key not in ui_store:
                    ui_store[key] = default_val
                    modified = True
            data["ui"] = ui_store
            
            if modified:
                print(f"[PREFS] Migrating preferences with new defaults", file=sys.stderr)
                self._write_to_disk(data)

    def _read_from_disk(self) -> JsonDict:
        """Read preferences directly from disk - file MUST exist."""
        if not self._path.exists():
            raise RuntimeError(f"Preference file doesn't exist: {self._path}")
        try:
            content = self._path.read_text(encoding="utf-8")
            if not content.strip():
                raise RuntimeError(f"Preference file is empty: {self._path}")
            decoded = cast(object, json.loads(content))
            if not isinstance(decoded, dict):
                raise RuntimeError(f"Preference file is not a dict: {self._path}")
            return _as_dict(cast(object, decoded))
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Preference file has invalid JSON: {self._path}: {e}") from e

    def _write_to_disk(self, data: JsonDict) -> None:
        """Write preferences directly to disk - atomic replace."""
        tmp_path = self._path.with_suffix(".tmp")
        try:
            print(f"[PREFS] Writing preferences to {self._path}", file=sys.stderr)
            payload = json.dumps(data, ensure_ascii=False, indent=2)
            tmp_path.write_text(payload, encoding="utf-8")
            tmp_path.replace(self._path)
        except Exception as e:
            raise RuntimeError(f"Failed to write preferences to {self._path}: {e}") from e
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    # ---------------------------------------------------------------------
    # public API

    def get_preferences(self, project_path: str | None = None) -> JsonDict:
        """Read preferences directly from disk - NO cache, NO defaults merged."""
        with self._lock:
            data = self._read_from_disk()
            editor = _as_dict(data.get("editor"))
            ui = _as_dict(data.get("ui"))
            project_entry: JsonDict = {}
            if project_path:
                projects = _as_dict(data.get("projects"))
                project = _as_dict(projects.get(project_path))
                project_entry = {
                    "path": project_path,
                    "last_file": project.get("last_file"),
                }
            return {
                "editor": editor,
                "ui": ui,
                "project": project_entry,
            }

    def update_preferences(
        self,
        *,
        editor: JsonDict | None = None,
        ui: JsonDict | None = None,
        project: JsonDict | None = None,
    ) -> JsonDict:
        """Update preferences - read from disk, modify, write back atomically."""
        with self._lock:
            # Read current state from disk
            data = self._read_from_disk()
            
            if editor:
                editor_store = _as_dict(data.get("editor"))
                for key, value in editor.items():
                    if key in DEFAULT_EDITOR_PREFS:
                        editor_store[key] = value
                data["editor"] = editor_store

            if ui:
                ui_store = _as_dict(data.get("ui"))
                for key, value in ui.items():
                    if key in DEFAULT_UI_PREFS:
                        ui_store[key] = value
                data["ui"] = ui_store

            project_result: JsonDict = {}
            if project:
                path = project.get("path")
                if not isinstance(path, str) or not path:
                    raise ValueError("project.path is required when updating project preferences")
                projects = _as_dict(data.get("projects"))
                entry = _as_dict(projects.get(path))
                if "last_file" in project:
                    last_file = project.get("last_file")
                    entry["last_file"] = last_file or None
                projects[path] = entry
                data["projects"] = projects
                project_result = {
                    "path": path,
                    "last_file": entry.get("last_file"),
                }

            # Write back to disk
            self._write_to_disk(data)

            return {
                "editor": data.get("editor") or {},
                "ui": data.get("ui") or {},
                "project": project_result,
            }
