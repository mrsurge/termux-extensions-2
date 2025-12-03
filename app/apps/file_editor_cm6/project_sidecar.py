from __future__ import annotations

import json
import hashlib
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, ClassVar


def _utc_timestamp() -> str:
    """Return current UTC timestamp in ISO 8601 format with Z suffix."""
    return datetime.utcnow().isoformat() + "Z"


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _normalize_project_path(project_path: str) -> str:
    try:
        return str(Path(project_path).expanduser().resolve(strict=False))
    except Exception:
        return project_path.strip()


def _normalize_file_path(file_path: str) -> str:
    try:
        return str(Path(file_path).expanduser().resolve(strict=False))
    except Exception:
        return file_path


def _make_file_cache_key(project_path: str, file_path: str) -> str:
    """Deterministic cache key for a (project, file) pair."""
    try:
        norm_project = _normalize_project_path(project_path)
        norm_file = _normalize_file_path(file_path)
        combined = f"{norm_project}::{norm_file}"
    except Exception:
        combined = f"{project_path}::{file_path}"
    return hashlib.sha1(combined.encode("utf-8")).hexdigest()


def _sidecar_root() -> Path:
    """Return root directory for per-project sidecars."""
    root = Path.home() / ".cache" / "cm6_editor" / "projects"
    _ensure_dir(root)
    return root


