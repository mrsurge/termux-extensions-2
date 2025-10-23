from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

MAX_RECENT_PROJECTS = 12
MAX_RECENT_FILES = 12


def _utc_timestamp() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _project_label(path: str) -> str:
    try:
        label = Path(path).name
        return label or path
    except Exception:
        return path


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


class HistoryStore:
    """Persist recent project/file history for the Code OSS wrapper."""

    def __init__(self, storage_path: Optional[Path] = None) -> None:
        default_root = Path.home() / ".local" / "share" / "termux-extensions-2"
        default_root.mkdir(parents=True, exist_ok=True)
        self._path = storage_path or (default_root / "code_oss_history.json")
        _ensure_dir(self._path)
        self._lock = threading.Lock()
        self._data: Dict[str, object] = {
            "recent_projects": [],
            "projects": {},
        }
        self._load()

    # ----- persistence helpers -------------------------------------------------

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            content = self._path.read_text(encoding="utf-8")
            if not content.strip():
                return
            data = json.loads(content)
            if isinstance(data, dict):
                self._data["recent_projects"] = data.get("recent_projects", [])
                self._data["projects"] = data.get("projects", {})
        except Exception:
            # Corrupt or unreadable history; start fresh.
            self._data = {"recent_projects": [], "projects": {}}

    def _save_locked(self) -> None:
        tmp_path = self._path.with_suffix(".tmp")
        try:
            tmp_path.write_text(json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_path.replace(self._path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    # ----- internal helpers ----------------------------------------------------

    def _touch_project_locked(self, path: str) -> Dict[str, object]:
        projects: Dict[str, Dict[str, object]] = self._data.setdefault("projects", {})
        project_entry = projects.get(path, {"files": []})
        project_entry["label"] = _project_label(path)
        timestamp = _utc_timestamp()
        project_entry["opened_at"] = timestamp
        projects[path] = project_entry

        recent: List[Dict[str, object]] = self._data.setdefault("recent_projects", [])
        recent = [entry for entry in recent if entry.get("path") != path]
        recent.insert(
            0,
            {
                "path": path,
                "label": project_entry["label"],
                "opened_at": timestamp,
            },
        )
        self._data["recent_projects"] = recent[:MAX_RECENT_PROJECTS]
        return project_entry

    def _normalize_file_path(self, file_path: str) -> str:
        try:
            return str(Path(file_path).expanduser().resolve(strict=False))
        except Exception:
            return file_path

    # ----- public API ----------------------------------------------------------

    def touch_project(self, project_path: str) -> Dict[str, object]:
        with self._lock:
            entry = self._touch_project_locked(project_path)
            self._save_locked()
            return {
                "path": project_path,
                "label": entry["label"],
                "opened_at": entry["opened_at"],
            }

    def touch_file(self, project_path: str, file_path: str) -> Dict[str, object]:
        normalized_file = self._normalize_file_path(file_path)
        with self._lock:
            project_entry = self._touch_project_locked(project_path)
            files: List[Dict[str, object]] = project_entry.setdefault("files", [])
            files = [entry for entry in files if entry.get("path") != normalized_file]
            timestamp = _utc_timestamp()
            file_entry = {
                "path": normalized_file,
                "label": _project_label(normalized_file),
                "opened_at": timestamp,
            }
            files.insert(0, file_entry)
            project_entry["files"] = files[:MAX_RECENT_FILES]
            self._save_locked()
            return file_entry

    def remove_file(self, project_path: str, file_path: str) -> bool:
        normalized_file = self._normalize_file_path(file_path)
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.setdefault("projects", {})
            project_entry = projects.get(project_path)
            if not project_entry:
                return False
            files: List[Dict[str, object]] = project_entry.get("files") or []
            new_files = [entry for entry in files if entry.get("path") != normalized_file]
            if len(new_files) == len(files):
                return False
            project_entry["files"] = new_files
            self._save_locked()
            return True

    def list_projects(self) -> List[Dict[str, object]]:
        with self._lock:
            return list(self._data.get("recent_projects", []))

    def list_files(self, project_path: str) -> List[Dict[str, object]]:
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.get("projects", {})
            entry = projects.get(project_path)
            if not entry:
                return []
            return list(entry.get("files") or [])
