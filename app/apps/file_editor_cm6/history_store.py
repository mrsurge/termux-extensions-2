from __future__ import annotations

import json
import threading
import os
import hashlib
import tempfile
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
    """Persist recent project/file history and editor session cache."""

    def __init__(self, storage_path: Optional[Path] = None) -> None:
        default_root = Path.home() / ".local" / "share" / "termux-extensions-2"
        default_root.mkdir(parents=True, exist_ok=True)
        self._path = storage_path or (default_root / "code_oss_history.json")
        self._session_cache_dir = Path.home() / ".cache" / "cm6_sessions"
        self._session_cache_dir.mkdir(parents=True, exist_ok=True)

        _ensure_dir(self._path)
        self._lock = threading.Lock()
        self._data: Dict[str, object] = {
            "recent_projects": [],
            "projects": {},
            "active_project": None,
            "session_state": {},
            "session_cache": {},
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
                self._data["active_project"] = data.get("active_project")
                self._data["session_state"] = data.get("session_state", {})
                # Session cache is primarily stored in sidecars, but we can load keys here
                self._data["session_cache"] = data.get("session_cache", {})
                for entry in self._data["projects"].values():
                    if isinstance(entry, dict):
                        entry.setdefault("diff_base", "HEAD")
        except Exception:
            # Corrupt or unreadable history; start fresh.
            self._data = {"recent_projects": [], "projects": {}, "active_project": None, "session_state": {}, "session_cache": {}}

    def _save_locked(self) -> None:
        tmp_path = self._path.with_suffix(".tmp")
        try:
            # Do not persist the full content in the main history file
            data_to_save = dict(self._data)
            if "session_cache" in data_to_save:
                data_to_save["session_cache"] = {k: {"updated_at": v.get("updated_at")} for k, v in self._data["session_cache"].items()}

            tmp_path.write_text(json.dumps(data_to_save, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_path.replace(self._path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    # ----- internal helpers ----------------------------------------------------

    def _normalize_project_path(self, project_path: str) -> str:
        try:
            # Force resolve to handle trailing slashes, symlinks, etc.
            return str(Path(project_path).expanduser().resolve(strict=False))
        except Exception:
            return project_path.strip()

    def _touch_project_locked(self, path: str) -> Dict[str, object]:
        # path is assumed to be normalized by caller
        projects: Dict[str, Dict[str, object]] = self._data.setdefault("projects", {})
        project_entry = projects.get(path)
        if not project_entry:
            project_entry = {"files": [], "last_file": None}
        else:
            project_entry.setdefault("files", [])
            project_entry.setdefault("last_file", None)
            project_entry.setdefault("diff_base", "HEAD")
        project_entry.setdefault("diff_base", "HEAD")
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

    # ----- session cache helpers (new) ---------------------------------------

    def _normalize_cache_key(self, project_path: str, file_path: str) -> str:
        """Generate normalized cache key for session storage."""
        try:
            norm_project = str(Path(project_path).expanduser().resolve(strict=False))
            norm_file = str(Path(file_path).expanduser().resolve(strict=False))
            combined = f"{norm_project}::{norm_file}"
            return hashlib.sha1(combined.encode('utf-8')).hexdigest()
        except Exception:
            combined = f"{project_path}::{file_path}"
            return hashlib.sha1(combined.encode('utf-8')).hexdigest()

    def _get_sidecar_path(self, cache_key: str) -> Path:
        return self._session_cache_dir / f"{cache_key}.json"

    def _write_sidecar(self, cache_key: str, entry: Dict[str, object]) -> None:
        """Atomically write a session cache entry to a sidecar file."""
        final_path = self._get_sidecar_path(cache_key)
        try:
            with tempfile.NamedTemporaryFile(
                mode='w',
                encoding='utf-8',
                dir=self._session_cache_dir,
                delete=False,
                prefix=f"{cache_key}.",
                suffix=".tmp"
            ) as tmp_file:
                tmp_path = Path(tmp_file.name)
                json.dump(entry, tmp_file, ensure_ascii=False, indent=2)
                tmp_file.flush()
                os.fsync(tmp_file.fileno())
            
            os.replace(tmp_path, final_path)
        finally:
            if 'tmp_path' in locals() and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def _read_sidecar(self, cache_key: str) -> Optional[Dict[str, object]]:
        """Read a session cache entry from its sidecar file."""
        sidecar_path = self._get_sidecar_path(cache_key)
        if not sidecar_path.exists():
            return None
        try:
            content = sidecar_path.read_text(encoding='utf-8')
            return json.loads(content)
        except Exception:
            return None

    def _delete_sidecar(self, cache_key: str) -> None:
        """Delete a session cache sidecar file."""
        sidecar_path = self._get_sidecar_path(cache_key)
        sidecar_path.unlink(missing_ok=True)

    # ----- public API ----------------------------------------------------------

    def touch_project(self, project_path: str) -> Dict[str, object]:
        normalized = self._normalize_project_path(project_path)
        with self._lock:
            entry = self._touch_project_locked(normalized)
            self._save_locked()
            return {
                "path": normalized,
                "label": entry["label"],
                "opened_at": entry["opened_at"],
            }

    def touch_file(self, project_path: str, file_path: str) -> Dict[str, object]:
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path)
        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
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
        project_entry["last_file"] = normalized_file
        self._save_locked()
        return file_entry

    def remove_file(self, project_path: str, file_path: str) -> bool:
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path)
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.setdefault("projects", {})
            project_entry = projects.get(normalized_project)
            if not project_entry:
                return False
            files: List[Dict[str, object]] = project_entry.get("files") or []
            new_files = [entry for entry in files if entry.get("path") != normalized_file]
            if len(new_files) == len(files):
                return False
            project_entry["files"] = new_files
            if project_entry.get("last_file") == normalized_file:
                project_entry["last_file"] = new_files[0]["path"] if new_files else None
            self._save_locked()
            return True

    def clear_all_files(self, project_path: str) -> bool:
        """Clear all recent files for a project."""
        normalized_project = self._normalize_project_path(project_path)
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.setdefault("projects", {})
            project_entry = projects.get(normalized_project)
            if not project_entry:
                return False
            project_entry["files"] = []
            project_entry["last_file"] = None
            self._save_locked()
            return True

    def list_projects(self) -> List[Dict[str, object]]:
        with self._lock:
            return list(self._data.get("recent_projects", []))

    def list_files(self, project_path: str) -> List[Dict[str, object]]:
        normalized_project = self._normalize_project_path(project_path)
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.get("projects", {})
            entry = projects.get(normalized_project)
            if not entry:
                return []
            return list(entry.get("files") or [])

    # ----- state helpers -------------------------------------------------------

    def set_active_project(self, project_path: Optional[str]) -> Optional[str]:
        normalized = self._normalize_project_path(project_path) if project_path else None
        with self._lock:
            if normalized:
                self._touch_project_locked(normalized)
            self._data["active_project"] = normalized
            self._save_locked()
            return normalized

    def get_active_project(self) -> Optional[str]:
        with self._lock:
            return self._data.get("active_project")

    def set_terminal_shell_id(self, shell_id: Optional[str]) -> Optional[str]:
        """Store the current terminal shell ID."""
        with self._lock:
            self._data["terminal_shell_id"] = shell_id
            self._save_locked()
            return shell_id

    def get_terminal_shell_id(self) -> Optional[str]:
        """Get the stored terminal shell ID."""
        with self._lock:
            return self._data.get("terminal_shell_id")

    def set_last_file(self, project_path: str, file_path: Optional[str]) -> Optional[str]:
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path) if file_path else None
        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
            project_entry["last_file"] = normalized_file
            if normalized_file:
                files: List[Dict[str, object]] = project_entry.setdefault("files", [])
                files = [entry for entry in files if entry.get("path") != normalized_file]
                timestamp = _utc_timestamp()
                files.insert(
                    0,
                    {
                        "path": normalized_file,
                        "label": _project_label(normalized_file),
                        "opened_at": timestamp,
                    },
                )
                project_entry["files"] = files[:MAX_RECENT_FILES]
            self._save_locked()
            return normalized_file

    def get_last_file(self, project_path: Optional[str]) -> Optional[str]:
        if not project_path:
            return None
        normalized_project = self._normalize_project_path(project_path)
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.get("projects", {})
            entry = projects.get(normalized_project)
            if not entry:
                return None
            return entry.get("last_file")

    def set_diff_base(self, project_path: str, ref: Optional[str]) -> str:
        normalized_project = self._normalize_project_path(project_path)
        value = (ref or 'HEAD').strip() or 'HEAD'
        timestamp = datetime.utcnow().strftime('%H:%M:%S.%f')[:-3]
        print(f"[{timestamp}] [HistoryStore] set_diff_base project={normalized_project!r} ref={value!r}", flush=True)
        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
            project_entry["diff_base"] = value
            self._save_locked()
            return value

    def get_diff_base(self, project_path: Optional[str]) -> str:
        if not project_path:
            return 'HEAD'
        normalized_project = self._normalize_project_path(project_path)
        timestamp = datetime.utcnow().strftime('%H:%M:%S.%f')[:-3]
        # print(f"[{timestamp}] [HistoryStore] get_diff_base project={normalized_project!r}", flush=True)
        with self._lock:
            projects: Dict[str, Dict[str, object]] = self._data.get("projects", {})
            entry = projects.get(normalized_project)
            if not entry:
                print(f"[{timestamp}] [HistoryStore] get_diff_base entry NOT FOUND for {normalized_project!r}", flush=True)
                return 'HEAD'
            val = (entry.get("diff_base") or 'HEAD').strip() or 'HEAD'
            print(f"[{timestamp}] [HistoryStore] get_diff_base found {val!r} for {normalized_project!r}", flush=True)
            return val

    def record_file_activity(self, project_path: str, file_path: str) -> Dict[str, object]:
        normalized_project = self._normalize_project_path(project_path)
        normalized_file = self._normalize_file_path(file_path)
        with self._lock:
            project_entry = self._touch_project_locked(normalized_project)
            project_entry["last_file"] = normalized_file
            files: List[Dict[str, object]] = project_entry.setdefault("files", [])
            files = [entry for entry in files if entry.get("path") != normalized_file]
            timestamp = _utc_timestamp()
            entry = {
                "path": normalized_file,
                "label": _project_label(normalized_file),
                "opened_at": timestamp,
            }
            files.insert(0, entry)
            project_entry["files"] = files[:MAX_RECENT_FILES]
            self._save_locked()
            return entry

    @staticmethod
    def format_label(path: Optional[str]) -> str:
        if not path:
            return ""
        return _project_label(path)

    # ----- session state helpers ---------------------------------------------

    def get_session_state(self) -> Dict[str, object]:
        with self._lock:
            state = self._data.get("session_state") or {}
            return dict(state)

    def update_session_state(self, partial: Optional[Dict[str, object]]) -> Dict[str, object]:
        payload = partial or {}
        with self._lock:
            state: Dict[str, object] = self._data.setdefault("session_state", {})
            state.update(payload)
            state["updated_at"] = _utc_timestamp()
            self._save_locked()
            return dict(state)

    # ----- session cache public API (new) ------------------------------------

    def get_cached_document(self, project_path: str, file_path: str) -> Optional[Dict[str, object]]:
        """Retrieve cached session for a document from its sidecar file."""
        cache_key = self._normalize_cache_key(project_path, file_path)
        with self._lock:
            cache: Dict[str, Dict] = self._data.setdefault("session_cache", {})
            # Read from sidecar, which is the source of truth
            entry = self._read_sidecar(cache_key)
            if entry:
                cache[cache_key] = entry  # Update in-memory copy
                return dict(entry)
            elif cache_key in cache:
                # Entry is in memory but not on disk; must have been deleted. Clean up.
                del cache[cache_key]
                self._save_locked()
        return None

    def upsert_cached_document(
        self,
        project_path: str,
        file_path: str,
        content: str,
        base_sha256: str,
        run_id: str,
        shell_id: str,
        shell_run_id: str,
        launcher_pid: int,
        worker_pid: int,
    ) -> Dict[str, object]:
        """Update or insert cached session entry and write to sidecar."""
        cache_key = self._normalize_cache_key(project_path, file_path)
        content_sha256 = hashlib.sha256(content.encode('utf-8')).hexdigest()
        unsaved = (content_sha256 != base_sha256)

        entry = {
            "content": content,
            "content_length": len(content),
            "content_sha256": content_sha256,
            "base_sha256": base_sha256,
            "unsaved": unsaved,
            "run_id": run_id,
            "shell_id": shell_id,
            "shell_run_id": shell_run_id,
            "launcher_pid": launcher_pid,
            "worker_pid": worker_pid,
            "updated_at": _utc_timestamp(),
        }

        with self._lock:
            self._write_sidecar(cache_key, entry)
            cache: Dict[str, Dict] = self._data.setdefault("session_cache", {})
            cache[cache_key] = entry
            self._save_locked()
            return dict(entry)

    def clear_cached_document(self, project_path: str, file_path: str) -> bool:
        """Remove cached session entry and its sidecar file."""
        cache_key = self._normalize_cache_key(project_path, file_path)
        with self._lock:
            self._delete_sidecar(cache_key)
            cache: Dict[str, Dict] = self._data.setdefault("session_cache", {})
            existed = cache_key in cache
            if existed:
                del cache[cache_key]
                self._save_locked()
            return existed

    def list_cached_documents(self, project_path: Optional[str] = None) -> List[Dict[str, object]]:
        """List all cached sessions, optionally filtered by project."""
        # This is a stub for future phases. For now, it lists what's in memory.
        with self._lock:
            cache: Dict[str, Dict] = self._data.get("session_cache", {})
            results = []
            for cache_key, entry in cache.items():
                # In a real implementation, we'd need to store project/file path with the entry
                # For now, this is non-functional as we only have the key.
                # This is acceptable for Phase 1.
                pass
            return results
