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
    _draft_files: Set[str] = field(default_factory=set, init=False, repr=False)

    # In-memory cache of instances keyed by normalized project path.
    _instances: ClassVar[Dict[str, "DraftIndexSidecar"]] = {}

    def __post_init__(self) -> None:
        normalized = _normalize_project_path(self.project_path)
        self.project_path = normalized
        self._path = self.get_sidecar_path(self.project_path)
        self._load()

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
            return
        try:
            raw = self._path.read_text(encoding="utf-8")
            if not raw.strip():
                self._draft_files = set()
                return
            data = json.loads(raw)
            if not isinstance(data, dict):
                self._draft_files = set()
                return
        except Exception:
            self._draft_files = set()
            return

        if (data.get("version") or "").strip() != self.VERSION:
            # Wipe on version mismatch (no migration).
            self._draft_files = set()
            try:
                self.save()
            except Exception:
                pass
            return

        files = data.get("draft_files")
        if not isinstance(files, list):
            self._draft_files = set()
            return
        out: Set[str] = set()
        for item in files:
            if isinstance(item, str) and item and item != ".":
                out.add(item.replace("\\", "/").lstrip("/"))
        self._draft_files = out

    def reload(self) -> None:
        """Reload state from disk (best-effort)."""
        try:
            self._load()
        except Exception:
            self._draft_files = set()

    def save(self) -> None:
        """Atomically persist the current draft index to disk."""
        _ensure_dir(self._path.parent)
        payload = {
            "version": self.VERSION,
            "project_path": self.project_path,
            "updated_at": _utc_timestamp(),
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

        try:
            self.save()
        except Exception:
            # No disk access => drafts effectively off.
            self._draft_files = set()

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
