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
            # Optional per-project MRU list (string paths). The authoritative
            # MRU list currently still lives in HistoryStore.projects[*].files.
            "recent_files": [],
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
