from __future__ import annotations

import json
import hashlib
import os
import secrets
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
    VERSION: int = 2

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

    @staticmethod
    def sidecar_exists(project_path: str) -> bool:
        try:
            return ProjectSidecar.get_sidecar_path(project_path).exists()
        except Exception:
            return False

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
            # Open directories in explorer tree (persisted across reloads).
            "open_directories": [],
            # Legacy single terminal framework shell id (kept for lazy migration).
            "terminal_shell_id": None,
            # Ordered list of terminal framework shell ids for this project.
            "terminal_shell_ids": [],
            # Currently active terminal framework shell id for this project.
            "active_terminal_shell_id": None,
            # Cap for number of stored terminal shells per project.
            "terminal_shell_cap": 5,
            # Optional per-shell titles (fs-id -> short label) for terminal dropdown.
            "terminal_shell_titles": {},
            # LSP configuration (project-scoped SSOT).
            "lsp": {
                "enabled": False,
                "servers": {
                    "pyright": False,
                    "typescript": False,
                    "clangd": False,
                    "kotlin": False,
                },
            },
            # Cached diagnostics summary (project-scoped SSOT) used by the explorer
            # for file-level warning/error dots. This is intentionally lightweight:
            # only counts, not full diagnostics payloads.
            "diagnostics_cache": {
                "pyright": {
                    "summaryByRel": {},
                    "updatedAt": None,
                    "effectiveRoot": None,
                    "repoFingerprint": None,
                }
            },
            # Workbench extension-host state (project-scoped SSOT).
            "workbench_extensions": {
                # List[str] of globally-installed extension ids enabled for this project.
                # Format: "publisher.name"
                "enabled_extensions": [],
            },
            # File watcher configuration (project-scoped SSOT).
            "watcher": {
                # "ipc" (VS Code IPC, default) | "watchexec" (poll fallback) | "none" (lazy/manual)
                "mode": "ipc",
                # Storage type determines poll interval: "ssd" → 1500ms, "hdd" → 4500ms
                "storage_type": "ssd",
                # Explicit poll interval in ms (derived from storage_type by default)
                "poll_interval_ms": 1500,
            },
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

        # Versioned merge: on mismatch, wipe drafts (session_cache) and avoid migrations.
        loaded_version = data.get("version")
        defaults = self._default_data()
        if loaded_version != self.VERSION:
            for key, value in data.items():
                if key in defaults and key != "session_cache":
                    defaults[key] = value
            defaults["version"] = self.VERSION
            defaults["project_path"] = self.project_path
            defaults["session_cache"] = {}
            self._data = defaults
            try:
                self.save()
            except Exception:
                pass
            return

        for key, value in data.items():
            if key in defaults:
                defaults[key] = value
        # Always trust the normalized project_path we were constructed with.
        defaults["project_path"] = self.project_path
        defaults["version"] = self.VERSION
        self._data = defaults

    def reload(self) -> None:
        """Re-read sidecar data from disk (picks up cross-process writes)."""
        self._data = self._default_data()
        self._load()

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

    def dump_raw(self) -> Dict[str, Any]:
        """Return the raw in-memory sidecar state (debug endpoint helper)."""
        try:
            return json.loads(json.dumps(self._data, ensure_ascii=False, default=str))
        except Exception:
            return {"error": "failed_to_dump", "repr": repr(self._data)}

    # --------------------------------------------------------------------- #
    # Diagnostics cache API (explorer dots)
    # --------------------------------------------------------------------- #

    def get_pyright_diagnostics_summary(self) -> Dict[str, Dict[str, int]]:
        """Return cached {rel: {errors, warnings}} for Pyright, if available."""
        try:
            dc = self._data.get("diagnostics_cache") or {}
            py = dc.get("pyright") or {}
            summary = py.get("summaryByRel") or {}
            if not isinstance(summary, dict):
                return {}
            out: Dict[str, Dict[str, int]] = {}
            for rel, counts in summary.items():
                if not isinstance(rel, str) or not rel:
                    continue
                if not isinstance(counts, dict):
                    continue
                e = int(counts.get("errors") or 0)
                w = int(counts.get("warnings") or 0)
                if e <= 0 and w <= 0:
                    continue
                out[rel] = {"errors": e, "warnings": w}
            return out
        except Exception:
            return {}

    def set_pyright_diagnostics_summary(
        self,
        *,
        summary_by_rel: Dict[str, Dict[str, int]],
        updated_at: Optional[str] = None,
        effective_root: Optional[str] = None,
        repo_fingerprint: Optional[str] = None,
    ) -> None:
        dc = self._data.setdefault("diagnostics_cache", {})
        if not isinstance(dc, dict):
            dc = {}
            self._data["diagnostics_cache"] = dc
        py = dc.setdefault("pyright", {})
        if not isinstance(py, dict):
            py = {}
            dc["pyright"] = py

        # Store as-is (counts only); normalize in getter.
        py["summaryByRel"] = summary_by_rel if isinstance(summary_by_rel, dict) else {}
        py["updatedAt"] = updated_at or _utc_timestamp()
        py["effectiveRoot"] = str(effective_root) if effective_root else None
        py["repoFingerprint"] = str(repo_fingerprint) if repo_fingerprint else None

    def pop_pyright_diagnostics_rel(self, rel_path: str) -> None:
        """Remove a cached pyright summary entry for a rel path (best-effort)."""
        try:
            rel = str(rel_path or "").strip()
            if not rel or rel == ".":
                return
            dc = self._data.get("diagnostics_cache") or {}
            py = dc.get("pyright") or {}
            sb = py.get("summaryByRel") or {}
            if isinstance(sb, dict):
                sb.pop(rel, None)
        except Exception:
            return

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

    def prune_clean_drafts(self) -> int:
        """Remove cached draft entries that are explicitly marked unsaved == False."""
        cache: Dict[str, Dict[str, Any]] = self._data.get("session_cache") or {}
        if not cache:
            return 0
        to_remove = []
        for key, entry in cache.items():
            try:
                if entry.get("unsaved") is False:
                    to_remove.append(key)
            except Exception:
                continue
        for key in to_remove:
            cache.pop(key, None)
        return len(to_remove)

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

    def list_tracked_jobs(self) -> List[str]:
        jobs = self._data.get("tracked_jobs") or []
        if not isinstance(jobs, list):
            return []
        out: List[str] = []
        for job_id in jobs:
            if isinstance(job_id, str) and job_id:
                out.append(job_id)
        return out

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
        entry: Dict[str, Any] = {
            "path": normalized,
            "label": self._file_label(normalized),
            "opened_at": timestamp,
        }
        # Use provided scroll_line, or preserve existing, or omit.
        # Coerce to int so stored type is stable (CM can report fractional line positions).
        effective_scroll = scroll_line if scroll_line is not None else existing_scroll
        if effective_scroll is not None:
            try:
                entry["scroll_line"] = int(effective_scroll)
            except Exception:
                pass
        
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
                try:
                    entry["scroll_line"] = int(scroll_line)
                except Exception:
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

    # --------------------------------------------------------------------- #
    # Open directories API (explorer tree state)
    # --------------------------------------------------------------------- #

    def get_open_directories(self) -> List[str]:
        """Return list of open directory rel paths in explorer tree."""
        dirs: List[str] = self._data.get("open_directories") or []
        return list(dirs)

    def set_open_directories(self, dirs: List[str]) -> None:
        """Set the list of open directory rel paths in explorer tree."""
        # Normalize and deduplicate, preserving order
        seen: set = set()
        normalized: List[str] = []
        for d in dirs:
            if d and d not in seen:
                seen.add(d)
                normalized.append(d)
        self._data["open_directories"] = normalized

    def add_open_directory(self, rel: str) -> None:
        """Add a directory to the open list (if not already present)."""
        if not rel:
            return
        dirs: List[str] = self._data.setdefault("open_directories", [])
        if rel not in dirs:
            dirs.append(rel)

    def remove_open_directory(self, rel: str) -> None:
        """Remove a directory from the open list."""
        if not rel:
            return
        dirs: List[str] = self._data.get("open_directories") or []
        if rel in dirs:
            dirs.remove(rel)
            self._data["open_directories"] = dirs

    # --------------------------------------------------------------------- #
    # Terminal shell ID (per-project)
    # --------------------------------------------------------------------- #

    def _migrate_terminal_legacy(self) -> None:
        """Ensure multi-shell fields exist and migrate legacy single-shell slot."""
        if "terminal_shell_ids" not in self._data or not isinstance(self._data.get("terminal_shell_ids"), list):
            self._data["terminal_shell_ids"] = []
        if "active_terminal_shell_id" not in self._data:
            self._data["active_terminal_shell_id"] = None
        if "terminal_shell_cap" not in self._data or not isinstance(self._data.get("terminal_shell_cap"), int):
            self._data["terminal_shell_cap"] = 5
        if "terminal_shell_titles" not in self._data or not isinstance(self._data.get("terminal_shell_titles"), dict):
            self._data["terminal_shell_titles"] = {}

        legacy = self._data.get("terminal_shell_id")
        ids: List[str] = self._data.get("terminal_shell_ids") or []
        if legacy and legacy not in ids:
            ids.append(str(legacy))
            self._data["terminal_shell_ids"] = ids
        if legacy and not self._data.get("active_terminal_shell_id"):
            self._data["active_terminal_shell_id"] = str(legacy)
        if legacy and ("terminal_shell_id" in self._data):
            # Clear legacy slot once migrated to avoid cross-field drift.
            self._data["terminal_shell_id"] = None

    def get_terminal_shell_ids(self) -> List[str]:
        """Return ordered terminal shell ids for this project."""
        self._migrate_terminal_legacy()
        ids: List[str] = self._data.get("terminal_shell_ids") or []
        return [str(i) for i in ids if i]

    def add_terminal_shell_id(self, shell_id: str) -> str:
        """Append a shell id to the list, enforce cap, and mark active."""
        if not shell_id:
            return shell_id
        self._migrate_terminal_legacy()
        ids: List[str] = self._data.get("terminal_shell_ids") or []
        titles: Dict[str, str] = self._data.get("terminal_shell_titles") or {}
        sid = str(shell_id)
        if sid not in ids:
            ids.append(sid)
        cap = int(self._data.get("terminal_shell_cap") or 5)
        if cap > 0 and len(ids) > cap:
            # Trim oldest, but never drop the active/new shell.
            while len(ids) > cap and ids[0] != sid:
                removed = ids.pop(0)
                try:
                    titles.pop(str(removed), None)
                except Exception:
                    pass
        self._data["terminal_shell_ids"] = ids
        self._data["active_terminal_shell_id"] = sid
        # Mirror to legacy field for compatibility.
        self._data["terminal_shell_id"] = sid
        self._data["terminal_shell_titles"] = titles
        return sid

    def remove_terminal_shell_id(self, shell_id: str) -> Optional[str]:
        """Remove a shell id from the list. Adjust active if needed."""
        if not shell_id:
            return self.get_active_terminal_shell_id()
        self._migrate_terminal_legacy()
        ids: List[str] = self._data.get("terminal_shell_ids") or []
        titles: Dict[str, str] = self._data.get("terminal_shell_titles") or {}
        sid = str(shell_id)
        if sid in ids:
            ids.remove(sid)
        try:
            titles.pop(sid, None)
        except Exception:
            pass
        self._data["terminal_shell_ids"] = ids
        active = self._data.get("active_terminal_shell_id")
        if active == sid:
            active = ids[-1] if ids else None
            self._data["active_terminal_shell_id"] = active
        self._data["terminal_shell_id"] = active
        self._data["terminal_shell_titles"] = titles
        return str(active) if active else None

    def get_active_terminal_shell_id(self) -> Optional[str]:
        """Return active terminal shell id (fallback to newest)."""
        self._migrate_terminal_legacy()
        ids = self._data.get("terminal_shell_ids") or []
        active = self._data.get("active_terminal_shell_id")
        if active and active in ids:
            return str(active)
        if ids:
            newest = str(ids[-1])
            self._data["active_terminal_shell_id"] = newest
            self._data["terminal_shell_id"] = newest
            return newest
        return None

    def set_active_terminal_shell_id(self, shell_id: Optional[str]) -> Optional[str]:
        """Set active terminal shell id, ensuring membership in list."""
        self._migrate_terminal_legacy()
        if not shell_id:
            self._data["active_terminal_shell_id"] = None
            self._data["terminal_shell_id"] = None
            return None
        return self.add_terminal_shell_id(str(shell_id))

    def get_terminal_shell_id(self) -> Optional[str]:
        """Compatibility wrapper: return the active terminal shell id."""
        return self.get_active_terminal_shell_id()

    def set_terminal_shell_id(self, shell_id: Optional[str]) -> Optional[str]:
        """Compatibility wrapper: set active terminal shell id."""
        return self.set_active_terminal_shell_id(shell_id)

    def get_terminal_shell_title(self, shell_id: str) -> Optional[str]:
        """Return the optional terminal title for a shell id."""
        if not shell_id:
            return None
        self._migrate_terminal_legacy()
        titles: Dict[str, str] = self._data.get("terminal_shell_titles") or {}
        try:
            val = titles.get(str(shell_id))
        except Exception:
            val = None
        text = str(val).strip() if val else ""
        return text or None

    def set_terminal_shell_title(self, shell_id: str, title: Optional[str]) -> Optional[str]:
        """Set (or clear) the optional terminal title for a shell id."""
        if not shell_id:
            return None
        self._migrate_terminal_legacy()
        sid = str(shell_id)
        titles: Dict[str, str] = self._data.get("terminal_shell_titles") or {}
        text = str(title).strip() if title is not None else ""
        if not text:
            try:
                titles.pop(sid, None)
            except Exception:
                pass
            self._data["terminal_shell_titles"] = titles
            return None
        titles[sid] = text
        self._data["terminal_shell_titles"] = titles
        return text

    # --------------------------------------------------------------------- #
    # LSP configuration API (project-scoped SSOT)
    # --------------------------------------------------------------------- #

    def _ensure_lsp_schema(self) -> dict:
        lsp = self._data.get("lsp")
        if not isinstance(lsp, dict):
            lsp = {"enabled": False, "servers": {}, "roots": {}, "android": {}}
        lsp.setdefault("enabled", False)
        lsp.setdefault("project_id", "")
        lsp.setdefault("pyrightConfigMode", "root")
        android_cfg = lsp.get("android")
        if not isinstance(android_cfg, dict):
            android_cfg = {}
        kotlin_android = android_cfg.get("kotlin-android")
        if not isinstance(kotlin_android, dict):
            kotlin_android = {}
        kotlin_android.setdefault("module", "app")
        kotlin_android.setdefault("variant", "GeckoDebug")
        android_cfg["kotlin-android"] = kotlin_android
        lsp["android"] = android_cfg
        servers = lsp.get("servers")
        if not isinstance(servers, dict):
            servers = {}
        for key, default in (("pyright", False), ("typescript", False), ("clangd", False), ("kotlin", False), ("kotlin-android", False)):
            servers.setdefault(key, default)
        lsp["servers"] = servers

        roots = lsp.get("roots")
        if not isinstance(roots, dict):
            roots = {}
        for key in ("pyright", "typescript", "clangd", "kotlin", "kotlin-android"):
            val = roots.get(key)
            roots[key] = str(val).strip() if val else ""
        lsp["roots"] = roots

        self._data["lsp"] = lsp
        return lsp

    def get_lsp_pyright_config_mode(self) -> str:
        lsp = self._ensure_lsp_schema()
        mode = str(lsp.get("pyrightConfigMode") or "root").strip().lower()
        return "workers" if mode == "workers" else "root"

    def set_lsp_pyright_config_mode(self, mode: str) -> str:
        lsp = self._ensure_lsp_schema()
        text = str(mode or "").strip().lower()
        final = "workers" if text == "workers" else "root"
        lsp["pyrightConfigMode"] = final
        self._data["lsp"] = lsp
        return final

    def get_or_create_lsp_project_id(self) -> str:
        lsp = self._ensure_lsp_schema()
        val = lsp.get("project_id")
        text = str(val).strip() if val else ""
        if text:
            return text
        # 8 hex chars (32 bits) is plenty for per-user/per-device project IDs.
        pid = secrets.token_hex(4)
        lsp["project_id"] = pid
        self._data["lsp"] = lsp
        return pid

    def get_lsp_project_id(self) -> Optional[str]:
        lsp = self._ensure_lsp_schema()
        val = lsp.get("project_id")
        text = str(val).strip() if val else ""
        return text or None

    def get_lsp_enabled(self) -> bool:
        lsp = self._ensure_lsp_schema()
        return bool(lsp.get("enabled", False))

    def set_lsp_enabled(self, enabled: bool) -> bool:
        lsp = self._ensure_lsp_schema()
        lsp["enabled"] = bool(enabled)
        self._data["lsp"] = lsp
        return bool(lsp["enabled"])

    def get_lsp_server_enabled(self, server_id: str) -> bool:
        lsp = self._ensure_lsp_schema()
        servers = lsp.get("servers") or {}
        return bool(servers.get(str(server_id), False))

    def set_lsp_server_enabled(self, server_id: str, enabled: bool) -> bool:
        lsp = self._ensure_lsp_schema()
        servers = lsp.get("servers") or {}
        servers[str(server_id)] = bool(enabled)
        lsp["servers"] = servers
        self._data["lsp"] = lsp
        return bool(servers[str(server_id)])

    def get_lsp_server_root_rel(self, server_id: str) -> str:
        lsp = self._ensure_lsp_schema()
        roots = lsp.get("roots") or {}
        val = roots.get(str(server_id))
        text = str(val).strip() if val else ""
        return text

    def set_lsp_server_root_rel(self, server_id: str, root_rel: str) -> str:
        lsp = self._ensure_lsp_schema()
        roots = lsp.get("roots") or {}
        text = str(root_rel).strip() if root_rel else ""
        roots[str(server_id)] = text
        lsp["roots"] = roots
        self._data["lsp"] = lsp
        return text

    def get_lsp_kotlin_android_config(self) -> dict:
        lsp = self._ensure_lsp_schema()
        android_cfg = lsp.get("android") or {}
        cfg = android_cfg.get("kotlin-android")
        return cfg if isinstance(cfg, dict) else {"module": "app", "variant": "GeckoDebug"}

    def set_lsp_kotlin_android_config(self, *, module: str | None = None, variant: str | None = None) -> dict:
        lsp = self._ensure_lsp_schema()
        android_cfg = lsp.get("android")
        if not isinstance(android_cfg, dict):
            android_cfg = {}
        cfg = android_cfg.get("kotlin-android")
        if not isinstance(cfg, dict):
            cfg = {}
        if module is not None:
            cfg["module"] = str(module).strip() or "app"
        if variant is not None:
            cfg["variant"] = str(variant).strip() or "GeckoDebug"
        android_cfg["kotlin-android"] = cfg
        lsp["android"] = android_cfg
        self._data["lsp"] = lsp
        return cfg

    def get_lsp_state_payload(self) -> dict:
        lsp = self._ensure_lsp_schema()
        servers = lsp.get("servers") or {}
        roots = lsp.get("roots") or {}
        android_cfg = self.get_lsp_kotlin_android_config()
        return {
            "enableLsp": bool(lsp.get("enabled", False)),
            "enableLspPyright": bool(servers.get("pyright", False)),
            "enableLspTypescript": bool(servers.get("typescript", False)),
            "enableLspClangd": bool(servers.get("clangd", False)),
            "enableLspKotlin": bool(servers.get("kotlin", False)),
            "enableLspKotlinAndroid": bool(servers.get("kotlin-android", False)),
            "lspPyrightConfigMode": self.get_lsp_pyright_config_mode(),
            "lspRootRelPyright": str(roots.get("pyright") or ""),
            "lspRootRelTypescript": str(roots.get("typescript") or ""),
            "lspRootRelClangd": str(roots.get("clangd") or ""),
            "lspRootRelKotlin": str(roots.get("kotlin") or ""),
            "lspRootRelKotlinAndroid": str(roots.get("kotlin-android") or ""),
            "lspKotlinAndroidModule": str(android_cfg.get("module") or "app"),
            "lspKotlinAndroidVariant": str(android_cfg.get("variant") or "GeckoDebug"),
        }

    # --------------------------------------------------------------------- #
    # Workbench extension-host config (project-scoped SSOT)
    # --------------------------------------------------------------------- #

    def _ensure_workbench_extensions_schema(self) -> Dict[str, object]:
        cfg_obj = self._data.get("workbench_extensions")
        legacy_cfg_obj = self._data.get("vscode_api")
        if isinstance(cfg_obj, dict):
            cfg: Dict[str, object] = {str(key): value for key, value in cfg_obj.items() if isinstance(key, str)}
        elif isinstance(legacy_cfg_obj, dict):
            cfg = {str(key): value for key, value in legacy_cfg_obj.items() if isinstance(key, str)}
        else:
            cfg = {}
        raw_enabled = cfg.get("enabled_extensions")
        enabled = raw_enabled if isinstance(raw_enabled, list) else []
        # Normalize + de-dupe.
        normalized: List[str] = []
        seen: set[str] = set()
        for item in enabled:
            try:
                text = str(item).strip()
            except Exception:
                continue
            if not text or text in seen:
                continue
            seen.add(text)
            normalized.append(text)
        cfg["enabled_extensions"] = normalized
        self._data["workbench_extensions"] = cfg
        self._data.pop("vscode_api", None)
        return cfg

    def get_workbench_enabled_extensions(self) -> List[str]:
        cfg = self._ensure_workbench_extensions_schema()
        enabled = cfg.get("enabled_extensions")
        return list(enabled) if isinstance(enabled, list) else []

    def set_workbench_enabled_extensions(self, enabled: List[str]) -> List[str]:
        cfg = self._ensure_workbench_extensions_schema()
        normalized: List[str] = []
        try:
            for item in enabled or []:
                text = str(item).strip()
                if not text:
                    continue
                if text in normalized:
                    continue
                normalized.append(text)
        except Exception:
            pass
        cfg["enabled_extensions"] = normalized
        self._data["workbench_extensions"] = cfg
        self._data.pop("vscode_api", None)
        return self.get_workbench_enabled_extensions()

    def enable_workbench_extension(self, extension_id: str) -> List[str]:
        enabled = self.get_workbench_enabled_extensions()
        text = str(extension_id).strip()
        if text and text not in enabled:
            enabled.append(text)
        return self.set_workbench_enabled_extensions(enabled)

    def disable_workbench_extension(self, extension_id: str) -> List[str]:
        enabled = self.get_workbench_enabled_extensions()
        text = str(extension_id).strip()
        if not text:
            return enabled
        try:
            enabled = [item for item in enabled if item != text]
        except Exception:
            pass
        return self.set_workbench_enabled_extensions(enabled)


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
