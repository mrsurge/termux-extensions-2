from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from typing import Any, Dict, Optional


DEFAULT_EDITOR_PREFS: Dict[str, Any] = {
    "showLineNumbers": True,
    "showSyntax": True,
    "showShading": False,
    "wordWrap": False,
    "autoCloseBrackets": True,
    "autocompletion": True,
    "theme": "cm6-dark",
    "autoSave": True,
    "showInlineDiffs": True,
    "showDraftDiffs": True,
    "trackAgentEdits": False,
    "fontScale": 0.85,  # NEW: Default to Medium preset
    "showIndentGuides": True,
    "showLineShading": False,
    "showInlineDiffs": True,
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

DEFAULT_UI_PREFS: Dict[str, Any] = {
    "assistantCollapsed": True,
    "gitIndicators": True,
    # Explorer drawer (Monaco-ish sticky scope headers)
    "explorerStickyHeaders": True,
    # Agent drawer mode + iframe endpoint (owned by file_editor_cm6 main page).
    "agentDrawerIframe": False,
    "agentDrawerIframeUrl": "",
    # Agent toggle chrome + shortcuts (global).
    "agentToggleDisplay": "icon",  # "icon" | "text" | "both"
    "agentToggleText": "Agent",
    # icon descriptor: {"kind":"default"} | {"kind":"emoji","emoji":"💬"} | {"kind":"asset","name":"..."}
    "agentToggleIcon": {"kind": "default"},
    # Shortcuts list: [{"id": "...", "label": "...", "url": "...", "icon": {...}}]
    "agentShortcuts": [],
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

    def __init__(self, storage_path: Optional[Path] = None) -> None:
        default_root = Path.home() / ".local" / "share" / "termux-extensions-2"
        default_root.mkdir(parents=True, exist_ok=True)
        self._path = storage_path or (default_root / "code_oss_prefs.json")
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
            editor_store = data.setdefault("editor", {})
            for key, default_val in DEFAULT_EDITOR_PREFS.items():
                if key not in editor_store:
                    editor_store[key] = default_val
                    modified = True
            
            ui_store = data.setdefault("ui", {})
            for key, default_val in DEFAULT_UI_PREFS.items():
                if key not in ui_store:
                    ui_store[key] = default_val
                    modified = True
            
            if modified:
                print(f"[PREFS] Migrating preferences with new defaults", file=sys.stderr)
                self._write_to_disk(data)

    def _read_from_disk(self) -> Dict[str, Any]:
        """Read preferences directly from disk - file MUST exist."""
        if not self._path.exists():
            raise RuntimeError(f"Preference file doesn't exist: {self._path}")
        try:
            content = self._path.read_text(encoding="utf-8")
            if not content.strip():
                raise RuntimeError(f"Preference file is empty: {self._path}")
            data = json.loads(content)
            if not isinstance(data, dict):
                raise RuntimeError(f"Preference file is not a dict: {self._path}")
            return data
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Preference file has invalid JSON: {self._path}: {e}") from e

    def _write_to_disk(self, data: Dict[str, Any]) -> None:
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

    def get_preferences(self, project_path: Optional[str] = None) -> Dict[str, Any]:
        """Read preferences directly from disk - NO cache, NO defaults merged."""
        with self._lock:
            data = self._read_from_disk()
            editor = data.get("editor") or {}
            ui = data.get("ui") or {}
            project_entry: Dict[str, Any] = {}
            if project_path:
                projects = data.get("projects", {}) or {}
                project = projects.get(project_path, {}) or {}
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
        editor: Optional[Dict[str, Any]] = None,
        ui: Optional[Dict[str, Any]] = None,
        project: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Update preferences - read from disk, modify, write back atomically."""
        with self._lock:
            # Read current state from disk
            data = self._read_from_disk()
            
            if editor:
                editor_store = data.setdefault("editor", {})
                for key, value in editor.items():
                    if key in DEFAULT_EDITOR_PREFS:
                        editor_store[key] = value

            if ui:
                ui_store = data.setdefault("ui", {})
                for key, value in ui.items():
                    if key in DEFAULT_UI_PREFS:
                        ui_store[key] = value

            project_result: Dict[str, Any] = {}
            if project:
                path = project.get("path")
                if not path:
                    raise ValueError("project.path is required when updating project preferences")
                projects = data.setdefault("projects", {})
                entry = projects.setdefault(path, {})
                if "last_file" in project:
                    last_file = project.get("last_file")
                    entry["last_file"] = last_file or None
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
