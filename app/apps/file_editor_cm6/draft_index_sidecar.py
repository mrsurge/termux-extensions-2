from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, ClassVar, Dict, Iterable, Optional, Set, Tuple

from .project_sidecar import _ensure_dir, _normalize_project_path


def _utc_timestamp() -> str:
    return datetime.utcnow().isoformat() + "Z"


@dataclass
class DraftIndexSidecar:
    """Lightweight, per-project draft index persisted separately from ProjectSidecar.

    Purpose:
      - Keep explorer listing fast without parsing ProjectSidecar.session_cache (which contains full content).
      - Provide O(1) `hasDraft` checks via precomputed sets of rel file paths + ancestor dirs.

    Invariants (per user request):
      - If disk access fails: drafts are treated as OFF (empty index).
      - Version mismatch: index is wiped (no migration).
    """

    project_path: str
    VERSION: ClassVar[str] = "1.0"

    _path: Path = field(init=False, repr=False)
    _source_sidecar_mtime_ns: Optional[int] = field(default=None, init=False, repr=False)
    _draft_files: Set[str] = field(default_factory=set, init=False, repr=False)

    # In-memory cache of instances keyed by normalized project path.
    _instances: ClassVar[Dict[str, "DraftIndexSidecar"]] = {}

    def __post_init__(self) -> None:
        normalized = _normalize_project_path(self.project_path)
        self.project_path = normalized
        self._path = self.get_sidecar_path(self.project_path)
        self.reload()

    @staticmethod
    def get_sidecar_path(project_path: str) -> Path:
        # Co-locate with ProjectSidecar, but keep separate file to avoid parsing large session_cache blobs.
        from .project_sidecar import ProjectSidecar

        base = ProjectSidecar.get_sidecar_path(project_path)
        return base.with_suffix(".draft_index.json")

    @classmethod
    def load_or_create(cls, project_path: str) -> "DraftIndexSidecar":
        normalized = _normalize_project_path(project_path)
        existing = cls._instances.get(normalized)
        if existing is not None:
            return existing
        instance = cls(normalized)
        cls._instances[normalized] = instance
        return instance

    def _load(self) -> None:
        if not self._path.exists():
            self._draft_files = set()
            self._source_sidecar_mtime_ns = None
            return
        try:
            raw = self._path.read_text(encoding="utf-8")
            if not raw.strip():
                self._draft_files = set()
                self._source_sidecar_mtime_ns = None
                return
            data = json.loads(raw)
            if not isinstance(data, dict):
                self._draft_files = set()
                self._source_sidecar_mtime_ns = None
                return
        except Exception:
            self._draft_files = set()
            self._source_sidecar_mtime_ns = None
            return

        if (data.get("version") or "").strip() != self.VERSION:
            # Wipe on version mismatch (no migration).
            self._draft_files = set()
            self._source_sidecar_mtime_ns = None
            try:
                self.save()
            except Exception:
                pass
            return

        try:
            mtime = data.get("source_sidecar_mtime_ns")
            self._source_sidecar_mtime_ns = int(mtime) if isinstance(mtime, (int, float, str)) and str(mtime).strip() else None
        except Exception:
            self._source_sidecar_mtime_ns = None

        files = data.get("draft_files")
        if not isinstance(files, list):
            self._draft_files = set()
            return
        out: Set[str] = set()
        for item in files:
            if isinstance(item, str) and item and item != ".":
                out.add(item.replace("\\", "/").lstrip("/"))
        self._draft_files = out

    def _get_project_sidecar_mtime_ns(self) -> Optional[int]:
        """Best-effort: return ProjectSidecar file mtime_ns for this project."""
        try:
            from .project_sidecar import ProjectSidecar

            p = ProjectSidecar.get_sidecar_path(self.project_path)
            if not p.exists():
                return None
            return int(p.stat().st_mtime_ns)
        except Exception:
            return None

    def _rebuild_from_project_sidecar(self, *, mtime_ns: Optional[int]) -> None:
        """Rebuild the draft index from the ProjectSidecar SSOT (session_cache)."""
        try:
            from .project_sidecar import ProjectSidecar

            sidecar_path = ProjectSidecar.get_sidecar_path(self.project_path)
            if not sidecar_path.exists():
                self._draft_files = set()
                self._source_sidecar_mtime_ns = None
                try:
                    self.save()
                except Exception:
                    pass
                return

            data = json.loads(sidecar_path.read_text(encoding="utf-8"))
            session_cache = (data.get("session_cache") or {}) if isinstance(data, dict) else {}
            if not isinstance(session_cache, dict):
                session_cache = {}

            root = Path(self.project_path).expanduser().resolve(strict=False)
            draft_files: Set[str] = set()
            for entry in session_cache.values():
                if not isinstance(entry, dict):
                    continue
                if not entry.get("unsaved"):
                    continue
                file_path = entry.get("file_path")
                if not isinstance(file_path, str) or not file_path.strip():
                    continue
                try:
                    abs_path = Path(file_path).expanduser().resolve(strict=False)
                    rel = str(abs_path.relative_to(root)).replace("\\", "/").lstrip("/")
                    if rel and rel != ".":
                        draft_files.add(rel)
                except Exception:
                    continue

            self._draft_files = draft_files
            self._source_sidecar_mtime_ns = int(mtime_ns) if isinstance(mtime_ns, int) else None
            self.save()
        except Exception:
            # No disk access / parsing failure => drafts effectively off.
            self._draft_files = set()
            self._source_sidecar_mtime_ns = None

    def reload(self) -> None:
        """Reload index (fast), rebuilding from ProjectSidecar SSOT if stale."""
        try:
            # Load existing index file first (fast path)
            self._load()
            current_mtime = self._get_project_sidecar_mtime_ns()

            # If the project sidecar doesn't exist, drafts are off.
            if current_mtime is None:
                self._draft_files = set()
                self._source_sidecar_mtime_ns = None
                return

            # If the SSOT sidecar changed since this index was built, rebuild.
            if self._source_sidecar_mtime_ns != current_mtime:
                self._rebuild_from_project_sidecar(mtime_ns=current_mtime)
        except Exception:
            self._draft_files = set()
            self._source_sidecar_mtime_ns = None

    def save(self) -> None:
        """Atomically persist the current draft index to disk."""
        _ensure_dir(self._path.parent)
        payload = {
            "version": self.VERSION,
            "project_path": self.project_path,
            "updated_at": _utc_timestamp(),
            "source_sidecar_mtime_ns": self._source_sidecar_mtime_ns,
            "draft_files": sorted(self._draft_files),
        }
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
                json.dump(payload, tmp_file, ensure_ascii=False, indent=2)
                tmp_file.flush()
                os.fsync(tmp_file.fileno())
            os.replace(tmp_path, self._path)
        finally:
            if tmp_path is not None and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def wipe(self) -> None:
        self._draft_files = set()
        self._source_sidecar_mtime_ns = None
        try:
            self.save()
        except Exception:
            pass

    def update_from_abs_file(self, file_path: str, *, unsaved: bool) -> None:
        """Upsert/remove an entry based on absolute file path and unsaved flag."""
        try:
            root = Path(self.project_path).expanduser().resolve(strict=False)
            abs_path = Path(file_path).expanduser().resolve(strict=False)
            rel = str(abs_path.relative_to(root)).replace("\\", "/")
            rel = rel.lstrip("/")
            if not rel or rel == ".":
                return
        except Exception:
            return

        if unsaved:
            self._draft_files.add(rel)
        else:
            self._draft_files.discard(rel)

        # Best-effort: align the index with the SSOT sidecar mtime if available.
        # This keeps the index “fresh” when mutations happen through normal APIs.
        try:
            self._source_sidecar_mtime_ns = self._get_project_sidecar_mtime_ns()
        except Exception:
            self._source_sidecar_mtime_ns = None

        try:
            self.save()
        except Exception:
            # No disk access => drafts effectively off.
            self._draft_files = set()
            self._source_sidecar_mtime_ns = None

    def remove_abs_file(self, file_path: str) -> None:
        self.update_from_abs_file(file_path, unsaved=False)

    def snapshot(self) -> Tuple[Set[str], Set[str]]:
        """Return (draft_files, draft_dirs) snapshot for fast `hasDraft` checks."""
        files = set(self._draft_files)
        dirs: Set[str] = set()
        try:
            from pathlib import PurePosixPath

            for rel in files:
                try:
                    p = PurePosixPath(rel)
                    for parent in p.parents:
                        if str(parent) == ".":
                            break
                        dirs.add(str(parent))
                except Exception:
                    continue
        except Exception:
            dirs = set()
        return files, dirs