@dataclass
class ProjectSidecar:
    """Per-project state sidecar persisted under ~/.cache/cm6_editor/projects/.

    This encapsulates editor state that must be scoped to a single project path:
    - session_count: detects fresh starts after project switches
    - diff_base: git diff base ref for this project
    - session_cache: per-file draft content and crash recovery metadata
    - tracked_jobs: background job IDs associated with this project
    - recent_files: optional per-project MRU list (not yet widely used)
    """

    project_path: str
    VERSION: int = 1

    _path: Path = field(init=False, repr=False)
    _data: Dict[str, Any] = field(init=False, repr=False)

    # In-memory cache of instances keyed by normalized project path.
    _instances: ClassVar[Dict[str, "ProjectSidecar"]] = {}

    def __post_init__(self) -> None:
        normalized = _normalize_project_path(self.project_path)
        self.project_path = normalized
        self._path = self.get_sidecar_path(self.project_path)
        self._data = self._default_data()
        self._load()

    # --------------------------------------------------------------------- #
    # Construction helpers
    # --------------------------------------------------------------------- #

    @staticmethod
    def get_sidecar_path(project_path: str) -> Path:
        normalized = _normalize_project_path(project_path)
        hash_key = hashlib.sha1(normalized.encode("utf-8")).hexdigest()
        return _sidecar_root() / f"{hash_key}.json"

    @classmethod
    def load_or_create(cls, project_path: str) -> "ProjectSidecar":
        """Return a cached instance for project_path, creating if needed."""
        normalized = _normalize_project_path(project_path)
        existing = cls._instances.get(normalized)
        if existing is not None:
            return existing
        instance = cls(normalized)
        cls._instances[normalized] = instance
        return instance

    def _default_data(self) -> Dict[str, Any]:
        return {
            "version": self.VERSION,
            "project_path": self.project_path,
            "session_count": 0,
            "created_at": _utc_timestamp(),
            "last_boot_at": None,
            # Git diff base state for this project. We store only the ref here;
            # commit metadata is derived on demand from git when needed.
            "diff_base": {"ref": "HEAD", "commit_sha": None},
            # Map[file_cache_key] -> cache_entry
            "session_cache": {},
            # Background job IDs associated with this project
            "tracked_jobs": [],
            # Per-project MRU list. This is now the SSOT for recent files.
            "recent_files": [],
            # Last opened file for this project (SSOT).
            "last_file": None,
        }

    # --------------------------------------------------------------------- #
    # Persistence
    # --------------------------------------------------------------------- #

    def _load(self) -> None:
        """Load existing sidecar data from disk, if present."""
        if not self._path.exists():
            return
        try:
            raw = self._path.read_text(encoding="utf-8")
            if not raw.strip():
                return
            data = json.loads(raw)
            if not isinstance(data, dict):
                return
        except Exception:
            # Corrupt or unreadable sidecar; treat as fresh.
            return

        # Versioned merge: overlay persisted data onto defaults.
        defaults = self._default_data()
        for key, value in data.items():
            if key in defaults:
                defaults[key] = value
        # Always trust the normalized project_path we were constructed with.
        defaults["project_path"] = self.project_path
        self._data = defaults

    def save(self) -> None:
        """Atomically persist current sidecar state to disk."""
        _ensure_dir(self._path.parent)
        tmp_path: Optional[Path] = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=str(self._path.parent),
                delete=False,
                prefix=self._path.name + ".",
                suffix=".tmp",
            ) as tmp_file:
                tmp_path = Path(tmp_file.name)
                json.dump(self._data, tmp_file, ensure_ascii=False, indent=2)
                tmp_file.flush()
                os.fsync(tmp_file.fileno())
            os.replace(tmp_path, self._path)
        finally:
            if tmp_path is not None and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    # --------------------------------------------------------------------- #
    # Session counter API
    # --------------------------------------------------------------------- #

    def increment_session(self) -> None:
        """Increment session counter and update last_boot_at."""
        self._data["session_count"] = int(self._data.get("session_count") or 0) + 1
        self._data["last_boot_at"] = _utc_timestamp()

    @property
    def session_count(self) -> int:
        return int(self._data.get("session_count") or 0)

    @session_count.setter
    def session_count(self, value: int) -> None:
        self._data["session_count"] = int(value)

    # --------------------------------------------------------------------- #
    # Diff base API
    # --------------------------------------------------------------------- #

    def get_diff_base(self) -> str:
        diff_base = self._data.get("diff_base") or {}
        ref = (diff_base.get("ref") or "HEAD").strip() or "HEAD"
        return ref

    def set_diff_base(self, ref: Optional[str]) -> str:
        value = (ref or "HEAD").strip() or "HEAD"
        diff_base = self._data.setdefault("diff_base", {})
        diff_base["ref"] = value
        # commit_sha is intentionally left to git helper code; keep as-is.
        return value

    # --------------------------------------------------------------------- #
    # Session cache API
    # --------------------------------------------------------------------- #

    def get_cached_document(self, file_path: str) -> Optional[Dict[str, Any]]:
        """Return cached draft entry for file_path, if any."""
        cache_key = _make_file_cache_key(self.project_path, file_path)
        cache: Dict[str, Dict[str, Any]] = self._data.setdefault("session_cache", {})
        entry = cache.get(cache_key)
        if not entry:
            return None
        # Return a shallow copy to prevent accidental mutation.
        return dict(entry)

    def upsert_cached_document(
        self,
        file_path: str,
        content: str,
        base_sha256: str,
        run_id: str,
        shell_id: str,
        shell_run_id: str,
        launcher_pid: int,
        worker_pid: int,
    ) -> Dict[str, Any]:
        """Insert/update draft cache entry for file_path."""
        cache_key = _make_file_cache_key(self.project_path, file_path)
        cache: Dict[str, Dict[str, Any]] = self._data.setdefault("session_cache", {})

        content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
        unsaved = content_sha256 != base_sha256

        entry = {
            "project_path": self.project_path,
            "file_path": _normalize_file_path(file_path),
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

        cache[cache_key] = entry
        return dict(entry)

    def clear_cached_document(self, file_path: str) -> bool:
        """Remove cached draft (if any) for file_path."""
        cache_key = _make_file_cache_key(self.project_path, file_path)
        cache: Dict[str, Dict[str, Any]] = self._data.setdefault("session_cache", {})
        existed = cache_key in cache
        if existed:
            cache.pop(cache_key, None)
        return existed

    def list_project_drafts(self) -> List[Dict[str, Any]]:
        """Return list of unsaved draft entries for this project."""
        cache: Dict[str, Dict[str, Any]] = self._data.get("session_cache") or {}
        results: List[Dict[str, Any]] = []
        for entry in cache.values():
            try:
                if entry.get("unsaved"):
                    results.append(dict(entry))
            except Exception:
                continue
        return results

    def clear_session_cache(self) -> None:
        self._data["session_cache"] = {}

    # --------------------------------------------------------------------- #
    # Job tracking API
    # --------------------------------------------------------------------- #

    def add_tracked_job(self, job_id: str) -> None:
        jobs: List[str] = self._data.setdefault("tracked_jobs", [])
        if job_id not in jobs:
            jobs.append(job_id)

    def remove_tracked_job(self, job_id: str) -> None:
        jobs: List[str] = self._data.setdefault("tracked_jobs", [])
        if job_id in jobs:
            jobs.remove(job_id)

    def clear_tracked_jobs(self) -> None:
        self._data["tracked_jobs"] = []

    @property
    def last_boot_at(self) -> Optional[str]:
        return self._data.get("last_boot_at")

    # --------------------------------------------------------------------- #
    # Recent files / MRU API (Phase 5 migration)
    # --------------------------------------------------------------------- #

    def _file_label(self, file_path: str) -> str:
        """Extract basename as label for a file path."""
        try:
            return Path(file_path).name or file_path
        except Exception:
            return file_path

    def record_file_activity(self, file_path: str, scroll_line: Optional[float] = None) -> Dict[str, Any]:
        """Record file open, updating last_file and recent_files list (LRU).
        
        Args:
            file_path: The file being opened/accessed.
            scroll_line: Optional scroll position (line number) to persist for this file.
        """
        normalized = _normalize_file_path(file_path)
        timestamp = _utc_timestamp()
        
        # Update last_file
        self._data["last_file"] = normalized
        
        # Update recent_files (LRU, capped at 12)
        recent: List[Dict[str, Any]] = self._data.setdefault("recent_files", [])
        
        # Find existing entry to preserve its scroll_line if not provided
        existing_scroll = None
        for e in recent:
            if e.get("path") == normalized:
                existing_scroll = e.get("scroll_line")
                break
        
        # Remove existing entry for this file
        recent = [e for e in recent if e.get("path") != normalized]
        
        # Build new entry, preserving scroll_line if not explicitly provided
        entry = {
            "path": normalized,
            "label": self._file_label(normalized),
            "opened_at": timestamp,
        }
        # Use provided scroll_line, or preserve existing, or omit
        effective_scroll = scroll_line if scroll_line is not None else existing_scroll
        if effective_scroll is not None:
            entry["scroll_line"] = effective_scroll
        
        recent.insert(0, entry)
        # Cap at 12 entries
        self._data["recent_files"] = recent[:12]
        
        return entry

    def update_file_scroll_line(self, file_path: str, scroll_line: float) -> bool:
        """Update the scroll_line for a specific file in recent_files.
        
        Returns True if the file was found and updated.
        """
        normalized = _normalize_file_path(file_path)
        recent: List[Dict[str, Any]] = self._data.get("recent_files") or []
        
        for entry in recent:
            if entry.get("path") == normalized:
                entry["scroll_line"] = scroll_line
                return True
        return False

    def get_file_scroll_line(self, file_path: str) -> Optional[float]:
        """Get the stored scroll_line for a specific file.
        
        Returns None if file not found or no scroll_line stored.
        """
        normalized = _normalize_file_path(file_path)
        recent: List[Dict[str, Any]] = self._data.get("recent_files") or []
        
        for entry in recent:
            if entry.get("path") == normalized:
                return entry.get("scroll_line")
        return None

    def get_last_file(self) -> Optional[str]:
        """Return the last opened file path for this project."""
        return self._data.get("last_file")

    def set_last_file(self, file_path: Optional[str]) -> Optional[str]:
        """Set the last opened file path for this project."""
        if file_path:
            normalized = _normalize_file_path(file_path)
            self._data["last_file"] = normalized
            return normalized
        else:
            self._data["last_file"] = None
            return None

    def list_recent_files(self) -> List[Dict[str, Any]]:
        """Return list of recent files for this project."""
        recent: List[Dict[str, Any]] = self._data.get("recent_files") or []
        return [dict(e) for e in recent]

    def clear_recent_files(self) -> None:
        """Clear the recent files list and last_file."""
        self._data["recent_files"] = []
        self._data["last_file"] = None

    def get_draft_count(self) -> int:
        """Return count of unsaved drafts for this project."""
        cache: Dict[str, Dict[str, Any]] = self._data.get("session_cache") or {}
        return sum(1 for e in cache.values() if e.get("unsaved"))


def clear_project_state(project_path: str) -> bool:
    """Delete the project sidecar entirely (manual nuclear option).

    Returns True if a sidecar file was removed.
    """
    path = ProjectSidecar.get_sidecar_path(project_path)
    if path.exists():
        path.unlink()
        return True
    return False


def cleanup_orphaned_sidecars() -> None:
    """Remove sidecars for projects that no longer exist on disk."""
    root = _sidecar_root()
    if not root.exists():
        return

    for sidecar_file in root.glob("*.json"):
        try:
            raw = sidecar_file.read_text(encoding="utf-8")
            if not raw.strip():
                continue
            data = json.loads(raw)
            if not isinstance(data, dict):
                continue
            project_path = data.get("project_path")
            if project_path and not Path(project_path).exists():
                sidecar_file.unlink()
        except Exception:
            # Corrupt sidecar; leave it for manual inspection.
            continue
