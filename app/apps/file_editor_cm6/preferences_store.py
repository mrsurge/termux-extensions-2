from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Dict, Optional


DEFAULT_EDITOR_PREFS: Dict[str, Any] = {
    "showLineNumbers": True,
    "showSyntax": True,
    "showShading": False,
    "wordWrap": False,
    "theme": "cm6-dark",
    "autoSave": True,
}

DEFAULT_UI_PREFS: Dict[str, Any] = {
    "assistantCollapsed": True,
    "gitIndicators": True,
}


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


class PreferencesStore:
    """Disk-backed store for Code OSS editor/UI preferences."""

    def __init__(self, storage_path: Optional[Path] = None) -> None:
        default_root = Path.home() / ".local" / "share" / "termux-extensions-2"
        default_root.mkdir(parents=True, exist_ok=True)
        self._path = storage_path or (default_root / "code_oss_prefs.json")
        _ensure_dir(self._path)
        self._lock = threading.Lock()
        self._data: Dict[str, Any] = {
            "editor": {},
            "ui": {},
            "projects": {},
        }
        self._load()

    # ---------------------------------------------------------------------
    # internal helpers

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            content = self._path.read_text(encoding="utf-8")
            if not content.strip():
                return
            data = json.loads(content)
            if isinstance(data, dict):
                self._data["editor"] = data.get("editor", {}) or {}
                self._data["ui"] = data.get("ui", {}) or {}
                self._data["projects"] = data.get("projects", {}) or {}
        except Exception:
            # Corrupt or unreadable preferences; start fresh.
            self._data = {"editor": {}, "ui": {}, "projects": {}}

    def _save_locked(self) -> None:
        tmp_path = self._path.with_suffix(".tmp")
        try:
            payload = json.dumps(self._data, ensure_ascii=False, indent=2)
            tmp_path.write_text(payload, encoding="utf-8")
            tmp_path.replace(self._path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    # ---------------------------------------------------------------------
    # public API

    def get_preferences(self, project_path: Optional[str] = None) -> Dict[str, Any]:
        with self._lock:
            editor = {**DEFAULT_EDITOR_PREFS, **(self._data.get("editor") or {})}
            ui = {**DEFAULT_UI_PREFS, **(self._data.get("ui") or {})}
            project_entry: Dict[str, Any] = {}
            if project_path:
                projects = self._data.get("projects", {}) or {}
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
        with self._lock:
            if editor:
                editor_store = self._data.setdefault("editor", {})
                for key, value in editor.items():
                    if key in DEFAULT_EDITOR_PREFS:
                        editor_store[key] = value

            if ui:
                ui_store = self._data.setdefault("ui", {})
                for key, value in ui.items():
                    if key in DEFAULT_UI_PREFS:
                        ui_store[key] = value

            project_result: Dict[str, Any] = {}
            if project:
                path = project.get("path")
                if not path:
                    raise ValueError("project.path is required when updating project preferences")
                projects = self._data.setdefault("projects", {})
                entry = projects.setdefault(path, {})
                if "last_file" in project:
                    last_file = project.get("last_file")
                    entry["last_file"] = last_file or None
                project_result = {
                    "path": path,
                    "last_file": entry.get("last_file"),
                }

            self._save_locked()

            return {
                "editor": {**DEFAULT_EDITOR_PREFS, **(self._data.get("editor") or {})},
                "ui": {**DEFAULT_UI_PREFS, **(self._data.get("ui") or {})},
                "project": project_result,
            }
